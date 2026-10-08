alter table public.profiles add column is_active boolean not null default true;

create or replace function app_private.same_household(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles caller join public.profiles target on target.household_id = caller.household_id
    where caller.id = (select auth.uid()) and caller.is_active and target.id = p_user_id
  );
$$;

create or replace function app_private.is_household_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active);
$$;

create or replace function app_private.is_household_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_active and p.role = 'admin');
$$;

drop policy if exists "housemates can read household rooms" on public.rooms;
create policy "active housemates can read household rooms" on public.rooms
for select to authenticated using (app_private.is_household_member() and exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = rooms.household_id
));
drop policy if exists "housemates can add household rooms" on public.rooms;
create policy "active housemates can add household rooms" on public.rooms
for insert to authenticated with check (created_by = (select auth.uid()) and app_private.is_household_member() and exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = rooms.household_id
));

drop policy if exists "housemates can read household completion disputes" on public.completion_disputes;
create policy "active housemates can read household completion disputes" on public.completion_disputes
for select to authenticated using (app_private.is_household_member() and exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_disputes.household_id
));
drop policy if exists "housemates can contest another member completion" on public.completion_disputes;
create policy "active housemates can contest another member completion" on public.completion_disputes
for insert to authenticated with check (
  reporter_id = (select auth.uid()) and status = 'pending' and resolved_by is null and resolved_at is null and app_private.is_household_member() and
  exists (select 1 from public.profiles p join public.completion_logs l on l.household_id = p.household_id
    where p.id = (select auth.uid()) and completion_disputes.household_id = p.household_id and l.id = completion_log_id and l.member_id <> p.id)
);
drop policy if exists "admins can resolve household completion disputes" on public.completion_disputes;
create policy "active admins can resolve household completion disputes" on public.completion_disputes
for update to authenticated using (app_private.is_household_admin() and exists (
  select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_disputes.household_id
)) with check (
  resolved_by = (select auth.uid()) and resolved_at is not null and status in ('accepted', 'dismissed') and app_private.is_household_admin() and
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_disputes.household_id) and
  exists (select 1 from public.completion_logs l where l.id = completion_disputes.completion_log_id and l.household_id = completion_disputes.household_id) and
  exists (select 1 from public.profiles reporter where reporter.id = completion_disputes.reporter_id and reporter.household_id = completion_disputes.household_id)
);

create or replace function public.update_household_room(p_room_id uuid, p_name text, p_emoji text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_household_id uuid; v_name text := trim(p_name); v_emoji text := trim(p_emoji);
begin
  select household_id into v_household_id from public.profiles where id = (select auth.uid()) and is_active;
  if v_household_id is null then raise exception 'Active household membership required' using errcode = '42501'; end if;
  if v_name is null or char_length(v_name) not between 1 and 50 or v_emoji is null or char_length(v_emoji) not between 1 and 12 then
    raise exception 'Invalid room name or emoji' using errcode = '22023';
  end if;
  update public.rooms set name = v_name, emoji = v_emoji where id = p_room_id and household_id = v_household_id;
  if not found then raise exception 'Room not found in this household' using errcode = 'P0002'; end if;
  update public.tasks set area = v_name where room_id = p_room_id and household_id = v_household_id;
end;
$$;

create or replace function public.delete_household_room(p_room_id uuid, p_replacement_room_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_household_id uuid; v_task_count integer;
begin
  select household_id into v_household_id from public.profiles where id = (select auth.uid()) and is_active;
  if v_household_id is null then raise exception 'Active household membership required' using errcode = '42501'; end if;
  if not exists (select 1 from public.rooms where id = p_room_id and household_id = v_household_id) then
    raise exception 'Room not found in this household' using errcode = 'P0002';
  end if;
  select count(*) into v_task_count from public.tasks where room_id = p_room_id and household_id = v_household_id;
  if v_task_count > 0 then
    if p_replacement_room_id is null or p_replacement_room_id = p_room_id or not exists (
      select 1 from public.rooms where id = p_replacement_room_id and household_id = v_household_id
    ) then raise exception 'Choose another room for the linked activities' using errcode = '22023'; end if;
    update public.tasks set room_id = p_replacement_room_id,
      area = (select name from public.rooms where id = p_replacement_room_id and household_id = v_household_id)
      where room_id = p_room_id and household_id = v_household_id;
  end if;
  delete from public.rooms where id = p_room_id and household_id = v_household_id;
end;
$$;

revoke all on function public.update_household_room(uuid, text, text) from public, anon;
revoke all on function public.delete_household_room(uuid, uuid) from public, anon;
grant execute on function public.update_household_room(uuid, text, text) to authenticated;
grant execute on function public.delete_household_room(uuid, uuid) to authenticated;

create or replace function public.complete_task(p_task_id uuid, p_note text, p_photo_path text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_task public.tasks%rowtype; v_room public.rooms%rowtype; v_log_id uuid;
  v_actor uuid := (select auth.uid()); v_household_id uuid; v_next_due timestamptz;
begin
  if v_actor is null then raise exception 'Not authenticated' using errcode = '42501'; end if;
  if p_photo_path is null or char_length(p_photo_path) > 500 then raise exception 'A valid photo path is required' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 240 then raise exception 'Note is too long' using errcode = '22023'; end if;
  select p.household_id into v_household_id from public.profiles p where p.id = v_actor and p.is_active;
  if v_household_id is null then raise exception 'Active household profile not found' using errcode = '42501'; end if;
  if (storage.foldername(p_photo_path))[1] <> v_actor::text or not exists (
    select 1 from storage.objects o where o.bucket_id = 'completion-photos' and o.name = p_photo_path
  ) then raise exception 'Photo does not belong to this member' using errcode = '42501'; end if;
  select * into v_task from public.tasks where id = p_task_id and household_id = v_household_id and status = 'open' and available_at <= now() for update;
  if not found then raise exception 'Task is no longer open' using errcode = 'P0002'; end if;
  select * into v_room from public.rooms where id = v_task.room_id and household_id = v_household_id;
  insert into public.completion_logs(household_id, task_id, member_id, note, photo_path, activity_group_id, activity_title, room_name, room_emoji, points_earned)
  values (v_task.household_id, v_task.id, v_actor, nullif(trim(p_note), ''), p_photo_path, v_task.activity_group_id, v_task.title, v_room.name, v_room.emoji, v_task.points)
  returning id into v_log_id;
  update public.tasks set status = 'done', completed_at = now() where id = v_task.id;
  v_next_due := case v_task.frequency when 'Daily' then now() + interval '1 day' when 'Several times a week' then now() + interval '3 days'
    when 'Weekly' then now() + interval '1 week' when 'Monthly' then now() + interval '1 month' when 'Ongoing' then now() else null end;
  if v_next_due is not null then
    insert into public.tasks(household_id, title, area, description, frequency, status, available_at, created_by, room_id, activity_group_id, points)
    values (v_task.household_id, v_task.title, v_room.name, v_task.description, v_task.frequency, 'open', v_next_due, v_actor, v_task.room_id, v_task.activity_group_id, v_task.points);
  end if;
  return v_log_id;
end;
$$;
revoke all on function public.complete_task(uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_task(uuid, text, text) to authenticated;

drop policy if exists "housemates can view household proof photos" on storage.objects;
create policy "active housemates can view household proof photos" on storage.objects
for select to authenticated using (bucket_id = 'completion-photos' and app_private.is_household_member() and exists (
  select 1 from public.profiles owner_profile join public.profiles viewer_profile on viewer_profile.household_id = owner_profile.household_id
  where owner_profile.id::text = (storage.foldername(name))[1] and viewer_profile.id = (select auth.uid()) and viewer_profile.is_active
));
drop policy if exists "members upload photos to their own folder" on storage.objects;
create policy "active members upload photos to their own folder" on storage.objects
for insert to authenticated with check (bucket_id = 'completion-photos' and app_private.is_household_member() and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "members can discard unlogged uploads" on storage.objects;
create policy "active members can discard unlogged uploads" on storage.objects
for delete to authenticated using (bucket_id = 'completion-photos' and app_private.is_household_member() and (storage.foldername(name))[1] = (select auth.uid())::text and
  not exists (select 1 from public.completion_logs l where l.photo_path = storage.objects.name));
