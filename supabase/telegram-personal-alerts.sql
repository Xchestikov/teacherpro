-- Individual Telegram notification preferences, backward-compatible with all existing links.
-- NULL means "inherit the existing teacher-level setting", so existing behavior never changes.
alter table public.tp_telegram_links
  add column if not exists reminder_24h_override boolean,
  add column if not exists reminder_2h_override boolean,
  add column if not exists changes_override boolean;
-- No extra grants/policies. Only service_role may update these columns;
-- teacher RLS access remains read-only and students/parents have no DB identity.
comment on column public.tp_telegram_links.reminder_24h_override is
  'Per-Telegram-link 24 hour reminder preference; NULL inherits teacher default';
comment on column public.tp_telegram_links.reminder_2h_override is
  'Per-Telegram-link 2 hour reminder preference; NULL inherits teacher default';
comment on column public.tp_telegram_links.changes_override is
  'Per-Telegram-link schedule-change alert preference; NULL inherits teacher default';
