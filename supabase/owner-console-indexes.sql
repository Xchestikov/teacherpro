-- Add supporting indexes for Owner Console audit and manual billing relations.
create index if not exists tp_admin_audit_actor_idx on public.tp_admin_audit(actor_id);
create index if not exists tp_receipts_creator_idx on public.tp_platform_receipts(created_by);
create index if not exists tp_receipts_plan_idx on public.tp_platform_receipts(plan_code);
create index if not exists tp_receipts_voided_by_idx on public.tp_platform_receipts(voided_by);
