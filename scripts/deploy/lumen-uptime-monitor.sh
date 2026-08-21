#!/usr/bin/env bash
# Lumen Player uptime monitor.
#
# Checks the full public chain (site -> proxy -> SSO -> upstream Xtream gateway)
# and reports state transitions to Telegram. Runs from a systemd timer on the
# Lumen VPS; see lumen-uptime-monitor.service / .timer.
#
# Design notes:
# - Only state CHANGES are announced, so a long outage does not spam the chat.
#   A DOWN check must repeat FAILURE_THRESHOLD times before it alerts, which
#   filters single-sample network blips.
# - State lives in STATE_DIR so it survives across timer invocations.
# - Secrets come from the systemd EnvironmentFile, never from this script.

set -uo pipefail

STATE_DIR="${LUMEN_MONITOR_STATE_DIR:-/var/lib/lumen-monitor}"

# Consecutive failed checks required before we declare a target DOWN.
FAILURE_THRESHOLD="${LUMEN_MONITOR_FAILURE_THRESHOLD:-2}"
CURL_TIMEOUT="${LUMEN_MONITOR_CURL_TIMEOUT:-10}"

TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

mkdir -p "$STATE_DIR"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

# Telegram is best-effort: a failed notification must never fail the check run,
# otherwise systemd would mark the unit failed and mask the real signal.
notify() {
  local text="$1"
  if [[ -z "$TELEGRAM_BOT_TOKEN" || -z "$TELEGRAM_CHAT_ID" ]]; then
    log "NOTIFY_SKIPPED (no telegram credentials): $text"
    return 0
  fi
  curl -sS -m 15 -o /dev/null \
    -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_CHAT_ID}" \
    -d "parse_mode=HTML" \
    -d "disable_web_page_preview=true" \
    --data-urlencode "text=${text}" \
    || log "NOTIFY_FAILED: $text"
}

# check <name> <label> <expected_http> <curl-args...>
# Records pass/fail, applies the failure threshold, and notifies on transitions.
check() {
  local name="$1" label="$2" expected="$3"
  shift 3

  local state_file="$STATE_DIR/$name.state"
  local fail_file="$STATE_DIR/$name.failcount"
  local prev_state fail_count actual

  prev_state="$(cat "$state_file" 2>/dev/null || echo up)"
  fail_count="$(cat "$fail_file" 2>/dev/null || echo 0)"

  # --max-time guards the whole call; tail -c 3 keeps only the final status so a
  # curl retry (which prints one code per attempt) cannot produce "000000".
  actual="$(curl -sS -m "$CURL_TIMEOUT" -o /dev/null -w '%{http_code}' "$@" 2>/dev/null | tail -c 3)"
  [[ -z "$actual" ]] && actual=000

  if [[ "$actual" == "$expected" ]]; then
    echo 0 >"$fail_file"
    if [[ "$prev_state" == "down" ]]; then
      echo up >"$state_file"
      log "RECOVERED $name ($actual)"
      notify "✅ <b>OPORAVLJENO</b> — ${label}
Status: HTTP ${actual} (očekivano ${expected})
Host: player.exyu.tv"
    else
      echo up >"$state_file"
      log "OK $name ($actual)"
    fi
    return 0
  fi

  fail_count=$((fail_count + 1))
  echo "$fail_count" >"$fail_file"
  log "FAIL $name (got $actual, want $expected, streak $fail_count)"

  if [[ "$fail_count" -ge "$FAILURE_THRESHOLD" && "$prev_state" != "down" ]]; then
    echo down >"$state_file"
    local detail
    detail="$(diagnostics)"
    notify "🔴 <b>PAD</b> — ${label}
Status: HTTP ${actual} (očekivano ${expected})
Neuspešnih provera zaredom: ${fail_count}

${detail}"
  fi
  return 1
}

# Extra context attached to the first DOWN message, so the alert itself tells
# you whether the box is crash-looping or out of disk.
diagnostics() {
  local restarts uptime_since disk
  restarts="$(systemctl show lumen-proxy -p NRestarts --value 2>/dev/null || echo '?')"
  uptime_since="$(systemctl show lumen-proxy -p ActiveEnterTimestamp --value 2>/dev/null || echo '?')"
  disk="$(df -h / | awk 'NR==2 {print $5" iskorišćeno ("$4" slobodno)"}')"
  printf '<b>Dijagnostika</b>\nproxy restarts: %s\nproxy aktivan od: %s\ndisk /: %s' \
    "$restarts" "$uptime_since" "$disk"
}

failures=0

# 1. Public site (nginx + SPA build).
check site "Sajt player.exyu.tv" 200 \
  "https://player.exyu.tv/" || failures=$((failures + 1))

# 2. Proxy process behind nginx.
check proxy "Proxy /health" 200 \
  "https://player.exyu.tv/health" || failures=$((failures + 1))

# 3. SSO exchange. A malformed token must yield 400 ("malformed"). If SSO were
#    disabled or wiped by a bad deploy, the proxy answers 404 (sso_disabled) —
#    which is exactly the silent failure this check exists to catch.
check sso "SSO ulaz sa exyu.tv" 400 \
  -X POST -H 'Content-Type: application/json' \
  -d '{"token":"lps1.monitor-probe"}' \
  "https://player.exyu.tv/sso/exchange" || failures=$((failures + 1))

# 4. Upstream Xtream gateway. Not ours, but if it is down the player is dead
#    for viewers and we want to know it is not our VPS.
check gateway "Xtream gateway (gw.castcdn.net)" 200 \
  "https://gw.castcdn.net/player_api.php" || failures=$((failures + 1))

# 5. Player Analytics forwarding. Without a signed browser binding the healthy
#    endpoint must return 401. A 404 means forwarding was disabled (usually by
#    a missing ingest secret/URL), while 502 means the proxy path is unhealthy.
check analytics "Player Analytics forwarding" 401 \
  "https://player.exyu.tv/player-analytics/config" || failures=$((failures + 1))

# 6. Crash-loop early warning: the 28-29 Jul outage burned 47k restarts before
#    anyone noticed. Alert on a rising restart count even while /health passes.
restarts_now="$(systemctl show lumen-proxy -p NRestarts --value 2>/dev/null || echo 0)"
restarts_prev="$(cat "$STATE_DIR/restarts" 2>/dev/null || echo "$restarts_now")"
echo "$restarts_now" >"$STATE_DIR/restarts"
if [[ "$restarts_now" =~ ^[0-9]+$ && "$restarts_prev" =~ ^[0-9]+$ ]]; then
  delta=$((restarts_now - restarts_prev))
  if [[ "$delta" -ge 3 ]]; then
    log "RESTART_SPIKE delta=$delta total=$restarts_now"
    notify "⚠️ <b>UPOZORENJE</b> — proxy se restartuje
Novih restarta od prošle provere: ${delta}
Ukupno: ${restarts_now}

Servis odgovara, ali se vrti u krug — proveri: <code>journalctl -u lumen-proxy -n 50</code>"
  fi
fi

exit 0
