-- Reversals preserve the audit trail; platform revenue excludes voided receipts.
alter table public.tp_platform_receipts add column if not exists voided_at timestamptz;
alter table public.tp_platform_receipts add column if not exists voided_by uuid references auth.users(id);
create index if not exists tp_receipts_active_idx on public.tp_platform_receipts(received_on desc) where voided_at is null;
