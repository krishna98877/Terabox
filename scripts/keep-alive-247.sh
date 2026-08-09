#!/bin/bash
# TeraBox Referral Agent — 24/7 Keep-Alive & Auto-Engine Ping
#
# This script:
# 1. Pings /api/health to keep Render awake
# 2. Pings /api/init to ensure engine is running
# 3. Logs the result
#
# Run via crontab every 5 minutes

RENDER_URL="https://terabox-detf.onrender.com"
LOG_FILE="/home/z/my-project/scripts/keep-alive.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Ping 1: Health check (keeps server awake)
HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${RENDER_URL}/api/health" 2>/dev/null || echo "000")

# Ping 2: Init endpoint (auto-starts engine if down)
INIT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${RENDER_URL}/api/init" 2>/dev/null || echo "000")

# Get engine status for logging
ENGINE_INFO=$(curl -s --max-time 10 "${RENDER_URL}/api/health" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    engine = data.get('engine', {})
    workers = sum(1 for w in engine.get('workerStates', []) if w.get('status') == 'running')
    proxy = data.get('proxy', {}).get('poolSize', 0)
    print(f'engine={engine.get(\"running\",False)} workers={workers} proxies={proxy}')
except:
    print('parse_error')
" 2>/dev/null || echo "fetch_error")

# Log result
echo "[${TIMESTAMP}] health=${HEALTH_STATUS} init=${INIT_STATUS} ${ENGINE_INFO}" >> "${LOG_FILE}"

# Keep log under 1000 lines
if [ -f "${LOG_FILE}" ]; then
    LINES=$(wc -l < "${LOG_FILE}")
    if [ "$LINES" -gt 1000 ]; then
        tail -500 "${LOG_FILE}" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "${LOG_FILE}"
    fi
fi

# Output for cron
echo "[${TIMESTAMP}] health=${HEALTH_STATUS} init=${INIT_STATUS} ${ENGINE_INFO}"
