#!/bin/sh
# Restart exploration driver: sh restart.sh [locale]
cd "$(dirname "$0")"
curl -s -m 2 localhost:9333 -d '{"op":"eval","js":"0"}' >/dev/null 2>&1 && powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 9333 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }"
LOCALE=${1:-ru-RU} nohup node driver.mjs > driver.log 2>&1 &
for i in $(seq 1 40); do grep -qE 'ready|Error' driver.log && break; sleep 2; done
cat driver.log
