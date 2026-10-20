#!/usr/bin/env bash
# User-owned long-lived bot and Xray, with a cron watchdog (no sudo/systemd).
set -euo pipefail
umask 077
root="$HOME/teacherpro-bot"
node="$root/bin/node"
config="$root/xray.json"
pidfile="$root/fast.pid"
heartbeat="$root/fast.heartbeat"

healthy_pid() {
  local pid
  pid=$(cat "$pidfile" 2>/dev/null || true)
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null &&
    ps -p "$pid" -o args= 2>/dev/null | grep -F -q "supervisor.sh serve"
}
cleanup(){
  if [[ -n "${node_pid:-}" ]]; then
    kill "$node_pid" >/dev/null 2>&1 || true
    wait "$node_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "${xray_pid:-}" ]]; then
    kill "$xray_pid" >/dev/null 2>&1 || true
    wait "$xray_pid" >/dev/null 2>&1 || true
  fi
  [[ $(cat "$pidfile" 2>/dev/null || true) == "$$" ]] && rm -f "$pidfile" || true
}
case "${1:-}" in
  serve)
    exec 9>"$root/fast.lock"
    if ! flock -n 9; then exit 0; fi
    trap cleanup EXIT
    trap 'exit 0' TERM INT
    echo "$$" > "$pidfile"
    if [[ -f "$config" ]]; then
      "$root/bin/xray" run -c "$config" >/dev/null 2>&1 9>&- &
      xray_pid=$!
      ready=0
      for _ in $(seq 1 40); do
        kill -0 "$xray_pid" 2>/dev/null || break
        if (exec 8<>/dev/tcp/127.0.0.1/10808) 2>/dev/null; then ready=1;break;fi
        sleep 0.25
      done
      if [[ "$ready" != 1 ]]; then echo "FAST_XRAY_UNAVAILABLE";exit 1;fi
    fi
    TELEGRAM_HEARTBEAT_FILE="$heartbeat" "$node" --env-file="$root/bot.env" "$root/current/daemon.mjs" 9>&- &
    node_pid=$!
    wait "$node_pid" || exit $?
    ;;
  ensure)
    if healthy_pid; then
      recent=0
      if [[ -s "$heartbeat" ]]; then
        age=$(( $(date +%s) - $(stat -c '%Y' "$heartbeat") ))
        if (( age>=0 && age<75 )); then recent=1;fi
      fi
      if [[ "$recent" == 1 ]]; then exit 0; fi
      started=$(( $(date +%s) - $(stat -c '%Y' "$pidfile") ))
      if (( started>=0 && started<70 )); then exit 0;fi
      echo "FAST_WORKER_UNHEALTHY_RESTARTING"
      kill -TERM "$(cat "$pidfile")" 2>/dev/null || true
      sleep 3
    fi
    # Detached entirely from SSH/cron and never prints credentials.
    nohup setsid /bin/bash "$root/current/supervisor.sh" serve \
      </dev/null >>"$root/fast.log" 2>&1 &
    echo "FAST_WORKER_START_REQUESTED"
    ;;
  stop)
    if healthy_pid; then
      kill -TERM "$(cat "$pidfile")"
      for _ in $(seq 1 25); do
        healthy_pid || exit 0
        sleep 0.4
      done
      echo "FAST_WORKER_DID_NOT_STOP"
      exit 1
    fi
    ;;
  status)
    if ! healthy_pid; then echo "FAST_WORKER_NOT_RUNNING";exit 1;fi
    test -s "$heartbeat" || { echo "FAST_WORKER_NO_HEARTBEAT";exit 1;}
    age=$(( $(date +%s) - $(stat -c '%Y' "$heartbeat") ))
    if (( age<0 || age>75 )); then echo "FAST_WORKER_HEARTBEAT_STALE";exit 1;fi
    echo "FAST_WORKER_HEALTHY"
    ;;
  remind)
    if ! healthy_pid; then echo "FAST_WORKER_NOT_RUNNING";exit 1;fi
    exec "$node" --env-file="$root/bot.env" "$root/current/reminders.mjs"
    ;;
  *)
    echo "Usage: supervisor.sh serve|ensure|stop|status|remind" >&2
    exit 2
    ;;
esac
