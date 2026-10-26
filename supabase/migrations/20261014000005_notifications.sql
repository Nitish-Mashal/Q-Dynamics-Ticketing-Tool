-- Notification generation lives in the database so every client (and future
-- integrations) produces identical, deduplicated notifications.
-- Clients can never insert notifications directly (no insert policy).

create or replace function public.app_notify_task()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_assignee_name text;
begin
  select left(coalesce(nullif(btrim(p.full_name), ''), 'Someone'), 80)
    into v_actor_name
  from public.profiles p
  where p.id = v_actor;

  if TG_OP = 'INSERT' then
    if NEW.assignee_id is distinct from coalesce(v_actor, NEW.creator_id) then
      select left(coalesce(nullif(btrim(p.full_name), ''), 'A teammate'), 80)
        into v_assignee_name
      from public.profiles p where p.id = NEW.assignee_id;

      insert into public.notifications (user_id, task_id, kind, message, dedupe_key)
      values (
        NEW.assignee_id,
        NEW.id,
        'task_assigned',
        coalesce(v_actor_name, 'Someone') || ' assigned you “' || left(NEW.title, 160) || '”',
        'task:' || NEW.id || ':assigned:' || NEW.assignee_id || ':' || to_char(now(), 'YYYY-MM-DD')
      )
      on conflict (user_id, dedupe_key) do nothing;
    end if;
    return NEW;
  end if;

  -- UPDATE paths ----------------------------------------------------------
  if NEW.assignee_id is distinct from OLD.assignee_id then
    select left(coalesce(nullif(btrim(p.full_name), ''), 'A teammate'), 80)
      into v_assignee_name
    from public.profiles p where p.id = NEW.assignee_id;

    insert into public.notifications (user_id, task_id, kind, message, dedupe_key)
    values (
      NEW.assignee_id,
      NEW.id,
      'task_reassigned',
      coalesce(v_actor_name, 'Someone') || ' reassigned “' || left(NEW.title, 160) || '” to you',
      'task:' || NEW.id || ':reassigned:' || NEW.assignee_id || ':' || to_char(now(), 'YYYY-MM-DD-HH24')
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  if NEW.priority is distinct from OLD.priority
     and NEW.priority in ('critical', 'high')
     and NEW.assignee_id is distinct from v_actor then
    insert into public.notifications (user_id, task_id, kind, message, dedupe_key)
    values (
      NEW.assignee_id,
      NEW.id,
      'priority_changed',
      'Priority of “' || left(NEW.title, 160) || '” is now ' || upper(NEW.priority::text),
      'task:' || NEW.id || ':priority:' || NEW.priority || ':' || NEW.assignee_id || ':' || to_char(now(), 'YYYY-MM-DD')
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  if NEW.status = 'blocked' and OLD.status is distinct from 'blocked'
     and NEW.assignee_id is distinct from v_actor then
    insert into public.notifications (user_id, task_id, kind, message, dedupe_key)
    values (
      NEW.assignee_id,
      NEW.id,
      'blocked',
      '“' || left(NEW.title, 160) || '” was marked blocked',
      'task:' || NEW.id || ':blocked:' || NEW.assignee_id || ':' || to_char(now(), 'YYYY-MM-DD')
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  if NEW.status = 'completed' and OLD.status is distinct from 'completed'
     and NEW.reviewer_id is not null
     and NEW.reviewer_id is distinct from v_actor then
    insert into public.notifications (user_id, task_id, kind, message, dedupe_key)
    values (
      NEW.reviewer_id,
      NEW.id,
      'awaiting_approval',
      '“' || left(NEW.title, 160) || '” is ready for your review',
      'task:' || NEW.id || ':review:' || NEW.reviewer_id || ':' || to_char(now(), 'YYYY-MM-DD')
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return NEW;
end;
$$;

create or replace function public.app_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_task public.tasks%rowtype;
  v_mentioned uuid;
begin
  if NEW.task_id is null then
    return NEW;
  end if;

  select left(coalesce(nullif(btrim(p.full_name), ''), 'A teammate'), 80)
    into v_actor_name
  from public.profiles p where p.id = v_actor;

  select * into v_task from public.tasks t where t.id = NEW.task_id;

  if found and v_task.assignee_id is distinct from v_actor then
    insert into public.notifications (user_id, task_id, kind, message, dedupe_key)
    values (
      v_task.assignee_id,
      NEW.task_id,
      'comment',
      coalesce(v_actor_name, 'Someone') || ' commented on “' || left(v_task.title, 160) || '”',
      'comment:' || NEW.id || ':assignee'
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  foreach v_mentioned in array coalesce(NEW.mentions, '{}'::uuid[])
  loop
    if v_mentioned is distinct from v_actor then
      insert into public.notifications (user_id, task_id, kind, message, dedupe_key)
      values (
        v_mentioned,
        NEW.task_id,
        'mention',
        coalesce(v_actor_name, 'Someone') || ' mentioned you on “' || left(coalesce(v_task.title, 'a task'), 160) || '”',
        'comment:' || NEW.id || ':mention:' || v_mentioned
      )
      on conflict (user_id, dedupe_key) do nothing;
    end if;
  end loop;

  return NEW;
end;
$$;

create trigger task_notify
  after insert or update on public.tasks
  for each row execute function public.app_notify_task();

create trigger comment_notify
  after insert on public.comments
  for each row execute function public.app_notify_comment();
