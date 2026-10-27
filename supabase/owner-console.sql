-- TeacherPro owner console v1. No destructive changes to existing teacher payloads.
create table if not exists public.tp_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check(role in ('owner','admin')),
  created_at timestamptz not null default now()
);
alter table public.tp_platform_admins enable row level security;
revoke all on public.tp_platform_admins from anon, public;
grant select on public.tp_platform_admins to authenticated;
drop policy if exists tp_admin_read_self on public.tp_platform_admins;
create policy tp_admin_read_self on public.tp_platform_admins for select to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.tp_teacher_control (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check(status in ('active','suspended')),
  plan_code text not null default 'free',
  updated_at timestamptz not null default now()
);
alter table public.tp_teacher_control enable row level security;
revoke all on public.tp_teacher_control from anon, public;
grant select on public.tp_teacher_control to authenticated;
drop policy if exists tp_teacher_control_self on public.tp_teacher_control;
create policy tp_teacher_control_self on public.tp_teacher_control for select to authenticated using ((select auth.uid())=user_id);

create table if not exists public.tp_platform_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{2,49}$'),
  enabled boolean not null default false,
  description text not null default '',
  value text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.tp_platform_flags enable row level security;
revoke all on public.tp_platform_flags from anon, public;
grant select on public.tp_platform_flags to authenticated;
drop policy if exists tp_flags_read on public.tp_platform_flags;
create policy tp_flags_read on public.tp_platform_flags for select to authenticated using (true);

insert into public.tp_platform_flags(key,enabled,description,value) values
  ('support_requests',true,'Обращения преподавателей в поддержку',''),
  ('maintenance_banner',false,'Показать всем преподавателям техническое объявление','В TeacherPro проводятся технические работы.')
on conflict(key) do nothing;

create table if not exists public.tp_platform_plans(
  code text primary key check(code ~ '^[a-z][a-z0-9_]{1,29}$'),
  title text not null,
  price_rub numeric(12,2) not null default 0 check(price_rub>=0),
  period text not null default 'month' check(period in ('month','year','manual')),
  max_students integer not null default 0 check(max_students>=0),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.tp_platform_plans enable row level security;
revoke all on public.tp_platform_plans from anon, public;
grant select on public.tp_platform_plans to authenticated;
drop policy if exists tp_plans_read on public.tp_platform_plans;
create policy tp_plans_read on public.tp_platform_plans for select to authenticated using(enabled);
insert into public.tp_platform_plans(code,title,price_rub,period,max_students,enabled) values
  ('free','Бесплатный',0,'month',0,true),
  ('pro','TeacherPro Pro',0,'manual',0,false)
on conflict(code) do nothing;

create table if not exists public.tp_support_tickets(
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'question' check(category in ('question','bug','idea','billing')),
  subject text not null check(char_length(subject) between 3 and 140),
  message text not null check(char_length(message) between 10 and 3000),
  status text not null default 'new' check(status in ('new','in_progress','resolved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tp_support_tickets enable row level security;
revoke all on public.tp_support_tickets from anon, public;
grant select,insert on public.tp_support_tickets to authenticated;
drop policy if exists tp_tickets_read_own on public.tp_support_tickets;
create policy tp_tickets_read_own on public.tp_support_tickets for select to authenticated using(teacher_id=(select auth.uid()));
drop policy if exists tp_tickets_insert_own on public.tp_support_tickets;
create policy tp_tickets_insert_own on public.tp_support_tickets for insert to authenticated
with check (teacher_id=(select auth.uid()) and status='new' and exists(select 1 from public.tp_platform_flags where key='support_requests' and enabled));

create table if not exists public.tp_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  action text not null,
  target text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.tp_admin_audit enable row level security;
revoke all on public.tp_admin_audit from anon, public;
create index if not exists tp_admin_audit_created_idx on public.tp_admin_audit(created_at desc);
create index if not exists tp_tickets_created_idx on public.tp_support_tickets(created_at desc);
create index if not exists tp_tickets_teacher_idx on public.tp_support_tickets(teacher_id);

-- Suspended teachers cannot fetch or modify their cloud workspace even with a direct API call.
-- Missing tp_teacher_control rows are active by default, preserving existing teachers.
drop policy if exists "Users can read own app data" on public.app_data;
create policy "Users can read own app data" on public.app_data for select to authenticated
using (user_id=(select auth.uid()) and not exists(
  select 1 from public.tp_teacher_control ctl where ctl.user_id=(select auth.uid()) and ctl.status='suspended'
));
drop policy if exists "Users can insert own app data" on public.app_data;
create policy "Users can insert own app data" on public.app_data for insert to authenticated
with check (user_id=(select auth.uid()) and not exists(
  select 1 from public.tp_teacher_control ctl where ctl.user_id=(select auth.uid()) and ctl.status='suspended'
));
drop policy if exists "Users can update own app data" on public.app_data;
create policy "Users can update own app data" on public.app_data for update to authenticated
using (user_id=(select auth.uid()) and not exists(
  select 1 from public.tp_teacher_control ctl where ctl.user_id=(select auth.uid()) and ctl.status='suspended'
))
with check (user_id=(select auth.uid()) and not exists(
  select 1 from public.tp_teacher_control ctl where ctl.user_id=(select auth.uid()) and ctl.status='suspended'
));
