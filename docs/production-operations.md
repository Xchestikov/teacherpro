# TeacherPro: production operations (14 October 2026)

## Status

- https://teacherpro-app.ru on FirstVDS, Ubuntu 24.04, Nginx, Let's Encrypt.
- GitHub Actions deploy workflow uploads a versioned static release and switches /srv/teacherpro/current.
- Supabase Auth and sample writes verified by the owner on the new domain.
- The old Vercel project is intentionally retained as a fallback until monitoring, backups and SSH recovery are verified.

## Automatic publishing

Updates to application files on the main branch trigger Deploy TeacherPro to VPS. The workflow_dispatch manual trigger is retained. Deployments are serialized using the teacherpro-vps-production concurrency group. The GitHub production-vps Environment is limited to main. Review and test changes before merging into main; protect the branch in repository settings. Rollback requires updating the /srv/teacherpro/current symlink to a known-good release (via a verified SSH admin session); do not delete releases until a rollback strategy is tested.

## Monitoring

Monitor TeacherPro production checks public HTTPS plus core static files every six hours (GitHub scheduled workflows may be delayed or occasionally skipped), and fails if the certificate expires in fewer than fourteen days. Run it manually once after merging; GitHub Actions failure notifications depend on repository user notification settings. This is **not** 24x7 paging, uptime SLA, nor a test of Supabase user login.

Confirm Certbot renewal on the VPS (requires an admin/root terminal):

```bash
systemctl status certbot.timer --no-pager
certbot renew --dry-run
```

## Supabase backups — not enabled yet

Data persists in Supabase, not on the VPS. The VPS static files are reproducible from GitHub, but GitHub is **not a database backup**.

1. In Supabase Dashboard for project egopcojrzklvytcuhpov review Database > Backups and the actual plan's backup/restore capabilities. Do not assume PITR or automatic downloadable backups are available.
2. Arrange an encrypted, offsite, periodically tested PostgreSQL backup (for example pg_dump using credentials held only in a trusted administrator environment or supported scheduled secret store). Do **not** commit database passwords, dump files, user PII, or credentials to GitHub. Store encrypted backups outside the VPS and database project; define retention, e.g. 30 daily copies.
3. Back up authentication users and storage separately when relevant: a plain application-table dump may not include all identity/storage metadata. Confirm the scope and practice a restore in a **separate test database**, never overwrite production during a drill.
4. Verify the backup works before removing the previous host. No backup has been created or verified by these documentation changes.

## VPS access hardening — deliberate manual gate

**DO NOT disable root/password SSH or change the firewall until a second administrative account with a key and sudo has been tested from a new terminal.** The current teacherpro-deploy user is for deploys and should not be granted unnecessary sudo. Keep Nginx and the separate panel on TCP 1501 running. Do not start Caddy.

Safe read-only checks on the VPS:

```bash
ss -tlnp
ufw status verbose
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication)'
systemctl is-active nginx
```

Then, with a verified independent SSH admin login and console recovery available:
- Install and configure fail2ban for sshd, and verify its actual jail status.
- Plan UFW rules for SSH 22, HTTPS 443, HTTP 80 (ACME), and the panel port 1501 **only as appropriate for the actual use and trusted admin IPs**; confirm cloud-provider firewall rules; enable UFW only after keeping an active recovery session open.
- Switch admin SSH to keys, only after proving login and sudo in a separate terminal, then disable password/root SSH if desired.
- Enable unattended security updates and schedule controlled package reboots.

No live SSH/firewall/Fail2ban changes were applied via this repository.

## Retiring Vercel — only after verified fallback

Compare the new domain's login, data, mobile use, password recovery link and HTTPS monitoring. Confirm backups and recovery; then disable the Vercel project deployment or disconnect Git integration as desired. Never delete the Vercel project until recovery is proven. Do not delete the Supabase project: it is the live database and auth provider.
