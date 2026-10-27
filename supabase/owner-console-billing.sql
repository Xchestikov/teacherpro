-- Owner-managed platform receipts. Teacher turnover is never treated as TeacherPro revenue.
create table if not exists public.tp_platform_receipts (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id),
  plan_code text not null references public.tp_platform_plans(code),
  amount_rub numeric(12,2) not null check (amount_rub>0 and amount_rub<=1000000),
  received_on date not null,
  method text not null default 'manual' check (method in ('manual','bank','other')),
  note text not null default '' check (char_length(note)<=300),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.tp_platform_receipts enable row level security;
revoke all on public.tp_platform_receipts from anon,authenticated,public;
grant select on public.tp_platform_receipts to authenticated;
grant all on public.tp_platform_receipts to service_role;
drop policy if exists tp_receipts_teacher_own on public.tp_platform_receipts;
create policy tp_receipts_teacher_own on public.tp_platform_receipts for select to authenticated
  using(teacher_id=(select auth.uid()));
create index if not exists tp_receipts_date_idx on public.tp_platform_receipts(received_on desc);
create index if not exists tp_receipts_teacher_idx on public.tp_platform_receipts(teacher_id);
alter table public.tp_teacher_control add column if not exists plan_until date;
