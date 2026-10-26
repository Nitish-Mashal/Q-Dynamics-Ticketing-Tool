create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  employee_code text not null unique
    default ('QB-' || lpad(nextval('public.profile_code_seq')::text, 3, '0'))
    check (employee_code ~ '^QB-[0-9]{3,4}$'),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  work_email text not null unique check (work_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  department text check (department is null or char_length(department) <= 80),
  designation text check (designation is null or char_length(designation) <= 80),
  reporting_manager_id uuid references public.profiles (id) on delete set null,
  role public.user_role not null default 'employee',
  is_active boolean not null default true,
  timezone text not null default 'Asia/Kolkata' check (char_length(timezone) between 1 and 60),
  reminder_preference public.reminder_preference not null default 'on_due_date',
  created_at timestamptz not null default now(),
  constraint profile_not_own_manager check (reporting_manager_id is null or reporting_manager_id <> id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^PRJ-[0-9]{3,}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text,
  objectives text,
  owner_id uuid not null references public.profiles (id) on delete restrict,
  manager_id uuid not null references public.profiles (id) on delete restrict,
  category text check (category is null or char_length(category) <= 80),
  priority public.priority_level not null default 'medium',
  status public.project_status not null default 'planning',
  start_date date,
  target_date date,
  budget numeric(14, 2) check (budget is null or budget >= 0),
  progress_override integer check (progress_override is null or progress_override between 0 and 100),
  progress_override_reason text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  constraint project_dates check (start_date is null or target_date is null or target_date >= start_date),
  constraint project_override_reason check (progress_override is null or nullif(btrim(progress_override_reason), '') is not null)
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  responsibility text check (responsibility is null or char_length(responsibility) <= 160),
  primary key (project_id, user_id)
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  due_date date,
  completed_at timestamptz
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects (id) on delete cascade,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text,
  category text check (category is null or char_length(category) <= 80),
  tags text[] not null default '{}',
  priority public.priority_level not null default 'medium',
  status public.task_status not null default 'not_started',
  assignee_id uuid not null references public.profiles (id) on delete restrict,
  creator_id uuid not null references public.profiles (id) on delete restrict,
  reviewer_id uuid references public.profiles (id) on delete set null,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz,
  expected_deliverable text,
  start_date date,
  due_date date,
  start_time time,
  end_time time,
  estimated_hours numeric(6, 2) check (estimated_hours is null or estimated_hours >= 0),
  actual_hours numeric(6, 2) check (actual_hours is null or actual_hours >= 0),
  progress integer not null default 0 check (progress between 0 and 100),
  blocker_note text,
  completed_at timestamptz,
  recurrence jsonb,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_dates check (start_date is null or due_date is null or due_date >= start_date),
  constraint task_completed_flag check ((status = 'completed') = (completed_at is not null)),
  constraint task_blocker_note check (status <> 'blocked' or nullif(btrim(coalesce(blocker_note, '')), '') is not null),
  constraint task_recurrence_object check (recurrence is null or jsonb_typeof(recurrence) = 'object'),
  constraint task_time_order check (start_time is null or end_time is null or end_time > start_time)
);

create table public.task_dependencies (
  task_id uuid not null references public.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  constraint task_dep_no_self check (task_id <> depends_on_task_id)
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 500),
  is_done boolean not null default false,
  position integer not null default 0
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint comment_one_target check ((case when task_id is not null then 1 else 0 end + case when project_id is not null then 1 else 0 end) = 1)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  uploader_id uuid not null references public.profiles (id) on delete restrict,
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  file_size bigint check (file_size is null or file_size > 0),
  content_type text check (content_type is null or char_length(content_type) <= 160),
  created_at timestamptz not null default now(),
  constraint attachment_one_target check ((case when task_id is not null then 1 else 0 end + case when project_id is not null then 1 else 0 end) = 1)
);

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('task', 'project', 'milestone', 'profile', 'project_member', 'comment', 'attachment', 'review')),
  entity_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) between 1 and 64),
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
  kind public.notification_kind not null,
  message text not null check (char_length(btrim(message)) between 1 and 500),
  dedupe_key text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  accomplishments text,
  next_week_priorities text,
  manager_notes text,
  carried_forward_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table public.monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  month_start date not null,
  objectives jsonb not null default '[]'::jsonb,
  accomplishments text,
  next_month_priorities text,
  manager_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month_start)
);

create index profiles_role_idx on public.profiles (role);
create index profiles_manager_idx on public.profiles (reporting_manager_id);
create index projects_manager_idx on public.projects (manager_id);
create index projects_owner_idx on public.projects (owner_id);
create index projects_status_idx on public.projects (status);
create index project_members_user_idx on public.project_members (user_id);
create index milestones_project_idx on public.milestones (project_id, due_date);
create index tasks_assignee_idx on public.tasks (assignee_id, status);
create index tasks_project_idx on public.tasks (project_id, status);
create index tasks_parent_idx on public.tasks (parent_task_id);
create index tasks_due_idx on public.tasks (due_date);
create index tasks_reviewer_idx on public.tasks (reviewer_id);
create index task_dependencies_depends_idx on public.task_dependencies (depends_on_task_id);
create index checklist_task_idx on public.checklist_items (task_id, position);
create index comments_task_idx on public.comments (task_id, created_at);
create index comments_project_idx on public.comments (project_id, created_at);
create index attachments_task_idx on public.attachments (task_id);
create index attachments_project_idx on public.attachments (project_id);
create index activity_entity_idx on public.activity_log (entity_type, entity_id, created_at);
create index activity_actor_idx on public.activity_log (actor_id, created_at);
create index notifications_user_idx on public.notifications (user_id, is_read, created_at);
create index weekly_reviews_user_idx on public.weekly_reviews (user_id, week_start);
create index monthly_reviews_user_idx on public.monthly_reviews (user_id, month_start);
