# TeacherPro Telegram Bot — stage 1

## Deployment without root or interactive SSH

TeacherPro's FirstVDS SSH deploy user has no passwordless sudo, and system Node.js
is absent. The supported stage-1 runtime is therefore a **private user crontab**
that executes the bot every minute. GitHub Actions installs a user-owned Node.js
22 binary and the backend into `~/teacherpro-bot`, using existing encrypted
SSH secrets. No webhook, public HTTP port, Nginx edits or sudo are required.

1. In GitHub repository Actions Secrets, set `TELEGRAM_BOT_TOKEN` for
   `@Assistant_Teacher_Pro_bot` and `SUPABASE_SERVICE_ROLE_KEY` from
   Supabase. Never put their values in code, issues, chat or screenshots.
2. The deployment validates the Telegram identity with `getMe`, checks that
   there is no pre-existing webhook, and verifies the Supabase role key with
   an authorized read of Telegram's isolated RLS table.
3. On FirstVDS, the deployment writes `~/teacherpro-bot/bot.env` (0600), a
   private Node binary and release source under the SSH user's own home. It
   performs a real single-shot worker run and installs a unique crontab line
   marked `# teacherpro-bot-worker` without modifying unrelated cron entries.
4. The worker uses `getUpdates` and the protected
   `tp_telegram_processed_updates` table for update de-duplication; then it
   checks schedule reminders/changes. `flock -n` prevents overlapping runs.
5. A failed credentials check, missing cron daemon, or unsuccessful worker
   run stops activation. The existing site and payments are left untouched.
6. Only after confirming the worker can run and persists across minutes,
   publish `TP_TELEGRAM_BOT_ACTIVE=true` in the public JS settings and check
   teacher/student one-time invitations from the site.

### Security and operational limits

The Supabase service key is **server-only** and grants elevated access to
TeacherPro's data. Keep it in a 0600 environment file on the VPS and in GitHub
Secrets only. The bot never writes to the existing `app_data` payload.

Teacher/student linkage is limited by row-level security and single-use tokens.
Students only see their own upcoming lessons. Reminders use an idempotency
ledger to avoid duplicates. This stage has a 60-second scheduler cadence,
not instant Telegram push. A power outage lasting longer than the four-minute
reminder grace may skip that reminder.

`node --test bot/bot.test.mjs bot/cron.test.mjs` runs all isolated server tests.
The CI suite additionally runs desktop Chromium and iPhone WebKit scenarios.

### Rollback

Remove only the managed crontab line containing `# teacherpro-bot-worker`
from the SSH user's crontab. Restore the previous release symlink if needed.
Do **not** delete Supabase Telegram tables as a rollback: their delivery and
update history is needed for deduplication. Existing site releases remain
available for rollback separately.

### Future webhook mode

The repository still contains an optional webhook server and Nginx configuration.
They are not installed without system administrator access. Telegram long polling
and webhook updates are mutually exclusive; do not activate both simultaneously.

## Telegram-only outbound proxy (one FirstVDS VPS)

Network diagnostics on the current Russian FirstVDS VPS found that HTTPS to
`api.telegram.org` times out and direct TCP connections to five Telegram
MTProto data centres (ports 443, 80 and 5222) are unavailable. Switching
the bot to MTProto **alone** cannot restore blocked network reachability.

The worker supports an **optional outbound proxy for Telegram only**.
TeacherPro's site, bot process, scheduler and all Supabase data remain in
their original locations. This does not add or require a second TeacherPro VPS.

1. Obtain a trusted reachable HTTPS CONNECT proxy (preferred) or SOCKS5H
   proxy endpoint. An existing VPN service may provide one. No public or
   unknown free proxy should be used for a service holding student data.
2. Add `TELEGRAM_PROXY_URL` to GitHub Actions repository secrets, e.g.
   `https://USERNAME:PASSWORD@proxy.example:8443` (HTTPS preferred) or
   `socks5h://USERNAME:PASSWORD@proxy.example:1080`. URL-encode special
   characters in credentials. **Never put actual values in GitHub files.**
3. Re-run the **Deploy TeacherPro Telegram backend to FirstVDS** workflow
   with `workflow_dispatch`. It writes the proxy URL only to the private
   mode-0600 server-side environment file, with the existing bot secrets.
4. The release performs a real trial worker run from FirstVDS and installs
   crontab only if it succeeds. Verify that a private, linked test account
   can issue commands and receive notifications before setting the public
   `TP_TELEGRAM_BOT_ACTIVE` flag.

The proxy never handles the application's existing Supabase requests. curl
receives the Telegram bot URL and optional proxy credentials via **stdin**,
not command-line arguments. HTTPS remains TLS-verified end-to-end. Failure
messages exclude token and proxy credentials. Socks5h proxy access credentials
may not be encrypted on the path to the proxy, so prefer HTTPS CONNECT.

If no such trusted proxy is available, do not activate invitations or claim
notifications are live. A proxy endpoint is an outbound networking dependency
but is not a hosting location for the TeacherPro bot.
