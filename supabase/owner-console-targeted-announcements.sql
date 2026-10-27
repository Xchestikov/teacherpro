-- Teacher-targeted platform banners. Service role controls all writes; teachers read only own overrides.
create table if not exists public.tp_platform_flag_overrides (
 teacher_id uuid not null references auth.users(id) on delete cascade,
 key text not null references public.tp_platform_flags(key) on delete cascade,
 enabled boolean not null,
 value text not null default '' check(char_length(value)<=240),
 updated_at timestamptz not null default now(),
 primary key(teacher_id,key)
);
alter table public.tp_platform_flag_overrides enable row level security;
revoke all on public.tp_platform_flag_overrides from anon,authenticated,public;
grant select on public.tp_platform_flag_overrides to authenticated;
grant all on public.tp_platform_flag_overrides to service_role;
drop policy if exists tp_flag_overrides_teacher_read on public.tp_platform_flag_overrides;
create policy tp_flag_overrides_teacher_read on public.tp_platform_flag_overrides for select to authenticated
using(teacher_id=(select auth.uid()));
