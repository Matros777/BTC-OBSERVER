#!/bin/sh
cd "$(dirname "$0")"
if [ -f server.pid ] && kill -0 "$(cat server.pid)" 2>/dev/null; then
  kill "$(cat server.pid)"
  rm -f server.pid
  echo "stopped"
else
  pkill -f "btc-observer/server.py" 2>/dev/null && echo "stopped (by name)" || echo "not running"
  rm -f server.pid
fi
