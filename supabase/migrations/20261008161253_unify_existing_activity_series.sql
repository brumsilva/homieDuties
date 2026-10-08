with canonical as (
  select distinct on (household_id, room_id, lower(title))
    household_id, room_id, lower(title) as title_key, activity_group_id
  from public.tasks
  order by household_id, room_id, lower(title), created_at, id
)
update public.tasks t
set activity_group_id = c.activity_group_id
from canonical c
where c.household_id = t.household_id
  and c.room_id = t.room_id
  and c.title_key = lower(t.title);

update public.completion_logs l
set activity_group_id = t.activity_group_id
from public.tasks t
where t.id = l.task_id;
