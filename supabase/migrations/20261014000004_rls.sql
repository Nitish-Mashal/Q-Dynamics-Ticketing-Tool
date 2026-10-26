grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.checklist_items enable row level security;
alter table public.comments enable row level security;
alter table public.attachments enable row level security;
alter table public.activity_log enable row level security;
alter table public.notifications enable row level security;
alter table public.weekly_reviews enable row level security;
alter table public.monthly_reviews enable row level security;

create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or public.app_role() in ('admin', 'manager')
    or exists (
      select 1
      from public.project_members mine
      join public.project_members theirs on theirs.project_id = mine.project_id
      where mine.user_id = auth.uid() and theirs.user_id = public.profiles.id
    )
  );

create policy profiles_insert on public.profiles
  for insert with check (public.app_role() = 'admin');

create policy profiles_update on public.profiles
  for update using (
    id = auth.uid()
    or public.app_role() = 'admin'
    or (public.app_role() = 'manager' and reporting_manager_id = public.app_uid())
  )
  with check (
    id = auth.uid()
    or public.app_role() = 'admin'
    or public.app_role() = 'manager'
  );

create policy projects_select on public.projects
  for select using (
    public.app_role() = 'admin'
    or manager_id = public.app_uid()
    or owner_id = public.app_uid()
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = public.projects.id and pm.user_id = public.app_uid()
    )
    or exists (
      select 1 from public.tasks t
      where t.project_id = public.projects.id and t.assignee_id = public.app_uid()
    )
  );

create policy projects_insert on public.projects
  for insert with check (
    public.app_role() = 'admin'
    or manager_id = public.app_uid()
    or owner_id = public.app_uid()
  );

create policy projects_update on public.projects
  for update using (
    public.app_role() = 'admin'
    or manager_id = public.app_uid()
    or owner_id = public.app_uid()
  )
  with check (
    public.app_role() = 'admin'
    or manager_id = public.app_uid()
    or owner_id = public.app_uid()
  );

create policy projects_delete on public.projects
  for delete using (
    public.app_role() = 'admin'
    or manager_id = public.app_uid()
  );

create policy project_members_select on public.project_members
  for select using (
    public.app_member_of_project(project_id)
    or user_id = public.app_uid()
  );

create policy project_members_write on public.project_members
  for insert with check (public.app_manages_project(project_id));

create policy project_members_update on public.project_members
  for update using (public.app_manages_project(project_id))
  with check (public.app_manages_project(project_id));

create policy project_members_delete on public.project_members
  for delete using (public.app_manages_project(project_id));

create policy milestones_select on public.milestones
  for select using (
    public.app_member_of_project(project_id)
    or exists (
      select 1 from public.tasks t
      where t.project_id = public.milestones.project_id and t.assignee_id = public.app_uid()
    )
  );

create policy milestones_write on public.milestones
  for insert with check (public.app_manages_project(project_id));

create policy milestones_update on public.milestones
  for update using (public.app_manages_project(project_id))
  with check (public.app_manages_project(project_id));

create policy milestones_delete on public.milestones
  for delete using (public.app_manages_project(project_id));

create policy tasks_select on public.tasks
  for select using (
    public.app_task_visible(project_id, assignee_id, creator_id, reviewer_id, is_private)
  );

create policy tasks_insert on public.tasks
  for insert with check (public.app_uid() is not null);

create policy tasks_update on public.tasks
  for update using (
    public.app_task_editable(project_id, assignee_id, creator_id, reviewer_id, is_private)
  )
  with check (public.app_uid() is not null);

create policy tasks_delete on public.tasks
  for delete using (
    (project_id is null and assignee_id = public.app_uid())
    or public.app_role() = 'admin'
    or public.app_manages_project(project_id)
  );

create policy task_dependencies_select on public.task_dependencies
  for select using (
    public.app_can_view_task(task_id)
    and public.app_can_view_task(depends_on_task_id)
  );

create policy task_dependencies_insert on public.task_dependencies
  for insert with check (
    public.app_can_edit_task(task_id)
    and public.app_can_view_task(depends_on_task_id)
  );

create policy task_dependencies_update on public.task_dependencies
  for update using (public.app_can_edit_task(task_id))
  with check (
    public.app_can_edit_task(task_id)
    and public.app_can_view_task(depends_on_task_id)
  );

create policy task_dependencies_delete on public.task_dependencies
  for delete using (public.app_can_edit_task(task_id));

create policy checklist_select on public.checklist_items
  for select using (public.app_can_view_task(task_id));

create policy checklist_insert on public.checklist_items
  for insert with check (public.app_can_edit_task(task_id));

create policy checklist_update on public.checklist_items
  for update using (public.app_can_edit_task(task_id))
  with check (public.app_can_edit_task(task_id));

create policy checklist_delete on public.checklist_items
  for delete using (public.app_can_edit_task(task_id));

create policy comments_select on public.comments
  for select using (
    (task_id is not null and public.app_can_view_task(task_id))
    or (project_id is not null and public.app_member_of_project(project_id))
  );

create policy comments_insert on public.comments
  for insert with check (
    author_id = public.app_uid()
    and (
      (task_id is not null and public.app_can_view_task(task_id))
      or (project_id is not null and public.app_member_of_project(project_id))
    )
  );

create policy comments_update on public.comments
  for update using (author_id = public.app_uid() or public.app_role() = 'admin')
  with check (author_id = public.app_uid() or public.app_role() = 'admin');

create policy comments_delete on public.comments
  for delete using (author_id = public.app_uid() or public.app_role() = 'admin');

create policy attachments_select on public.attachments
  for select using (
    (task_id is not null and public.app_can_view_task(task_id))
    or (project_id is not null and public.app_member_of_project(project_id))
  );

create policy attachments_insert on public.attachments
  for insert with check (
    uploader_id = public.app_uid()
    and (
      (task_id is not null and public.app_can_edit_task(task_id))
      or (project_id is not null and public.app_manages_project(project_id))
    )
  );

create policy attachments_delete on public.attachments
  for delete using (uploader_id = public.app_uid() or public.app_role() = 'admin');

create policy activity_select on public.activity_log
  for select using (
    public.app_role() = 'admin'
    or (entity_type = 'task' and exists (
      select 1 from public.tasks t where t.id = public.activity_log.entity_id
    ))
    or (entity_type = 'project' and exists (
      select 1 from public.projects p where p.id = public.activity_log.entity_id
    ))
    or (entity_type = 'milestone' and exists (
      select 1 from public.milestones m where m.id = public.activity_log.entity_id
    ))
    or (entity_type = 'profile' and (
      entity_id = public.app_uid()
      or actor_id = public.app_uid()
      or public.app_role() in ('admin', 'manager')
    ))
    or (entity_type = 'comment' and exists (
      select 1 from public.comments c where c.id = public.activity_log.entity_id
    ))
  );

create policy notifications_select on public.notifications
  for select using (user_id = public.app_uid());

create policy notifications_update on public.notifications
  for update using (user_id = public.app_uid())
  with check (user_id = public.app_uid());

create policy notifications_delete on public.notifications
  for delete using (user_id = public.app_uid());

create policy weekly_reviews_select on public.weekly_reviews
  for select using (user_id = public.app_uid() or public.app_role() in ('admin', 'manager'));

create policy weekly_reviews_insert on public.weekly_reviews
  for insert with check (user_id = public.app_uid() or public.app_role() in ('admin', 'manager'));

create policy weekly_reviews_update on public.weekly_reviews
  for update using (user_id = public.app_uid() or public.app_role() in ('admin', 'manager'))
  with check (user_id = public.app_uid() or public.app_role() in ('admin', 'manager'));

create policy weekly_reviews_delete on public.weekly_reviews
  for delete using (user_id = public.app_uid() or public.app_role() = 'admin');

create policy monthly_reviews_select on public.monthly_reviews
  for select using (user_id = public.app_uid() or public.app_role() in ('admin', 'manager'));

create policy monthly_reviews_insert on public.monthly_reviews
  for insert with check (user_id = public.app_uid() or public.app_role() in ('admin', 'manager'));

create policy monthly_reviews_update on public.monthly_reviews
  for update using (user_id = public.app_uid() or public.app_role() in ('admin', 'manager'))
  with check (user_id = public.app_uid() or public.app_role() in ('admin', 'manager'));

create policy monthly_reviews_delete on public.monthly_reviews
  for delete using (user_id = public.app_uid() or public.app_role() = 'admin');
