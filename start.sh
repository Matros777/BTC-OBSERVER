#!/bin/sh
cd "$(dirname "$0")"
if [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; then
  echo "already running (pid $(cat server.pid))"
  exit 0
fi
nohup python3 server.py --host "${HOST:-0.0.0.0}" --port "${PORT:-8787}" > server.log 2>&1 &
echo $! > server.pid
sleep 1
echo "started (pid $(cat server.pid))"
echo "http://127.0.0.1:${PORT:-8787}"
