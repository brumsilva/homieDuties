-- Dynamic rooms, reusable activity series, points, and a fair contest flow.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  emoji text not null default '🏠' check (char_length(emoji) between 1 and 12),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, name)
);

insert into public.rooms (household_id, name, emoji)
select h.id, r.name, r.emoji
from public.households h
cross join (values ('Kitchen', '🍳'), ('Bathroom', '🛁'), ('Hallway', '🧹')) as r(name, emoji)
on conflict (household_id, name) do nothing;

create unique index rooms_household_name_ci_idx on public.rooms (household_id, lower(name));

alter table public.tasks drop constraint if exists tasks_area_check;
alter table public.tasks drop constraint if exists tasks_frequency_check;
alter table public.tasks add column room_id uuid references public.rooms(id) on delete restrict;
alter table public.tasks add column activity_group_id uuid not null default gen_random_uuid();
alter table public.tasks add column points integer not null default 10 check (points between 1 and 1000);
alter table public.tasks add constraint tasks_frequency_check
  check (frequency in ('Daily', 'Several times a week', 'Weekly', 'Monthly', 'As needed', 'Ongoing'));

update public.tasks t set room_id = r.id
from public.rooms r where r.household_id = t.household_id and r.name = t.area;

-- Preserve compatibility with any older custom area text by creating its room first.
insert into public.rooms (household_id, name, emoji)
select distinct t.household_id, t.area, '🏠'
from public.tasks t
where t.room_id is null
on conflict (household_id, name) do nothing;
update public.tasks t set room_id = r.id
from public.rooms r where r.household_id = t.household_id and r.name = t.area and t.room_id is null;
alter table public.tasks alter column room_id set not null;

alter table public.completion_logs add column activity_group_id uuid;
alter table public.completion_logs add column activity_title text;
alter table public.completion_logs add column room_name text;
alter table public.completion_logs add column room_emoji text not null default '🏠';
alter table public.completion_logs add column points_earned integer not null default 10 check (points_earned between 1 and 1000);
update public.completion_logs l
set activity_group_id = t.activity_group_id,
    activity_title = t.title,
    room_name = t.area,
    points_earned = t.points
from public.tasks t where t.id = l.task_id;
alter table public.completion_logs alter column activity_group_id set not null;
alter table public.completion_logs alter column activity_title set not null;
alter table public.completion_logs alter column room_name set not null;

create table public.completion_disputes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  completion_log_id uuid not null references public.completion_logs(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (char_length(reason) between 8 and 500),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index completion_disputes_one_pending_idx
  on public.completion_disputes (completion_log_id, reporter_id) where status = 'pending';
create index completion_disputes_household_status_idx
  on public.completion_disputes (household_id, status, created_at desc);
create index completion_logs_activity_group_idx
  on public.completion_logs (household_id, activity_group_id, completed_at desc);

alter table public.rooms enable row level security;
alter table public.completion_disputes enable row level security;
grant select, insert on public.rooms to authenticated;
grant select, insert, update on public.completion_disputes to authenticated;
revoke update on public.completion_disputes from authenticated;
grant update (status, resolution_note, resolved_by, resolved_at) on public.completion_disputes to authenticated;

create policy "housemates can read household rooms" on public.rooms
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = rooms.household_id)
);
create policy "housemates can add household rooms" on public.rooms
for insert to authenticated with check (
  created_by = (select auth.uid()) and
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = rooms.household_id)
);

create policy "housemates can read household completion disputes" on public.completion_disputes
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_disputes.household_id)
);
create policy "housemates can contest another member completion" on public.completion_disputes
for insert to authenticated with check (
  reporter_id = (select auth.uid()) and status = 'pending' and resolved_by is null and resolved_at is null and
  exists (
    select 1 from public.profiles p
    join public.completion_logs l on l.household_id = p.household_id
    where p.id = (select auth.uid()) and l.id = completion_log_id and l.member_id <> p.id
  )
);
create policy "admins can resolve household completion disputes" on public.completion_disputes
for update to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_disputes.household_id and p.role = 'admin')
) with check (
  resolved_by = (select auth.uid()) and resolved_at is not null and status in ('accepted', 'dismissed') and
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_disputes.household_id and p.role = 'admin')
);

create or replace function public.complete_task(p_task_id uuid, p_note text, p_photo_path text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_room public.rooms%rowtype;
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
  select * into v_room from public.rooms where id = v_task.room_id;

  insert into public.completion_logs(household_id, task_id, member_id, note, photo_path, activity_group_id, activity_title, room_name, room_emoji, points_earned)
  values (v_task.household_id, v_task.id, v_actor, nullif(trim(p_note), ''), p_photo_path, v_task.activity_group_id, v_task.title, v_room.name, v_room.emoji, v_task.points)
  returning id into v_log_id;

  update public.tasks set status = 'done', completed_at = now() where id = v_task.id;

  v_next_due := case v_task.frequency
    when 'Daily' then now() + interval '1 day'
    when 'Several times a week' then now() + interval '3 days'
    when 'Weekly' then now() + interval '1 week'
    when 'Monthly' then now() + interval '1 month'
    when 'Ongoing' then now()
    else null
  end;
  if v_next_due is not null then
    insert into public.tasks(household_id, title, area, description, frequency, status, available_at, created_by, room_id, activity_group_id, points)
    values (v_task.household_id, v_task.title, v_room.name, v_task.description, v_task.frequency, 'open', v_next_due, v_actor, v_task.room_id, v_task.activity_group_id, v_task.points);
  end if;
  return v_log_id;
end;
$$;
revoke all on function public.complete_task(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_task(uuid, text, text) to authenticated;

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.completion_disputes;
