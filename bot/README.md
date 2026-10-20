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

## QuattroVPN VLESS integration (single FirstVDS server)

If an existing QuattroVPN subscription provides a `vless://` configuration
link, save that private URI in the GitHub Actions repository secret
`QUATTRO_VLESS_URI`. Do not include the VLESS link in issues, screenshots,
source code, logs or messages. The deploy workflow checks that a
VLESS/Reality, TLS, TCP, WebSocket, gRPC or XHTTP URI can be parsed; anything
else fails closed with a generic error.

The release downloads official upstream Xray-core v26.3.27 on the GitHub
runner, checks the pinned upstream SHA-256 before unpacking it, then installs
Xray privately at `~/teacherpro-bot/bin/xray` with no sudo. The secret URI is
converted to `~/teacherpro-bot/xray.json` (0600) and is **never** passed to
Xray or curl via process argv. Only a loopback SOCKS5 listener
`127.0.0.1:10808` is opened; every egress target except
`api.telegram.org` is blocked in Xray routing. The Node worker sends only
Telegram Bot API calls through `socks5h://127.0.0.1:10808`; all Supabase
requests bypass the tunnel.

Cron's minute-by-minute runner starts Xray temporarily, verifies that the
loopback SOCKS listener is ready, runs the polling/reminder worker, then
terminates Xray. The pre-cron trial verifies network connectivity and prevents
activation on failure. When testing/restarting, keep the VPN credentials
confidential and confirm that the Quattro subscription permits server usage.
Supported transports vary by Quattro configuration; not every `vless://`
scheme will be compatible without adapter changes.

The Telegram UI remains disabled until a successful FirstVDS trial and a
subsequent persistent cron check. No billing or data location changes occur.

## Persistent fast polling (2026-10-20)

The user-approved low-latency runtime on the **same FirstVDS VPS** replaces
minute-by-minute command polling with a persistent Node.js process, backed by
one persistent local Xray client. New commands arrive via Telegram's
`getUpdates` long poll (8-second timeout), which returns immediately when a
message arrives. There is no 60-second cron scheduling delay for commands.

All processes run privately as the current SSH deployment user with no sudo.
`~/teacherpro-bot/current/supervisor.sh serve` starts loopback-only Xray and
a command-only Node daemon; `fast.lock` prevents duplicate workers.
`supervisor.sh status` verifies both the live process and a fresh Supabase-
independent Telegram poll heartbeat. `fast.heartbeat` is updated after each
successful poll; prolonged network failure or a process crash is detected by
the single-minute cron watchdog. All secret files remain 0600.

**Reminders and student schedule changes** run independently once per minute:
`supervisor.sh remind` performs only the reminder engine's `poll()`, never
calls Telegram `getUpdates`. It retains the same idempotency ledger,
four-minute reminder grace and notification rules as before.

Cron installs two independently locked tasks identified by the exact markers
`# teacherpro-fast-watchdog` and `# teacherpro-reminder-worker`. The old
`# teacherpro-bot-worker` entry is removed BEFORE the new daemon starts, and
a currently executing old worker must release its `cron.lock` first. During
release, the daemon must complete a real Telegram round trip, and reminders
must complete one real run before the new crontab is saved. On failure, the
deployment restores the previous release symlink and previous crontab.

A separate read-only health workflow checks that the heartbeat keeps advancing
after deployment, that the two cron entries exist, and that the old polling
cron entry is gone.

Useful non-sensitive checks after deployment:
- `bash ~/teacherpro-bot/current/supervisor.sh status`
- `crontab -l | grep 'teacherpro-'`
- `stat ~/teacherpro-bot/fast.heartbeat`

All runtime logs live under `~/teacherpro-bot`, inaccessible to web clients.
Do not print the `bot.env` or `xray.json` files or inspect process
environments in shared consoles.

Expected processing delay is commonly a few seconds, dependent on QuattroVPN,
Telegram and Supabase. This is **not** an SLA. The integration does not
change the TeacherPro website, stored lessons, billing, Supabase or VPN subscription.
