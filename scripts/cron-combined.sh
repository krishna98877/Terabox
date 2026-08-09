#!/bin/bash
# Combined cron: Keep Render alive + auto-trigger signups
# Called every 5 minutes by external cron/ping service

RENDER_URL="https://terabox-detf.onrender.com"
LOG_FILE="/home/z/my-project/scripts/cron.log"
timestamp=$(date -u "+%Y-%m-%d %H:%M:%S UTC")

# 1. Keep-alive ping (every call)
ping_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$RENDER_URL" 2>/dev/null)
echo "[$timestamp] PING - HTTP $ping_code" >> "$LOG_FILE"

# 2. Auto-signup trigger (every 30 min = every 6th call at 5-min intervals)
MINUTE=$(date -u "+%M")
if [ "$((MINUTE % 30))" -lt 5 ]; then
  signup_result=$(curl -s --max-time 60 -X POST "$RENDER_URL/api/signup/trigger" \
    -H "Content-Type: application/json" -d '{}' 2>/dev/null)
  if echo "$signup_result" | grep -q '"success":true'; then
    sid=$(echo "$signup_result" | grep -o '"signupId":"[^"]*"' | cut -d'"' -f4)
    echo "[$timestamp] SIGNUP - Triggered (ID: $sid)" >> "$LOG_FILE"
  else
    err=$(echo "$signup_result" | grep -o '"error":"[^"]*"' | head -1)
    echo "[$timestamp] SIGNUP - Failed: $err" >> "$LOG_FILE"
  fi
fi

# 3. Init scheduler (every 30 min)
if [ "$((MINUTE % 30))" -lt 5 ]; then
  curl -s --max-time 15 "$RENDER_URL/api/scheduler" > /dev/null 2>&1
fi
