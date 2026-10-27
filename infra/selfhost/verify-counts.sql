-- Run as database administrator on BOTH old and new Supabase databases.
-- Prints counts only; no emails, student names, Telegram IDs, or payloads.
-- A matching count is necessary, not sufficient: additionally verify login,
-- subscriptions, financial calculations, Telegram roles, RLS and permissions.
SELECT 'auth.users' AS source, count(*)::bigint AS rows FROM auth.users
UNION ALL SELECT 'auth.identities',count(*) FROM auth.identities
UNION ALL SELECT 'public.app_data',count(*) FROM public.app_data
UNION ALL SELECT 'public.tp_platform_admins',count(*) FROM public.tp_platform_admins
UNION ALL SELECT 'public.tp_teacher_control',count(*) FROM public.tp_teacher_control
UNION ALL SELECT 'public.tp_admin_audit',count(*) FROM public.tp_admin_audit
UNION ALL SELECT 'public.tp_telegram_links',count(*) FROM public.tp_telegram_links
UNION ALL SELECT 'public.tp_telegram_invites',count(*) FROM public.tp_telegram_invites
UNION ALL SELECT 'public.tp_telegram_delivery',count(*) FROM public.tp_telegram_delivery
UNION ALL SELECT 'public.tp_telegram_processed_updates',count(*) FROM public.tp_telegram_processed_updates
UNION ALL SELECT 'public.tp_telegram_lesson_state',count(*) FROM public.tp_telegram_lesson_state
UNION ALL SELECT 'public.tp_telegram_lesson_requests',count(*) FROM public.tp_telegram_lesson_requests
UNION ALL SELECT 'public.tp_telegram_prefs',count(*) FROM public.tp_telegram_prefs
UNION ALL SELECT 'public.tp_platform_flags',count(*) FROM public.tp_platform_flags
UNION ALL SELECT 'public.tp_platform_plans',count(*) FROM public.tp_platform_plans
UNION ALL SELECT 'public.tp_platform_receipts',count(*) FROM public.tp_platform_receipts
UNION ALL SELECT 'public.tp_support_tickets',count(*) FROM public.tp_support_tickets
UNION ALL SELECT 'storage.objects',count(*) FROM storage.objects
ORDER BY source;
