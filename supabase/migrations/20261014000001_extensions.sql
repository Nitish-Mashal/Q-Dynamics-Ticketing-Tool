create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'manager', 'employee');

create type public.priority_level as enum ('critical', 'high', 'medium', 'low');

create type public.project_status as enum (
  'planning',
  'not_started',
  'in_progress',
  'on_hold',
  'at_risk',
  'completed',
  'cancelled'
);

create type public.task_status as enum (
  'not_started',
  'in_progress',
  'on_hold',
  'blocked',
  'completed',
  'cancelled'
);

create type public.notification_kind as enum (
  'task_assigned',
  'task_reassigned',
  'priority_changed',
  'comment',
  'mention',
  'blocked',
  'awaiting_approval',
  'milestone_update',
  'due_soon',
  'overdue'
);

create type public.reminder_preference as enum ('on_due_date', 'one_day_before', 'three_days_before');

create sequence public.profile_code_seq as integer start 1;
