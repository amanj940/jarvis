#!/usr/bin/env bash
# JARVIS Self-Healing Watchdog & Safe Rollback Parachute
# Protects against crash-loops, broken self-edits, or syntax regressions.
# Part of JARVIS Foundation Phase 0.0

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="$ROOT_DIR/data/logs/self_healing.log"
SAFE_COMMIT_FILE="$ROOT_DIR/data/.jarvis_safe_commit"
HEALTH_URL="${JARVIS_HEALTH_URL:-http://127.0.0.1:7341/api/health}"

mkdir -p "$ROOT_DIR/data/logs"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] [WATCHDOG] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

snapshot() {
  local commit
  commit=$(cd "$ROOT_DIR" && git rev-parse HEAD)
  echo "$commit" > "$SAFE_COMMIT_FILE"
  log "Safe commit snapshot recorded: $commit"
  echo "$commit"
}

check_health() {
  curl -s -f -m 3 "$HEALTH_URL" > /dev/null 2>&1
}

rollback() {
  local target_commit="${1:-}"
  if [[ -z "$target_commit" && -f "$SAFE_COMMIT_FILE" ]]; then
    target_commit=$(cat "$SAFE_COMMIT_FILE")
  fi

  if [[ -z "$target_commit" ]]; then
    log "CRITICAL: No target commit found for rollback! Falling back to HEAD~1"
    target_commit="HEAD~1"
  fi

  log "ALERT: Rolling back code to safe commit: $target_commit"
  (
    cd "$ROOT_DIR"
    git reset --hard "$target_commit"
  ) >> "$LOG_FILE" 2>&1 || true

  log "Restarting jarvis.service after rollback..."
  systemctl --user restart jarvis.service || true
  sleep 3

  if check_health; then
    log "SUCCESS: Rollback complete. System is healthy again."
    return 0
  else
    log "EMERGENCY: Health check still failing after rollback! Check journalctl --user -u jarvis."
    return 1
  fi
}

verify_or_rollback() {
  local timeout="${1:-15}"
  local safe_commit="${2:-}"
  if [[ -z "$safe_commit" && -f "$SAFE_COMMIT_FILE" ]]; then
    safe_commit=$(cat "$SAFE_COMMIT_FILE")
  fi

  log "Verifying health on $HEALTH_URL (timeout: ${timeout}s, safe_commit: ${safe_commit:-none})..."
  local elapsed=0
  while [[ $elapsed -lt $timeout ]]; do
    if check_health; then
      log "VERIFIED: Daemon is online and healthy ($HEALTH_URL responded 200 OK)."
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  log "FAILURE: Daemon failed health check within ${timeout}s! Initiating automatic emergency rollback..."
  rollback "$safe_commit"
}

daemon_loop() {
  log "Starting Watchdog daemon loop. Monitoring $HEALTH_URL every 30s..."
  while true; do
    if ! check_health; then
      log "WARNING: Daemon not responding on $HEALTH_URL. Checking systemctl status..."
      if systemctl --user is-active --quiet jarvis.service; then
        log "Daemon active but unresponsive. Waiting 5s before re-check..."
        sleep 5
        if ! check_health; then
          log "Daemon still unresponsive. Performing auto-recovery..."
          systemctl --user restart jarvis.service || true
          sleep 5
        fi
      fi
    fi
    sleep 30
  done
}

case "${1:-check}" in
  snapshot)
    snapshot
    ;;
  check)
    if check_health; then
      echo "OK: JARVIS is healthy"
      exit 0
    else
      echo "FAIL: JARVIS is not responding on $HEALTH_URL"
      exit 1
    fi
    ;;
  verify)
    verify_or_rollback "${2:-15}" "${3:-}"
    ;;
  rollback)
    rollback "${2:-}"
    ;;
  daemon)
    daemon_loop
    ;;
  *)
    echo "Usage: $0 {snapshot|check|verify [timeout_s] [safe_commit]|rollback [commit]|daemon}"
    exit 1
    ;;
esac
