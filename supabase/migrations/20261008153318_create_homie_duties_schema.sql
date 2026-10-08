create extension if not exists pgcrypto with schema extensions;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to authenticated, service_role;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9._-]{2,32}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  area text not null check (area in ('Kitchen', 'Bathroom', 'Hallway')),
  description text not null default '' check (char_length(description) <= 500),
  frequency text not null default 'Weekly' check (frequency in ('Daily', 'Several times a week', 'Weekly', 'Monthly', 'As needed')),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  available_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  check ((status = 'open' and completed_at is null) or (status = 'done' and completed_at is not null))
);

create table public.completion_logs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  completed_at timestamptz not null default now(),
  note text check (note is null or char_length(note) <= 240),
  photo_path text not null,
  created_at timestamptz not null default now()
);

create index tasks_household_status_idx on public.tasks(household_id, status, created_at desc);
create index completion_logs_household_time_idx on public.completion_logs(household_id, completed_at desc);
create index completion_logs_task_id_idx on public.completion_logs(task_id);

-- Login throttling records are deliberately inaccessible through the Data API.
create table app_private.pin_login_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  attempts integer not null default 0,
  blocked_until timestamptz
);
revoke all on app_private.pin_login_limits from public, anon, authenticated;
grant all on public.households, public.profiles, public.tasks, public.completion_logs to service_role;
grant all on app_private.pin_login_limits to service_role;

create or replace function app_private.same_household(p_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles caller
    join public.profiles target on target.household_id = caller.household_id
    where caller.id = (select auth.uid()) and target.id = p_user_id
  );
$$;

create or replace function app_private.is_household_member()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()));
$$;

create or replace function app_private.is_household_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin');
$$;

grant execute on function app_private.same_household(uuid) to authenticated, service_role;
grant execute on function app_private.is_household_member() to authenticated, service_role;
grant execute on function app_private.is_household_admin() to authenticated, service_role;
revoke all on function app_private.same_household(uuid) from public, anon;
revoke all on function app_private.is_household_member() from public, anon;
revoke all on function app_private.is_household_admin() from public, anon;

create or replace function public.consume_pin_attempt(p_username_key text, p_ip_key text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_allowed boolean := true;
  v_key text;
  v_limit integer;
  v_block interval;
  v_row app_private.pin_login_limits%rowtype;
begin
  for v_key, v_limit, v_block in
    select p_username_key, 5, interval '15 minutes'
    union all
    select p_ip_key, 30, interval '15 minutes'
  loop
    insert into app_private.pin_login_limits(key_hash, window_started_at, attempts)
    values (v_key, v_now, 0) on conflict (key_hash) do nothing;
    select * into v_row from app_private.pin_login_limits where key_hash = v_key for update;
    if v_row.blocked_until is not null and v_row.blocked_until > v_now then
      v_allowed := false;
    elsif v_row.window_started_at < v_now - v_block then
      update app_private.pin_login_limits set window_started_at = v_now, attempts = 1, blocked_until = null where key_hash = v_key;
    elsif v_row.attempts >= v_limit then
      update app_private.pin_login_limits set blocked_until = v_now + v_block where key_hash = v_key;
      v_allowed := false;
    else
      update app_private.pin_login_limits set attempts = attempts + 1 where key_hash = v_key;
    end if;
  end loop;
  return v_allowed;
end;
$$;
revoke all on function public.consume_pin_attempt(text, text) from public, anon, authenticated;
grant execute on function public.consume_pin_attempt(text, text) to service_role;

create or replace function public.complete_task(p_task_id uuid, p_note text, p_photo_path text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_log_id uuid;
  v_actor uuid := (select auth.uid());
  v_household_id uuid;
  v_next_due timestamptz;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_photo_path is null or char_length(p_photo_path) > 500 then raise exception 'A valid photo path is required' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 240 then raise exception 'Note is too long' using errcode = '22023'; end if;
  select p.household_id into v_household_id from public.profiles p where p.id = v_actor;
  if v_household_id is null then raise exception 'Household profile not found' using errcode = '42501'; end if;
  if (storage.foldername(p_photo_path))[1] <> v_actor::text or not exists (
    select 1 from storage.objects o where o.bucket_id = 'completion-photos' and o.name = p_photo_path
  ) then raise exception 'Photo does not belong to this member' using errcode = '42501'; end if;

  select * into v_task from public.tasks where id = p_task_id and household_id = v_household_id and status = 'open' and available_at <= now() for update;
  if not found then raise exception 'Task is no longer open' using errcode = 'P0002'; end if;

  insert into public.completion_logs(household_id, task_id, member_id, note, photo_path)
  values (v_task.household_id, v_task.id, v_actor, nullif(trim(p_note), ''), p_photo_path)
  returning id into v_log_id;

  update public.tasks set status = 'done', completed_at = now() where id = v_task.id;

  v_next_due := case v_task.frequency
    when 'Daily' then now() + interval '1 day'
    when 'Several times a week' then now() + interval '3 days'
    when 'Weekly' then now() + interval '1 week'
    when 'Monthly' then now() + interval '1 month'
    else null
  end;
  if v_next_due is not null then
    insert into public.tasks(household_id, title, area, description, frequency, status, available_at, created_by)
    values (v_task.household_id, v_task.title, v_task.area, v_task.description, v_task.frequency, 'open', v_next_due, v_actor);
  end if;
  return v_log_id;
end;
$$;
revoke all on function public.complete_task(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_task(uuid, text, text) to authenticated;

alter table public.households enable row level security;
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.completion_logs enable row level security;

grant select on public.households, public.profiles, public.tasks, public.completion_logs to authenticated;
grant insert on public.tasks to authenticated;

create policy "members read their household" on public.households
for select to authenticated using (exists (select 1 from public.profiles p where p.household_id = households.id and p.id = (select auth.uid())));

create policy "housemates can see household profiles" on public.profiles
for select to authenticated using (app_private.same_household(id));

create policy "housemates can see household tasks" on public.tasks
for select to authenticated using (app_private.is_household_member() and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = tasks.household_id));
create policy "housemates can add household tasks" on public.tasks
for insert to authenticated with check (
  status = 'open' and completed_at is null and
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = tasks.household_id)
);
create policy "housemates can read completion history" on public.completion_logs
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_logs.household_id)
);
-- Completion rows are created only through the hardened complete_task RPC above.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('completion-photos', 'completion-photos', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = excluded.allowed_mime_types;

create policy "housemates can view household proof photos" on storage.objects
for select to authenticated using (
  bucket_id = 'completion-photos' and exists (
    select 1 from public.profiles owner_profile
    join public.profiles viewer_profile on viewer_profile.household_id = owner_profile.household_id
    where owner_profile.id::text = (storage.foldername(name))[1] and viewer_profile.id = (select auth.uid())
  )
);
create policy "members upload photos to their own folder" on storage.objects
for insert to authenticated with check (
  bucket_id = 'completion-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "members can discard unlogged uploads" on storage.objects
for delete to authenticated using (
  bucket_id = 'completion-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and
  not exists (select 1 from public.completion_logs l where l.photo_path = storage.objects.name)
);

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.completion_logs;
