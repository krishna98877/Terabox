#!/bin/bash
# End-to-End Pipeline Test for TeraBox Signup
# Step 1: Create captcha task, poll for result, then test sendcode

PROXY="http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754"
CAPTCHASOLV_KEY="40fd4b6c-efd9-4a07-99df-53b0cb3888db"
SITEKEY="6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH"
TERABOX="https://www.1024terabox.com"
EMAIL="e2etest$(date +%s)@gmail.com"

LOG="/home/z/my-project/scripts/e2e-test-log.txt"
> "$LOG"

log() { echo "$1" | tee -a "$LOG"; }

log "═══════════════════════════════════════════════════════"
log "  TeraBox Signup Pipeline — E2E Test"
log "═══════════════════════════════════════════════════════"
log "Email: $EMAIL"
log "Proxy: $(echo $PROXY | sed 's/:[^@]*@/:****@/')"
log "═══════════════════════════════════════════════════════"

# Step 1: Proxy test
log ""
log "[PROXY] Testing..."
IP=$(curl -s --max-time 10 --proxy "$PROXY" https://ipv4.webshare.io/ 2>/dev/null)
if [ -z "$IP" ]; then
  log "❌ Proxy FAILED"
  exit 1
fi
log "✅ Proxy OK — IP: $IP"

# Step 2: Get pubkey
log ""
log "[PUBKEY] Getting pubkey..."
PUBKEY_RESP=$(curl -s --max-time 15 --proxy "$PROXY" "${TERABOX}/passport/getpubkey?clienttype=0" 2>/dev/null)
CODE=$(echo "$PUBKEY_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('code',''))" 2>/dev/null)
if [ "$CODE" != "0" ]; then
  log "❌ Pubkey FAILED: code=$CODE"
  exit 1
fi
log "✅ Pubkey OK (code=0)"

# Step 3: Solve captcha with proxy
log ""
log "[CAPTCHA] Creating RecaptchaV2Task with proxy..."

CREATE_RESP=$(curl -s --max-time 30 "https://v1.captchasolv.com/createTask" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientKey\": \"$CAPTCHASOLV_KEY\",
    \"task\": {
      \"type\": \"RecaptchaV2Task\",
      \"websiteURL\": \"$TERABOX\",
      \"websiteKey\": \"$SITEKEY\",
      \"proxyType\": \"http\",
      \"proxyAddress\": \"31.59.20.176\",
      \"proxyPort\": 6754,
      \"proxyLogin\": \"zvuvwjcq\",
      \"proxyPassword\": \"d0y8143zsfif\"
    }
  }" 2>/dev/null)

log "createTask response: $CREATE_RESP"

TASK_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('taskId',''))" 2>/dev/null)
ERROR_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errorId',0))" 2>/dev/null)

if [ -z "$TASK_ID" ] || [ "$ERROR_ID" != "0" ]; then
  ERR_DESC=$(echo "$CREATE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errorDescription',''))" 2>/dev/null)
  ERR_CODE=$(echo "$CREATE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errorCode',''))" 2>/dev/null)
  log "❌ createTask FAILED: $ERR_CODE — $ERR_DESC"
  exit 1
fi

log "✅ Task created: $TASK_ID"
log "[CAPTCHA] Polling for result (max 120s)..."

CAPTCHA_TOKEN=""
for i in $(seq 1 24); do
  sleep 5
  RESULT=$(curl -s --max-time 15 "https://v1.captchasolv.com/getTaskResult" \
    -H "Content-Type: application/json" \
    -d "{\"clientKey\": \"$CAPTCHASOLV_KEY\", \"taskId\": $TASK_ID}" 2>/dev/null)
  
  STATUS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
  
  if [ "$STATUS" = "ready" ]; then
    CAPTCHA_TOKEN=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); sol=d.get('solution',{}); print(sol.get('token','') or sol.get('gRecaptchaResponse',''))" 2>/dev/null)
    TOKEN_LEN=${#CAPTCHA_TOKEN}
    log "✅ CAPTCHA SOLVED! Token length: $TOKEN_LEN (after $((i*5))s)"
    log "Token preview: ${CAPTCHA_TOKEN:0:80}..."
    break
  fi
  
  # Check errors
  ERR=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errorCode',''))" 2>/dev/null)
  if [ -n "$ERR" ] && [ "$ERR" != "" ] && [ "$ERR" != "None" ]; then
    ERR_DESC=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errorDescription',''))" 2>/dev/null)
    log "Error: $ERR — $ERR_DESC"
    if [ "$ERR" = "ERROR_LIMIT_EXCEEDED" ]; then
      log "Rate limited, waiting 15s..."
      sleep 15
    elif [ "$ERR" = "ERROR_CAPTCHA_UNSOLVABLE" ]; then
      log "❌ Captcha unsolvable!"
      break
    fi
  else
    log "Poll $i/24: status=$STATUS..."
  fi
done

if [ -z "$CAPTCHA_TOKEN" ]; then
  log "❌ Captcha solving FAILED"
  exit 1
fi

# Step 4: Sendcode
log ""
log "[SENDCODE] Calling sendcode with captcha token..."

# Build body params (matching the existing code's passportPost format)
SENDCODE_BODY="app_id=250528&web=1&channel=dubox&clienttype=0&email=${EMAIL}&op_type=1&pass_version=3.0&reg_source=share&koltype=0&g_identity=${CAPTCHA_TOKEN}"

SENDCODE_RESP=$(curl -s --max-time 30 --proxy "$PROXY" -X POST "${TERABOX}/passport/register_v4/sendcode" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
  -H "Referer: ${TERABOX}/" \
  -H "Origin: ${TERABOX}" \
  -H "Accept: application/json, text/plain, */*" \
  -H "sec-ch-ua: \"Not/A)Brand\";v=\"8\", \"Chromium\";v=\"131\", \"Google Chrome\";v=\"131\"" \
  -H "sec-ch-ua-mobile: ?0" \
  -H "sec-ch-ua-platform: \"Windows\"" \
  -H "sec-fetch-dest: empty" \
  -H "sec-fetch-mode: cors" \
  -H "sec-fetch-site: same-origin" \
  --data-urlencode "app_id=250528" \
  --data-urlencode "web=1" \
  --data-urlencode "channel=dubox" \
  --data-urlencode "clienttype=0" \
  --data-urlencode "email=${EMAIL}" \
  --data-urlencode "op_type=1" \
  --data-urlencode "pass_version=3.0" \
  --data-urlencode "reg_source=share" \
  --data-urlencode "koltype=0" \
  --data-urlencode "g_identity=${CAPTCHA_TOKEN}" \
  2>/dev/null)

log "sendcode response: $SENDCODE_RESP"

# Parse response
ERRNO=$(echo "$SENDCODE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errno', d.get('error_code', d.get('code', 'unknown'))))" 2>/dev/null)
MSG=$(echo "$SENDCODE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errmsg', d.get('msg', '')))" 2>/dev/null)

log "sendcode errno: $ERRNO, msg: $MSG"

if [ "$ERRNO" = "0" ]; then
  log ""
  log "═══════════════════════════════════════════════════════"
  log "  ✅✅✅ PIPELINE WORKS END-TO-END! ✅✅✅"
  log "  OTP sent to: $EMAIL"
  log "═══════════════════════════════════════════════════════"
  exit 0
fi

# If captcha was rejected, try again
if [ "$ERRNO" = "400090" ] || [ "$ERRNO" = "460030" ] || [ "$ERRNO" = "106" ]; then
  log ""
  log "⚠️ Captcha rejected (errno $ERRNO). This may mean:"
  log "   1. Token expired (solve time too long)"
  log "   2. Token bound to wrong IP"
  log "   3. Wrong captcha type"
  log ""
  log "Trying with fresh captcha token..."
  
  # Create new task
  CREATE_RESP2=$(curl -s --max-time 30 "https://v1.captchasolv.com/createTask" \
    -H "Content-Type: application/json" \
    -d "{
      \"clientKey\": \"$CAPTCHASOLV_KEY\",
      \"task\": {
        \"type\": \"RecaptchaV2Task\",
        \"websiteURL\": \"$TERABOX\",
        \"websiteKey\": \"$SITEKEY\",
        \"proxyType\": \"http\",
        \"proxyAddress\": \"31.59.20.176\",
        \"proxyPort\": 6754,
        \"proxyLogin\": \"zvuvwjcq\",
        \"proxyPassword\": \"d0y8143zsfif\"
      }
    }" 2>/dev/null)
  
  TASK_ID2=$(echo "$CREATE_RESP2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('taskId',''))" 2>/dev/null)
  
  if [ -n "$TASK_ID2" ]; then
    log "New task: $TASK_ID2. Polling..."
    CAPTCHA_TOKEN2=""
    for i in $(seq 1 24); do
      sleep 5
      RESULT2=$(curl -s --max-time 15 "https://v1.captchasolv.com/getTaskResult" \
        -H "Content-Type: application/json" \
        -d "{\"clientKey\": \"$CAPTCHASOLV_KEY\", \"taskId\": $TASK_ID2}" 2>/dev/null)
      STATUS2=$(echo "$RESULT2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
      if [ "$STATUS2" = "ready" ]; then
        CAPTCHA_TOKEN2=$(echo "$RESULT2" | python3 -c "import sys,json; d=json.load(sys.stdin); sol=d.get('solution',{}); print(sol.get('token','') or sol.get('gRecaptchaResponse',''))" 2>/dev/null)
        log "✅ Fresh captcha solved! Token length: ${#CAPTCHA_TOKEN2}"
        break
      fi
      log "Retry poll $i/24: status=$STATUS2..."
    done
    
    if [ -n "$CAPTCHA_TOKEN2" ]; then
      log "Retrying sendcode with fresh token..."
      SENDCODE_RESP2=$(curl -s --max-time 30 --proxy "$PROXY" -X POST "${TERABOX}/passport/register_v4/sendcode" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
        -H "Referer: ${TERABOX}/" \
        -H "Origin: ${TERABOX}" \
        -H "Accept: application/json, text/plain, */*" \
        -H "sec-ch-ua: \"Not/A)Brand\";v=\"8\", \"Chromium\";v=\"131\", \"Google Chrome\";v=\"131\"" \
        -H "sec-ch-ua-mobile: ?0" \
        -H "sec-ch-ua-platform: \"Windows\"" \
        -H "sec-fetch-dest: empty" \
        -H "sec-fetch-mode: cors" \
        -H "sec-fetch-site: same-origin" \
        --data-urlencode "app_id=250528" \
        --data-urlencode "web=1" \
        --data-urlencode "channel=dubox" \
        --data-urlencode "clienttype=0" \
        --data-urlencode "email=${EMAIL}" \
        --data-urlencode "op_type=1" \
        --data-urlencode "pass_version=3.0" \
        --data-urlencode "reg_source=share" \
        --data-urlencode "koltype=0" \
        --data-urlencode "g_identity=${CAPTCHA_TOKEN2}" \
        2>/dev/null)
      
      log "Retry sendcode response: $SENDCODE_RESP2"
      ERRNO2=$(echo "$SENDCODE_RESP2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errno', d.get('error_code', d.get('code', 'unknown'))))" 2>/dev/null)
      
      if [ "$ERRNO2" = "0" ]; then
        log ""
        log "  ✅✅✅ PIPELINE WORKS ON RETRY! ✅✅✅"
        exit 0
      fi
      log "❌ Retry failed: errno=$ERRNO2"
    fi
  fi
fi

log ""
log "❌ Pipeline failed at sendcode: errno=$ERRNO, msg=$MSG"
exit 1
