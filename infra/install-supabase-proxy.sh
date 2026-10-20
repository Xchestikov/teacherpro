#!/usr/bin/env bash
# One-time privileged installation on the already configured FirstVDS nginx.
# Run as root from a reviewed TeacherPro release. Never run via curl | bash.
set -Eeuo pipefail
if (( EUID != 0 )); then echo "This installer requires root privileges" >&2; exit 1; fi

SITE=/etc/nginx/conf.d/teacherpro.conf
SNIPPET=/etc/nginx/snippets/teacherpro-supabase.conf
UPGRADE_MAP=/etc/nginx/conf.d/01-teacherpro-supabase-map.conf
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/supabase-nginx-location.conf"
DOMAIN=teacherpro-app.ru
test -s "$SITE" && test -s "$SOURCE"
command -v nginx >/dev/null
command -v curl >/dev/null
command -v python3 >/dev/null

backup="$(mktemp -d /var/backups/teacherpro-supabase-XXXXXXXX)"
chmod 700 "$backup"
cp -a "$SITE" "$backup/site.conf"
if test -e "$SNIPPET"; then cp -a "$SNIPPET" "$backup/snippet.conf"; fi
if test -e "$UPGRADE_MAP"; then cp -a "$UPGRADE_MAP" "$backup/map.conf"; fi
installed=0
rollback() {
  local code=$?
  if (( installed == 0 )); then
    echo "Proxy activation failed; restoring original Nginx configuration" >&2
    cp -a "$backup/site.conf" "$SITE"
    if test -f "$backup/snippet.conf"; then cp -a "$backup/snippet.conf" "$SNIPPET"; else rm -f "$SNIPPET"; fi
    if test -f "$backup/map.conf"; then cp -a "$backup/map.conf" "$UPGRADE_MAP"; else rm -f "$UPGRADE_MAP"; fi
    nginx -t && systemctl reload nginx || true
  fi
  exit "$code"
}
trap rollback EXIT

install -D -m 0644 "$SOURCE" "$SNIPPET"
cat > "$UPGRADE_MAP" <<'MAP'
map $http_upgrade $teacherpro_connection_upgrade {
    default upgrade;
    '' close;
}
MAP
chmod 0644 "$UPGRADE_MAP"

python3 - "$SITE" <<'PY'
from pathlib import Path
import re,sys
p=Path(sys.argv[1])
s=p.read_text()
if not re.search(r'\bserver_name\s+teacherpro-app\.ru\s*;',s):
    raise SystemExit('Target virtual host not found')
snippet='include /etc/nginx/snippets/teacherpro-supabase.conf;'
if snippet in s: raise SystemExit(0)
match=list(re.finditer(r'^[ \t]*listen[ \t]+443[ \t]+ssl[ \t]*;',s,flags=re.M))
if len(match)!=1: raise SystemExit('Expected exactly one HTTPS listener in target configuration')
m=match[0]
line_end=s.find('\n',m.end())
if line_end<0: raise SystemExit('HTTPS listener is not line terminated')
s=s[:line_end+1]+'    '+snippet+'\n'+s[line_end+1:]
p.write_text(s)
PY

nginx -t
systemctl reload nginx

headers="$(mktemp)"
trap 'rm -f "$headers"; rollback' EXIT
code="$(curl -4 -sS -o /dev/null -D "$headers" -w '%{http_code}' --max-time 12 \
  --resolve "${DOMAIN}:443:127.0.0.1" \
  "https://${DOMAIN}/supabase/auth/v1/health")"
if ! grep -Eiq '^x-teacherpro-proxy:[[:space:]]*v1[[:space:]]*$' "$headers"; then
  echo "Upstream proxy marker was not returned" >&2; exit 1
fi
if ! [[ "$code" =~ ^[234][0-9][0-9]$ ]]; then
  echo "Upstream health request returned HTTP $code" >&2; exit 1
fi
rm -f "$headers"
installed=1
echo "TeacherPro Supabase proxy installed and verified: HTTP $code (upstream)."
echo "Backup kept at $backup"
