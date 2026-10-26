-- Recurring tasks: when a recurring task is completed, the database creates
-- the next occurrence automatically (same project, assignee, estimate, …).

create or replace function public.app_spawn_recurring_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec jsonb := NEW.recurrence;
  v_kind text;
  v_interval integer;
  v_unit text;
  v_base date;
  v_next date;
  v_day integer;
  v_weekdays int[];
  v_wd integer;
  v_months integer;
begin
  if v_rec is null then
    return NEW;
  end if;
  if not (TG_OP = 'UPDATE' and NEW.status = 'completed' and OLD.status is distinct from 'completed') then
    return NEW;
  end if;

  v_kind := coalesce(v_rec ->> 'kind', 'daily');
  v_interval := greatest(1, coalesce(nullif(v_rec ->> 'interval', '')::integer, 1));
  v_unit := coalesce(v_rec ->> 'unit', 'days');
  v_base := coalesce(NEW.due_date, (now() at time zone 'Asia/Kolkata')::date);

  if v_kind = 'daily' then
    v_next := v_base + v_interval;
  elsif v_kind = 'weekly' then
    v_weekdays := coalesce(
      (select array_agg(x)::int[]
         from jsonb_array_elements_text(coalesce(v_rec -> 'weekdays', '[]'::jsonb)) as t(x)
        where t(x) ~ '^[0-6]$'),
      '{}'
    );
    if cardinality(v_weekdays) = 0 then
      v_next := v_base + (7 * v_interval);
    else
      v_next := v_base + 1;
      for v_wd in 1..14 * v_interval loop
        exit when extract(dow from v_next)::int = any (v_weekdays);
        v_next := v_next + 1;
      end loop;
      -- ensure at least `interval` weeks have passed for interval > 1
      while v_next < v_base + (7 * (v_interval - 1)) loop
        v_next := v_next + 7;
      end loop;
    end if;
  elsif v_kind = 'monthly' then
    v_day := coalesce(nullif(v_rec ->> 'month_day', '')::integer, extract(day from v_base)::integer);
    v_day := least(greatest(v_day, 1), 28);
    v_months := v_interval;
    v_next := (date_trunc('month', v_base) + interval '1 month' * v_months)::date;
    v_next := v_next + (v_day - 1);
  else -- custom unit
    if v_unit = 'weeks' then
      v_next := v_base + (7 * v_interval);
    elsif v_unit = 'months' then
      v_next := (date_trunc('month', v_base) + interval '1 month' * v_interval)::date
                + (extract(day from v_base)::integer - 1);
    else
      v_next := v_base + v_interval;
    end if;
  end if;

  if v_rec ? 'end_date' and (v_rec ->> 'end_date') is not null and v_next > (v_rec ->> 'end_date')::date then
    return NEW;
  end if;

  insert into public.tasks (
    project_id, parent_task_id, title, description, category, tags, priority,
    assignee_id, creator_id, reviewer_id, expected_deliverable,
    start_date, due_date, estimated_hours, recurrence, is_private
  )
  select
    NEW.project_id, NEW.parent_task_id, NEW.title, NEW.description, NEW.category, NEW.tags, NEW.priority,
    NEW.assignee_id, NEW.creator_id, NEW.reviewer_id, NEW.expected_deliverable,
    case when NEW.start_date is not null then NEW.start_date + (v_next - coalesce(NEW.due_date, v_base)) else null end,
    v_next, NEW.estimated_hours, NEW.recurrence,
    case when NEW.project_id is null then true else NEW.is_private end
  where not exists (
    select 1 from public.tasks t
    where t.project_id is not distinct from NEW.project_id
      and t.title = NEW.title
      and t.assignee_id = NEW.assignee_id
      and t.due_date = v_next
      and t.status in ('not_started', 'in_progress', 'on_hold', 'blocked')
  );

  return NEW;
end;
$$;

create trigger task_recurring_spawn
  after update on public.tasks
  for each row execute function public.app_spawn_recurring_task();
