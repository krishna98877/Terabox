#!/bin/bash
# Auto-trigger a TeraBox referral signup via the Render app
# Usage: Run via cron — */30 * * * * /home/z/my-project/scripts/auto-signup.sh

RENDER_URL="https://terabox-detf.onrender.com"
LOG_FILE="/home/z/my-project/scripts/auto-signup.log"

response=$(curl -s --max-time 60 -X POST "$RENDER_URL/api/signup/trigger" \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null)

timestamp=$(date -u "+%Y-%m-%d %H:%M:%S UTC")

if echo "$response" | grep -q '"success":true'; then
  signup_id=$(echo "$response" | grep -o '"signupId":"[^"]*"' | cut -d'"' -f4)
  echo "[$timestamp] OK - Signup triggered (ID: $signup_id)" >> "$LOG_FILE"
else
  error=$(echo "$response" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  echo "[$timestamp] FAIL - Signup failed: $error" >> "$LOG_FILE"
fi
