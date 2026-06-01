#!/bin/zsh
cd "$(dirname "$0")"

# Kill any existing process on port 4173
lsof -ti :4173 | xargs kill -9 2>/dev/null || true

python3 server.py &
SERVER_PID=$!

# Wait until the server is responding (up to 10s)
for i in {1..20}; do
  if curl -s http://127.0.0.1:4173 > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

open http://127.0.0.1:4173/app.html
wait $SERVER_PID
