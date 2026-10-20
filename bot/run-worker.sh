#!/usr/bin/env bash
# Invoked by private per-user cron under flock, not via public HTTP/Nginx.
set -euo pipefail
umask 077
root="$HOME/teacherpro-bot"
node="$root/bin/node"
worker="$root/current/cron.mjs"
config="$root/xray.json"

if [[ ! -f "$config" ]]; then
  exec "$node" --env-file="$root/bot.env" "$worker"
fi
if [[ ! -x "$root/bin/xray" ]]; then
  echo "TELEGRAM_XRAY_BINARY_MISSING" >&2
  exit 1
fi

# Start a local loopback-only proxy for this one polling cycle and stop on exit.
"$root/bin/xray" run -c "$config" >/dev/null 2>&1 &
vpn_pid=$!
cleanup() {
  kill "$vpn_pid" >/dev/null 2>&1 || true
  wait "$vpn_pid" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

ready=0
for _ in $(seq 1 32); do
  if ! kill -0 "$vpn_pid" 2>/dev/null; then
    echo "TELEGRAM_XRAY_EXITED" >&2
    exit 1
  fi
  if ( exec 9<>/dev/tcp/127.0.0.1/10808 ) 2>/dev/null; then
    ready=1
    break
  fi
  sleep 0.25
done
if [[ "$ready" != 1 ]]; then
  echo "TELEGRAM_XRAY_NO_LOOPBACK_LISTENER" >&2
  exit 1
fi

"$node" --env-file="$root/bot.env" "$worker"
