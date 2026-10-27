-- Tighten privileges: Supabase public-schema default grants can include authenticated writes.
revoke all on public.tp_platform_admins,public.tp_teacher_control,public.tp_platform_flags,
  public.tp_platform_plans,public.tp_support_tickets,public.tp_admin_audit from anon,authenticated,public;
grant select on public.tp_platform_admins,public.tp_teacher_control,public.tp_platform_flags,
  public.tp_platform_plans,public.tp_support_tickets to authenticated;
grant insert on public.tp_support_tickets to authenticated;
-- Elevated server token remains the only writer of admin-controlled tables.
grant all on public.tp_platform_admins,public.tp_teacher_control,public.tp_platform_flags,
  public.tp_platform_plans,public.tp_support_tickets,public.tp_admin_audit to service_role;
grant usage,select on sequence public.tp_admin_audit_id_seq to service_role;
