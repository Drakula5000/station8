#!/bin/bash
# Start Flask backend + Vite frontend together.
# Ctrl+C kills both.

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT/data"
mkdir -p "$LOG_DIR"
BACKEND_LOG="$LOG_DIR/server.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

# Load .env if present (Google OAuth creds, etc.)
if [ -f "$ROOT/.env" ]; then
  set -a
  source "$ROOT/.env"
  set +a
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

# Prefer the project venv's python directly. Sourcing venv/bin/activate is
# unreliable because the activate script bakes in the absolute path of the
# venv at creation time; if the project folder is ever renamed or moved, the
# activate script no longer matches reality. Calling venv/bin/python directly
# still resolves the venv's site-packages correctly because Python keys off
# its own executable location.
if [ -x "$ROOT/venv/bin/python" ]; then
  PYTHON_BIN="$ROOT/venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "❌ Python not found. Install Python 3 or recreate venv with: python3 -m venv venv && venv/bin/pip install -r requirements.txt"
  exit 1
fi

# Kill all child processes on exit
trap 'kill 0' EXIT

cleanup_port 5001
cleanup_port 5173

# Truncate logs from any prior run so this session starts fresh.
: > "$BACKEND_LOG"
: > "$FRONTEND_LOG"

# Backend with auto-restart loop. If the python process crashes (bad import,
# config error, OOM, etc.) it gets restarted after a short delay so the dev
# environment survives transient failures. All output goes to data/server.log
# so the failure mode is inspectable.
run_backend() {
  while true; do
    "$PYTHON_BIN" "$ROOT/server.py" >> "$BACKEND_LOG" 2>&1
    echo "" >> "$BACKEND_LOG"
    echo "[$(date '+%H:%M:%S')] Backend exited; restarting in 2s..." >> "$BACKEND_LOG"
    sleep 2
  done
}

run_frontend() {
  while true; do
    (cd "$ROOT/frontend" && npm run dev) >> "$FRONTEND_LOG" 2>&1
    echo "" >> "$FRONTEND_LOG"
    echo "[$(date '+%H:%M:%S')] Frontend exited; restarting in 2s..." >> "$FRONTEND_LOG"
    sleep 2
  done
}

echo "Starting backend on :5001..."
run_backend &

echo "Starting frontend on :5173..."
run_frontend &

# Wait up to ~10 seconds for backend to answer /api/auth/status before we
# declare the dev environment ready. If it never answers, surface the tail
# of the log so the cause is visible without the user having to dig.
echo -n "Waiting for backend"
backend_ready=0
for _ in $(seq 1 20); do
  if curl -sf -o /dev/null http://127.0.0.1:5001/api/auth/status; then
    backend_ready=1
    echo " ✓"
    break
  fi
  echo -n "."
  sleep 0.5
done

if [ "$backend_ready" -ne 1 ]; then
  echo ""
  echo "⚠️  Backend didn't come up in 10 seconds."
  echo "    Last 30 lines of data/server.log:"
  echo "    ────────────────────────────────"
  tail -30 "$BACKEND_LOG" | sed 's/^/    /'
  echo "    ────────────────────────────────"
  echo "    Auto-restart loop will keep retrying — fix the error above and the"
  echo "    backend will pick itself back up on its own."
fi

echo ""
echo "🟢 Dev is up:"
echo "   Frontend → http://127.0.0.1:5173"
echo "   Backend  → http://127.0.0.1:5001"
echo "   Logs     → data/server.log, data/frontend.log"
echo ""
echo "   Local-dev login: 'owner' or 'visitor' (always works in dev,"
echo "   regardless of any configured passwords)."
echo ""
echo "   Press Ctrl+C to stop everything."

wait
