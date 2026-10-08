alter table public.rooms
  add constraint rooms_id_household_unique unique (id, household_id);

alter table public.tasks
  add constraint tasks_room_household_fk
  foreign key (room_id, household_id)
  references public.rooms (id, household_id)
  on delete restrict;

drop policy if exists "housemates can contest another member completion" on public.completion_disputes;
create policy "housemates can contest another member completion" on public.completion_disputes
for insert to authenticated with check (
  reporter_id = (select auth.uid()) and status = 'pending' and resolved_by is null and resolved_at is null and
  exists (
    select 1 from public.profiles p
    join public.completion_logs l on l.household_id = p.household_id
    where p.id = (select auth.uid())
      and completion_disputes.household_id = p.household_id
      and l.household_id = completion_disputes.household_id
      and l.id = completion_log_id
      and l.member_id <> p.id
  )
);

drop policy if exists "admins can resolve household completion disputes" on public.completion_disputes;
create policy "admins can resolve household completion disputes" on public.completion_disputes
for update to authenticated using (
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_disputes.household_id and p.role = 'admin')
) with check (
  resolved_by = (select auth.uid()) and resolved_at is not null and status in ('accepted', 'dismissed') and
  exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.household_id = completion_disputes.household_id and p.role = 'admin') and
  exists (select 1 from public.completion_logs l where l.id = completion_disputes.completion_log_id and l.household_id = completion_disputes.household_id) and
  exists (select 1 from public.profiles reporter where reporter.id = completion_disputes.reporter_id and reporter.household_id = completion_disputes.household_id)
);
