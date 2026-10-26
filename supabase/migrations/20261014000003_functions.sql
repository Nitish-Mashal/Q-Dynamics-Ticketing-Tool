create or replace function public.app_uid()
returns uuid
language sql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
  select p.id from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.app_role()
returns public.user_role
language sql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.app_manages_project(p_project_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
  select p_project_id is not null and exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and (pr.manager_id = public.app_uid() or pr.owner_id = public.app_uid() or public.app_role() = 'admin')
  );
$$;

create or replace function public.app_member_of_project(p_project_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
  select p_project_id is not null and (
    public.app_role() = 'admin'
    or public.app_manages_project(p_project_id)
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = p_project_id and pm.user_id = public.app_uid()
    )
  );
$$;

create or replace function public.app_can_view_task(p_task_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  u uuid := public.app_uid();
  r public.user_role := public.app_role();
  t record;
begin
  if u is null then
    return false;
  end if;
  select * into t from public.tasks where id = p_task_id;
  if not found then
    return false;
  end if;
  return public.app_task_visible(t.project_id, t.assignee_id, t.creator_id, t.reviewer_id, t.is_private);
end;
$$;

-- Column-parameterized form. Used directly by the tasks SELECT/UPDATE policies
-- because some Postgres-compatible engines evaluate the SELECT policy's USING
-- expression against the row being inserted, where a by-id table lookup cannot
-- see the not-yet-inserted tuple. Passing the row's own columns keeps the same
-- rules while working in every engine.
create or replace function public.app_task_visible(
  p_project_id uuid,
  p_assignee_id uuid,
  p_creator_id uuid,
  p_reviewer_id uuid,
  p_is_private boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  u uuid := public.app_uid();
  r public.user_role := public.app_role();
begin
  if u is null then
    return false;
  end if;
  if p_project_id is null or coalesce(p_is_private, false) then
    return p_assignee_id = u;
  end if;
  if r = 'admin' then
    return true;
  end if;
  if p_assignee_id = u or p_creator_id = u or p_reviewer_id = u then
    return true;
  end if;
  if r = 'manager' and public.app_member_of_project(p_project_id) then
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.app_task_editable(
  p_project_id uuid,
  p_assignee_id uuid,
  p_creator_id uuid,
  p_reviewer_id uuid,
  p_is_private boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  u uuid := public.app_uid();
  r public.user_role := public.app_role();
begin
  if u is null then
    return false;
  end if;
  if p_project_id is null or coalesce(p_is_private, false) then
    return p_assignee_id = u;
  end if;
  if r = 'admin' then
    return true;
  end if;
  if public.app_manages_project(p_project_id) then
    return true;
  end if;
  if r = 'manager' and public.app_member_of_project(p_project_id) then
    return true;
  end if;
  if r = 'employee' and p_assignee_id = u then
    return true;
  end if;
  return false;
end;
$$;

create or replace function public.app_can_edit_task(p_task_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, auth, pg_temp
as $$
declare
  u uuid := public.app_uid();
  r public.user_role := public.app_role();
  t record;
begin
  if u is null then
    return false;
  end if;
  select * into t from public.tasks where id = p_task_id;
  if not found then
    return false;
  end if;
  return public.app_task_editable(t.project_id, t.assignee_id, t.creator_id, t.reviewer_id, t.is_private);
end;
$$;

create or replace function public.app_task_guard()
returns trigger
language plpgsql
as $$
declare
  u uuid := auth.uid();
  r public.user_role;
  parent_project uuid;
  ancestor uuid;
begin
  if u is not null then
    select p.role into r from public.profiles p where p.id = u and p.is_active;
    if r is null then
      raise exception 'Your account is not active' using errcode = '42501';
    end if;
  end if;

  if TG_OP = 'UPDATE' then
    if NEW.id <> OLD.id then
      raise exception 'A task id cannot change';
    end if;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
  end if;

  if NEW.project_id is null then
    NEW.is_private := true;
  end if;

  if NEW.parent_task_id is not null then
    if NEW.parent_task_id = NEW.id then
      raise exception 'A task cannot be its own subtask';
    end if;
    select pt.project_id into parent_project from public.tasks pt where pt.id = NEW.parent_task_id;
    if not found then
      raise exception 'Parent task not found';
    end if;
    if parent_project is distinct from NEW.project_id then
      raise exception 'Subtasks must belong to the same project as their parent';
    end if;
    if TG_OP = 'UPDATE' then
      ancestor := NEW.parent_task_id;
      while ancestor is not null loop
        if ancestor = NEW.id then
          raise exception 'Subtask hierarchy cannot contain a loop';
        end if;
        select pt.parent_task_id into ancestor from public.tasks pt where pt.id = ancestor;
      end loop;
    end if;
  end if;

  if u is not null then
    if TG_OP = 'INSERT' then
      if NEW.project_id is null then
        if NEW.assignee_id <> u then
          raise exception 'Personal tasks can only be created for yourself';
        end if;
      elsif r = 'employee' then
        if NEW.assignee_id <> u then
          raise exception 'Employees can only create tasks for themselves';
        end if;
        if not exists (select 1 from public.project_members pm where pm.project_id = NEW.project_id and pm.user_id = u) then
          raise exception 'You are not a member of that project';
        end if;
      elsif r = 'manager' then
        if not exists (
          select 1 from public.projects pr
          where pr.id = NEW.project_id and (pr.manager_id = u or pr.owner_id = u)
        ) then
          raise exception 'Managers can only create tasks in projects they manage';
        end if;
      end if;
    else
      if OLD.project_id is null or OLD.is_private then
        if OLD.assignee_id <> u then
          raise exception 'This task is private to its assignee';
        end if;
      elsif r = 'employee' and OLD.assignee_id <> u then
        raise exception 'You can only change tasks assigned to you';
      elsif r = 'manager' and not exists (
        select 1 from public.projects pr
        where pr.id = OLD.project_id
          and (pr.manager_id = u or pr.owner_id = u
               or exists (select 1 from public.project_members pm where pm.project_id = pr.id and pm.user_id = u))
      ) then
        raise exception 'You do not have access to that project';
      end if;

      if r = 'employee' then
        if NEW.assignee_id is distinct from OLD.assignee_id
          or NEW.reviewer_id is distinct from OLD.reviewer_id
          or NEW.creator_id is distinct from OLD.creator_id
          or NEW.project_id is distinct from OLD.project_id
          or NEW.parent_task_id is distinct from OLD.parent_task_id then
          raise exception 'Employees cannot reassign or move tasks' using errcode = '42501';
        end if;
      end if;

      if NEW.project_id is distinct from OLD.project_id then
        if NEW.project_id is null then
          if r <> 'admin' then
            raise exception 'Only an administrator can convert a project task into a personal task';
          end if;
        elsif not (r = 'admin' or exists (
          select 1 from public.projects pr where pr.id = NEW.project_id and (pr.manager_id = u or pr.owner_id = u)
        )) then
          raise exception 'You cannot move a task into that project';
        end if;
      end if;

      if NEW.assignee_id is distinct from OLD.assignee_id then
        if not (r = 'admin' or (r = 'manager' and OLD.project_id is not null and exists (
          select 1 from public.projects pr
          where pr.id = OLD.project_id
            and (pr.manager_id = u or pr.owner_id = u
                 or exists (select 1 from public.project_members pm where pm.project_id = pr.id and pm.user_id = u))
        ))) then
          raise exception 'You cannot reassign that task' using errcode = '42501';
        end if;
      end if;
    end if;

    if TG_OP = 'INSERT' then
      if not exists (select 1 from public.profiles p where p.id = NEW.assignee_id and p.is_active) then
        raise exception 'The assignee must be an active employee';
      end if;
    elsif NEW.assignee_id is distinct from OLD.assignee_id then
      if not exists (select 1 from public.profiles p where p.id = NEW.assignee_id and p.is_active) then
        raise exception 'The assignee must be an active employee';
      end if;
    end if;
  end if;

  if NEW.status = 'completed' then
    if NEW.completed_at is null then
      NEW.completed_at := now();
    end if;
    NEW.progress := 100;
  else
    NEW.completed_at := null;
    if TG_OP = 'UPDATE' then
      if OLD.status = 'completed' and NEW.progress > 90 then
        NEW.progress := 90;
      end if;
    end if;
  end if;

  return NEW;
end;
$$;

create or replace function public.app_log_task()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, new_value)
    values (
      'task', NEW.id, auth.uid(), 'task_created',
      jsonb_build_object(
        'title', NEW.title, 'status', NEW.status, 'priority', NEW.priority,
        'assignee_id', NEW.assignee_id, 'due_date', NEW.due_date,
        'estimated_hours', NEW.estimated_hours, 'project_id', NEW.project_id
      )
    );
    return NEW;
  end if;

  if NEW.status is distinct from OLD.status then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values (
      'task', NEW.id, auth.uid(),
      case
        when NEW.status = 'completed' then 'completed'
        when OLD.status = 'completed' then 'reopened'
        else 'status_changed'
      end,
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status)
    );
  end if;

  if NEW.priority is distinct from OLD.priority then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('task', NEW.id, auth.uid(), 'priority_changed',
            jsonb_build_object('priority', OLD.priority), jsonb_build_object('priority', NEW.priority));
  end if;

  if NEW.assignee_id is distinct from OLD.assignee_id then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('task', NEW.id, auth.uid(), 'assignee_changed',
            jsonb_build_object('assignee_id', OLD.assignee_id),
            jsonb_build_object('assignee_id', NEW.assignee_id));
  end if;

  if NEW.due_date is distinct from OLD.due_date then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('task', NEW.id, auth.uid(), 'due_date_changed',
            jsonb_build_object('due_date', OLD.due_date), jsonb_build_object('due_date', NEW.due_date));
  end if;

  if NEW.blocker_note is distinct from OLD.blocker_note and NEW.blocker_note is not null then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('task', NEW.id, auth.uid(), 'blocker_changed',
            jsonb_build_object('blocker_note', OLD.blocker_note),
            jsonb_build_object('blocker_note', NEW.blocker_note));
  end if;

  if NEW.project_id is distinct from OLD.project_id then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('task', NEW.id, auth.uid(), 'project_changed',
            jsonb_build_object('project_id', OLD.project_id),
            jsonb_build_object('project_id', NEW.project_id));
  end if;

  if NEW.reviewer_id is distinct from OLD.reviewer_id then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('task', NEW.id, auth.uid(), 'reviewer_changed',
            jsonb_build_object('reviewer_id', OLD.reviewer_id),
            jsonb_build_object('reviewer_id', NEW.reviewer_id));
  end if;

  return NEW;
end;
$$;

create or replace function public.app_log_project()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, new_value)
    values ('project', NEW.id, auth.uid(), 'project_created',
            jsonb_build_object('code', NEW.code, 'name', NEW.name, 'status', NEW.status));
    return NEW;
  end if;
  if NEW.status is distinct from OLD.status then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('project', NEW.id, auth.uid(), 'project_status_changed',
            jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status));
  end if;
  if NEW.priority is distinct from OLD.priority then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('project', NEW.id, auth.uid(), 'priority_changed',
            jsonb_build_object('priority', OLD.priority), jsonb_build_object('priority', NEW.priority));
  end if;
  if NEW.manager_id is distinct from OLD.manager_id then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('project', NEW.id, auth.uid(), 'manager_changed',
            jsonb_build_object('manager_id', OLD.manager_id), jsonb_build_object('manager_id', NEW.manager_id));
  end if;
  if NEW.target_date is distinct from OLD.target_date then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('project', NEW.id, auth.uid(), 'target_date_changed',
            jsonb_build_object('target_date', OLD.target_date), jsonb_build_object('target_date', NEW.target_date));
  end if;
  if NEW.progress_override is distinct from OLD.progress_override then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('project', NEW.id, auth.uid(), 'progress_override_changed',
            jsonb_build_object('progress_override', OLD.progress_override),
            jsonb_build_object('progress_override', NEW.progress_override, 'reason', NEW.progress_override_reason));
  end if;
  if NEW.is_archived is distinct from OLD.is_archived then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('project', NEW.id, auth.uid(), 'archive_changed',
            jsonb_build_object('is_archived', OLD.is_archived), jsonb_build_object('is_archived', NEW.is_archived));
  end if;
  return NEW;
end;
$$;

create or replace function public.app_log_profile()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, new_value)
    values ('profile', NEW.id, auth.uid(), 'profile_created',
            jsonb_build_object('employee_code', NEW.employee_code, 'full_name', NEW.full_name, 'role', NEW.role));
    return NEW;
  end if;
  if NEW.role is distinct from OLD.role then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('profile', NEW.id, auth.uid(), 'role_changed',
            jsonb_build_object('role', OLD.role), jsonb_build_object('role', NEW.role));
  end if;
  if NEW.is_active is distinct from OLD.is_active then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('profile', NEW.id, auth.uid(),
            case when NEW.is_active then 'reactivated' else 'deactivated' end,
            jsonb_build_object('is_active', OLD.is_active), jsonb_build_object('is_active', NEW.is_active));
  end if;
  if NEW.reporting_manager_id is distinct from OLD.reporting_manager_id then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('profile', NEW.id, auth.uid(), 'reporting_manager_changed',
            jsonb_build_object('reporting_manager_id', OLD.reporting_manager_id),
            jsonb_build_object('reporting_manager_id', NEW.reporting_manager_id));
  end if;
  return NEW;
end;
$$;

create or replace function public.app_log_milestone()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, new_value)
    values ('milestone', NEW.id, auth.uid(), 'milestone_created',
            jsonb_build_object('title', NEW.title, 'due_date', NEW.due_date, 'project_id', NEW.project_id));
    return NEW;
  end if;
  if NEW.completed_at is distinct from OLD.completed_at then
    insert into public.activity_log (entity_type, entity_id, actor_id, action, old_value, new_value)
    values ('milestone', NEW.id, auth.uid(),
            case when NEW.completed_at is not null then 'milestone_completed' else 'milestone_reopened' end,
            jsonb_build_object('completed_at', OLD.completed_at),
            jsonb_build_object('completed_at', NEW.completed_at));
  end if;
  return NEW;
end;
$$;

create or replace function public.app_profile_guard()
returns trigger
language plpgsql
as $$
declare
  u uuid := auth.uid();
  r public.user_role;
begin
  if TG_OP = 'UPDATE' then
    if NEW.id <> OLD.id then
      raise exception 'A profile id cannot change';
    end if;
    if u is null then
      return NEW;
    end if;
    select p.role into r from public.profiles p where p.id = u and p.is_active;
    if r is null then
      raise exception 'Your account is not active' using errcode = '42501';
    end if;
    if r <> 'admin' then
      if NEW.role is distinct from OLD.role or NEW.is_active is distinct from OLD.is_active
        or NEW.employee_code is distinct from OLD.employee_code or NEW.work_email is distinct from OLD.work_email then
        raise exception 'Only the business owner can change role, status, employee code or work email'
          using errcode = '42501';
      end if;
      if NEW.id <> u and r = 'employee' then
        raise exception 'Employees cannot edit other profiles' using errcode = '42501';
      end if;
    end if;
  end if;
  return NEW;
end;
$$;

create or replace function public.app_dependency_guard()
returns trigger
language plpgsql
as $$
declare
  v_hits integer;
begin
  if NEW.task_id = NEW.depends_on_task_id then
    raise exception 'A task cannot depend on itself';
  end if;
  with recursive walk(node, lvl) as (
    select td.depends_on_task_id, 1
    from public.task_dependencies td
    where td.task_id = NEW.depends_on_task_id
    union all
    select td.depends_on_task_id, w.lvl + 1
    from public.task_dependencies td
    join walk w on td.task_id = w.node
    where w.lvl < 100
  )
  select count(*) into v_hits from walk where node = NEW.task_id;
  if v_hits > 0 then
    raise exception 'Circular dependency detected' using errcode = '23514';
  end if;
  return NEW;
end;
$$;

create or replace function public.app_protect_activity_log()
returns trigger
language plpgsql
as $$
begin
  raise exception 'activity_log is append-only' using errcode = '42501';
end;
$$;

create or replace function public.app_on_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_email text;
  v_name text;
begin
  v_email := lower(coalesce(NEW.email, ''));
  if nullif(btrim(v_email), '') is null then
    return NEW;
  end if;
  v_name := coalesce(
    nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'full_name', '')), ''),
    initcap(replace(split_part(v_email, '@', 1), '.', ' '))
  );
  insert into public.profiles (id, full_name, work_email, department, designation)
  values (
    NEW.id,
    left(v_name, 120),
    left(v_email, 254),
    nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'department', '')), ''),
    nullif(btrim(coalesce(NEW.raw_user_meta_data ->> 'designation', '')), '')
  )
  on conflict (id) do nothing;
  return NEW;
end;
$$;

create trigger task_guard before insert or update on public.tasks
  for each row execute function public.app_task_guard();

create trigger task_activity after insert or update on public.tasks
  for each row execute function public.app_log_task();

create trigger project_activity after insert or update on public.projects
  for each row execute function public.app_log_project();

create trigger profile_guard before insert or update on public.profiles
  for each row execute function public.app_profile_guard();

create trigger profile_activity after insert or update on public.profiles
  for each row execute function public.app_log_profile();

create trigger milestone_activity after insert or update on public.milestones
  for each row execute function public.app_log_milestone();

create trigger dependency_guard before insert or update on public.task_dependencies
  for each row execute function public.app_dependency_guard();

create trigger activity_log_append_only before update or delete on public.activity_log
  for each row execute function public.app_protect_activity_log();

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.app_on_auth_user_created();

revoke execute on function public.app_log_task() from public, anon, authenticated, service_role;
revoke execute on function public.app_log_project() from public, anon, authenticated, service_role;
revoke execute on function public.app_log_profile() from public, anon, authenticated, service_role;
revoke execute on function public.app_log_milestone() from public, anon, authenticated, service_role;
revoke execute on function public.app_on_auth_user_created() from public, anon, authenticated, service_role;
