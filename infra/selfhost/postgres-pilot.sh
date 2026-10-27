#!/usr/bin/env bash
# Isolated TeacherPro PostgreSQL 17 test instance on an unprivileged FirstVDS account.
# No production data. No public TCP listener. Safe failure if prerequisites are absent.
set -Eeuo pipefail
umask 077
BASE="$HOME/teacherpro-pg-pilot"
PACKAGE_VERSION='17.11-1.pgdg24.04+2'
BIN="$BASE/runtime/usr/lib/postgresql/17/bin"
DATA="$BASE/data"
SOCK="$BASE/socket"
LOGS="$BASE/logs"
log(){ printf '[teacherpro-pg] %s\n' "$*"; }
die(){ log "FAILED: $*" >&2; exit 1; }
[[ "$(id -u)" != 0 ]] || die 'Must NOT run as root'
[[ "$(dpkg --print-architecture)" == amd64 ]] || die 'Ubuntu amd64 required'
grep -q '^VERSION_ID="24.04"' /etc/os-release || die 'Ubuntu 24.04 required'
[[ "$(nproc)" -ge 1 ]] || die 'CPU check failed'
free_mb="$(df -Pm "$HOME" | awk 'NR==2{print $4}')"
[[ "$free_mb" =~ ^[0-9]+$ && "$free_mb" -ge 4096 ]] || die 'At least 4 GB available disk is required'
mem_avail="$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)"
[[ "$mem_avail" =~ ^[0-9]+$ && "$mem_avail" -ge 300 ]] || die 'At least 300 MB memory available is required'
command -v apt >/dev/null || die 'apt is unavailable'
command -v dpkg-deb >/dev/null || die 'dpkg-deb is unavailable'
command -v psql >/dev/null || die 'PostgreSQL client is unavailable'
mkdir -p "$BASE" "$LOGS" "$SOCK"
chmod 700 "$BASE" "$LOGS" "$SOCK"
if [[ ! -x "$BIN/postgres" || ! -x "$BIN/initdb" || ! -x "$BIN/pg_ctl" ]]; then
  [[ ! -e "$DATA/PG_VERSION" ]] || die 'Existing data present but runtime binaries are missing. Do not overwrite.'
  mkdir -p "$BASE/download"
  cd "$BASE/download"
  log 'Downloading pinned PostgreSQL 17 Debian package from already configured signed PGDG repository'
  apt download "postgresql-17=$PACKAGE_VERSION" >/dev/null
  deb="$(find . -maxdepth 1 -type f -name 'postgresql-17_*.deb' -print -quit)"
  [[ -n "$deb" ]] || die 'Package download missing'
  dpkg-deb -x "$deb" "$BASE/runtime"
  [[ -x "$BIN/postgres" && -x "$BIN/initdb" && -x "$BIN/pg_ctl" ]] || die 'Incomplete PostgreSQL package'
  rm -f -- "$deb"
fi
# Dynamic link dependencies are necessary. Don't attempt to start a broken binary.
if ldd "$BIN/postgres" | grep -q 'not found'; then
  ldd "$BIN/postgres" | grep 'not found' >&2 || true
  die 'System libraries are missing. Keep production untouched.'
fi
[[ -d "$BASE/runtime/usr/share/postgresql/17" ]] || die 'Runtime shared files missing'
if [[ ! -s "$DATA/PG_VERSION" ]]; then
  [[ ! -e "$DATA" ]] || die 'Partial data directory exists. Refusing to overwrite.'
  log 'Initializing a new EMPTY database with peer-only local access'
  "$BIN/initdb" -D "$DATA" --encoding=UTF8 --locale=C.UTF-8 --auth-local=peer --auth-host=scram-sha-256 --no-instructions >/dev/null
  cat >> "$DATA/postgresql.conf" <<CONF

# TeacherPro PG pilot: minimal resources; no TCP/IP exposure.
listen_addresses = ''
unix_socket_directories = '$SOCK'
unix_socket_permissions = 0700
shared_buffers = 16MB
work_mem = 1MB
maintenance_work_mem = 16MB
max_connections = 10
max_worker_processes = 2
max_parallel_workers_per_gather = 0
max_parallel_workers = 0
autovacuum_max_workers = 1
max_wal_size = 256MB
min_wal_size = 80MB
jit = off
logging_collector = on
log_directory = '$LOGS'
log_filename = 'postgresql-%a.log'
log_rotation_age = 1d
log_rotation_size = 10MB
log_truncate_on_rotation = on
log_min_duration_statement = -1
CONF
fi
[[ "$(cat "$DATA/PG_VERSION")" == 17 ]] || die 'Unexpected existing PG_VERSION; refusing access'
if "$BIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
  log 'PostgreSQL is already running. Not restarting.'
else
  log 'Starting local-only PostgreSQL pilot'
  "$BIN/pg_ctl" -D "$DATA" -l "$LOGS/launcher.log" -w -t 40 start >/dev/null || die 'Postgres startup failed; existing services unchanged'
fi
# peer authentication, server only binds Unix socket; hostname is not used.
export PGHOST="$SOCK" PGUSER="$(id -un)" PGDATABASE=postgres
psql -X -v ON_ERROR_STOP=1 -Atc 'SELECT version();' | sed -E 's/^(PostgreSQL [^ ]+).*$/\1/'
exists="$(psql -X -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM pg_database WHERE datname='teacherpro_stage';")"
if [[ "$exists" == 0 ]]; then
  psql -X -v ON_ERROR_STOP=1 -c 'CREATE DATABASE teacherpro_stage' >/dev/null
fi
psql -X -v ON_ERROR_STOP=1 -d teacherpro_stage -c 'SELECT 1 AS teacherpro_pilot_healthy;' | tail -4
# Low-memory safety brake. Never overload production to prove a point.
now_available="$(awk '/^MemAvailable:/{print int($2/1024)}' /proc/meminfo)"
if [[ "$now_available" -lt 200 ]]; then
  log "Low available memory after start ($now_available MB). Stopping pilot."
  "$BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null || true
  die 'Memory safety brake activated'
fi
log "Pilot database healthy on Unix socket only. Available memory: $now_available MB."
log "No Supabase API, Auth, Realtime or real data has been migrated; no external network listener."
