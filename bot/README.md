# TeacherPro Telegram Bot — stage 1

Node.js 22+, **zero runtime npm dependencies**, port 3017 localhost only.
Backend source is versioned separately from static TeacherPro.

## Secure activation prerequisites
1. Create one bot with official @BotFather. Do **not** paste the bot token into chat, browser settings, source code or GitHub.
2. On FirstVDS, provision `/etc/teacherpro-bot.env`, owned by root with mode 0600, containing:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET` (random A-Za-z0-9_- 32+ chars),
   `TELEGRAM_WEBHOOK_URL=https://teacherpro-app.ru/telegram/webhook`,
   optionally `TP_BOT_PORT=3017`.
   Verify the secret is *not* printed in logs.
3. Apply `supabase/telegram-stage1.sql` in the correct Supabase project (additive migration, RLS).
4. Include `bot/nginx-location.conf` inside the existing Nginx HTTPS server block.
   Before reload, run `sudo nginx -t`; never replace the full server configuration.
5. The code-deploy workflow stages the bot in `/opt/teacherpro-bot/current`.
   Install `bot/teacherpro-bot.service` and create a locked-down `teacherpro-bot` system user.
   Only enable and start the service when credentials and Nginx are ready.
6. Set the *public username only* in `telegram-config.js` as
   `window.TP_TELEGRAM_BOT_USERNAME = 'your_bot_username'`;
   commit to main and deploy frontend. **The token must never go in this file**.
7. Register webhook using
   `sudo node --env-file=/etc/teacherpro-bot.env /opt/teacherpro-bot/current/setup-webhook.mjs`.
   Confirm Telegram setWebhook succeeds and then test a private /start command.
8. Link a teacher through TeacherPro Settings, then link a test student via their card.
   The teacher must approve the student link. Verify cross-account isolation.

## Operational safeguards
- Service role key is used server-side only. No authenticated user can read the invitations or delivery queue.
- Every bot callback rechecks that the requesting Telegram user owns an active link.
- Students see only upcoming lessons with matching student_id, never finance/notes/contacts.
- Original app_data JSON is read-only for the bot; finances and subscriptions are unaffected.
- Scheduling polls once per minute. Reminders are sent during a 4-minute window after becoming due. Downtime >4 minutes may skip a reminder; monitor service uptime.
- On first run, existing lessons are used as a baseline: no bulk historic notifications.
- Idempotency: updates and per-link notification keys; failed delivery retries with cooldown.
- Permissions can be revoked in TeacherPro immediately; a revoked link cannot query data.
- If a user blocks the bot, future push notifications are disabled until re-enabled.
- For change alerts the worker tracks planned/cancelled lessons from 2 days ago to 30 days ahead. Full hard-deletion without status is not guaranteed to trigger an alert; TeacherPro normally marks deletions by status.

## CI
`node --test bot/bot.test.mjs`
`node --check bot/server.mjs`
Browser and mobile tests run independently using mocked Supabase data.

## Rollback
The prior static FirstVDS release remains available. For the bot,
stop and disable `teacherpro-bot.service`, unset the Telegram webhook via BotFather/Telegram API
if needed, and restore the previous `/opt/teacherpro-bot/current` symlink. Never delete
the persistent Telegram tables as part of rollback: delivery history prevents duplicates.
