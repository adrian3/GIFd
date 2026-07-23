#!/bin/zsh
set -euo pipefail

APP_NAME="GIFd"
APP_ID="gifd"
START_PORT="${PORT:-4173}"
PORT_SPAN=40
PORT="$START_PORT"
URL=""
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
RUN_DIR="$APP_DIR/.run"
PID_FILE="$RUN_DIR/${APP_ID}.pid"
LOG_FILE="$RUN_DIR/${APP_ID}.log"
PORT_FILE="$RUN_DIR/${APP_ID}.port"

mkdir -p "$RUN_DIR"

alert() {
  osascript -e "display alert \"$APP_NAME\" message \"$1\""
}

process_details() {
  local pid="$1"
  ps eww -p "$pid" -o command= 2>/dev/null || ps -p "$pid" -o command= 2>/dev/null || true
}

matches_app_process() {
  local pid="$1"
  local details
  details="$(process_details "$pid")"
  [[ -n "$details" ]] || return 1
  [[ "$details" == *"ADE_APPS_LAUNCHER_ID=$APP_ID"* ]] && return 0
  [[ "$details" == *"server.py"* ]] && [[ "$details" == *"$APP_DIR"* ]]
}

stop_pid_if_matches() {
  local pid="$1"
  if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null && matches_app_process "$pid"; then
    kill "$pid" 2>/dev/null || true
    sleep 0.8
    kill -9 "$pid" 2>/dev/null || true
  fi
}

stop_previous_app() {
  if [[ -f "$PID_FILE" ]]; then
    stop_pid_if_matches "$(cat "$PID_FILE" 2>/dev/null || true)"
    rm -f "$PID_FILE"
  fi
}

port_owner_pid() {
  local port="$1"
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true
}

choose_port() {
  local candidate limit pids pid
  limit=$((START_PORT + PORT_SPAN - 1))

  for (( candidate = START_PORT; candidate <= limit; candidate++ )); do
    pids="$(port_owner_pid "$candidate")"
    if [[ -z "${pids:-}" ]]; then
      PORT="$candidate"
      URL="http://127.0.0.1:${PORT}/app.html"
      echo "$PORT" > "$PORT_FILE"
      return 0
    fi

    for pid in ${(f)pids}; do
      [[ -n "${pid:-}" ]] || continue
      if matches_app_process "$pid"; then
        stop_pid_if_matches "$pid"
      fi
    done

    pids="$(port_owner_pid "$candidate")"
    if [[ -z "${pids:-}" ]]; then
      PORT="$candidate"
      URL="http://127.0.0.1:${PORT}/app.html"
      echo "$PORT" > "$PORT_FILE"
      return 0
    fi
  done

  alert "No free port found from $START_PORT through $limit."
  exit 1
}

start_server() {
  cd "$APP_DIR"
  : > "$LOG_FILE"

  nohup env ADE_APPS_LAUNCHER_ID="$APP_ID" PORT="$PORT" python3 server.py >> "$LOG_FILE" 2>&1 &
  local new_pid=$!
  echo "$new_pid" > "$PID_FILE"
}

wait_until_ready() {
  for _ in {1..20}; do
    if curl -s "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

main() {
  stop_previous_app
  choose_port
  start_server

  if wait_until_ready; then
    open "$URL"
    exit 0
  fi

  open -a "TextEdit" "$LOG_FILE" >/dev/null 2>&1 || true
  alert "The server did not start. A log file has been opened."
  exit 1
}

main "$@"
