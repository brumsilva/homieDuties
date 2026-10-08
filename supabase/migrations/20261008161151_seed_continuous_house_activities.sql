update public.tasks t
set title = 'Levar o lixo para fora',
    area = r.name,
    room_id = r.id,
    frequency = 'Ongoing',
    points = 5
from public.rooms r
where r.household_id = t.household_id
  and lower(r.name) = 'kitchen'
  and lower(t.title) in ('take out the bins', 'levar o lixo para fora');

update public.tasks t
set title = 'Guardar os talheres',
    area = r.name,
    room_id = r.id,
    frequency = 'Ongoing',
    points = 3
from public.rooms r
where r.household_id = t.household_id
  and lower(r.name) = 'kitchen'
  and lower(t.title) in ('put away the cutlery', 'guardar talheres', 'guardar os talheres');

insert into public.tasks (household_id, title, area, description, frequency, room_id, points, created_by)
select h.id, activity.title, r.name, activity.description, 'Ongoing', r.id, activity.points,
       (select p.id from public.profiles p where p.household_id = h.id and p.role = 'admin' order by p.created_at limit 1)
from public.households h
join public.rooms r on r.household_id = h.id and lower(r.name) = 'kitchen'
cross join (values
  ('Guardar os talheres', 'Guardar os talheres limpos na gaveta compartilhada.', 3),
  ('Levar o lixo para fora', 'Separar reciclagem e lixo comum, depois colocar sacos novos.', 5)
) as activity(title, description, points)
where not exists (
  select 1 from public.tasks t
  where t.household_id = h.id and lower(t.title) = lower(activity.title)
);
