#!/usr/bin/env bash
# TeacherPro self-hosted Supabase readiness gate (non-destructive).
# Does not install packages, inspect private data or change production.
set -Eeuo pipefail
say() { printf '%s\n' "$*"; }
failures=0
check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then say "OK: $label"
  else say "BLOCKED: $label"; failures=$((failures+1)); fi
}
say "TeacherPro local Supabase readiness check"
say "Do NOT switch production until separate restore test, backups and app/bot validation."
cpu="$(nproc 2>/dev/null || echo 0)"
mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
disk_bytes="$(df -PB1 / | awk 'NR==2 {print $2}')"
free_bytes="$(df -PB1 / | awk 'NR==2 {print $4}')"
say "Resources: CPU=$cpu; total RAM=$mem_kb KiB; disk=$disk_bytes bytes; available=$free_bytes bytes"
check "2 or more CPU cores" test "$cpu" -ge 2
check "at least ~4 GB total RAM" test "$mem_kb" -ge 3700000
check "at least 40 GB total disk" test "$disk_bytes" -ge 39000000000
check "at least 20 GB free disk before importing data" test "$free_bytes" -ge 20000000000
check "docker binary installed" command -v docker
if command -v docker >/dev/null 2>&1; then
  check "Docker daemon accessible to deployment operator" docker info
  check "Docker Compose v2 available" docker compose version
fi
if command -v sudo >/dev/null 2>&1; then
  check "non-interactive privileged access for Nginx/config tasks" sudo -n true
else
  say "BLOCKED: sudo is not installed (admin access needed)"
  failures=$((failures+1))
fi
if command -v ss >/dev/null 2>&1; then
  if ss -ltnH '( sport = :5432 or sport = :8000 or sport = :8001 )' | grep -q .; then
    say "NOTE: At least one candidate port is occupied: inspect manually."
  else
    say "OK: common candidate TCP ports appear unused"
  fi
fi
if [[ "$failures" -eq 0 ]]; then
  say "PREFLIGHT PASSED — prerequisites only; no installation has occurred."
else
  say "PREFLIGHT BLOCKED — $failures prerequisite(s) unavailable; no changes made."
fi
exit "$((failures>0))"
