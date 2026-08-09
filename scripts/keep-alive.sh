#!/bin/bash
# Keep Render free tier awake + ensure auto-signup scheduler is running
# Runs every 5 minutes via cron or external ping service

RENDER_URL="https://terabox-detf.onrender.com"
LOG_FILE="/home/z/my-project/scripts/keep-alive.log"

timestamp=$(date -u "+%Y-%m-%d %H:%M:%S UTC")

# 1. Ping homepage to keep server awake
ping_result=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$RENDER_URL" 2>/dev/null)
if [ "$ping_result" = "200" ]; then
  echo "[$timestamp] OK - Keep-alive ping (HTTP $ping_result)" >> "$LOG_FILE"
else
  echo "[$timestamp] FAIL - Keep-alive ping (HTTP $ping_result)" >> "$LOG_FILE"
fi

# 2. Call init endpoint to ensure scheduler is running
init_result=$(curl -s --max-time 15 "$RENDER_URL/api/init" 2>/dev/null)
echo "[$timestamp] INIT - $init_result" >> "$LOG_FILE"
