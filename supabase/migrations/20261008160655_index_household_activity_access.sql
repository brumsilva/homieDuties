create index if not exists rooms_created_by_idx on public.rooms(created_by);
create index if not exists tasks_room_id_idx on public.tasks(room_id);
create index if not exists tasks_created_by_idx on public.tasks(created_by);
create index if not exists completion_disputes_reporter_id_idx on public.completion_disputes(reporter_id);
create index if not exists completion_disputes_resolved_by_idx on public.completion_disputes(resolved_by);
