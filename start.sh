#!/bin/bash
# Start Flask backend + Vite frontend together.
# Ctrl+C kills both.

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Activate venv if present
if [ -f "$ROOT/venv/bin/activate" ]; then
  source "$ROOT/venv/bin/activate"
fi

cleanup_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping existing process on :$port..."
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

if command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
else
  echo "Python not found. Install Python 3 or create the project's virtualenv."
  exit 1
fi

# Kill all child processes on exit
trap 'kill 0' EXIT

cleanup_port 5001
cleanup_port 5173

echo "Starting Flask on :5001..."
"$PYTHON_BIN" "$ROOT/server.py" &

echo "Starting Vite on :5173..."
cd "$ROOT/frontend" && npm run dev &

wait
