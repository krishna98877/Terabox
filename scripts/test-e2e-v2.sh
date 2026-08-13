#!/bin/bash
# Focused E2E Test - Each step runs individually with immediate output
set -e

PROXY="http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754"
CAPTCHASOLV_KEY="40fd4b6c-efd9-4a07-99df-53b0cb3888db"
SITEKEY="6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH"
TERABOX="https://www.1024terabox.com"
EMAIL="e2etest$(date +%s)@gmail.com"

RESULT_FILE="/home/z/my-project/scripts/e2e-result.txt"

echo "=== Step 1: Proxy Test ===" 2>&1 | tee -a "$RESULT_FILE"
IP=$(curl -s --max-time 10 --proxy "$PROXY" https://ipv4.webshare.io/)
echo "IP: $IP" 2>&1 | tee -a "$RESULT_FILE"

echo "=== Step 2: Get Pubkey ===" 2>&1 | tee -a "$RESULT_FILE"
PUBKEY=$(curl -s --max-time 15 --proxy "$PROXY" "${TERABOX}/passport/getpubkey?clienttype=0")
echo "Pubkey response: $(echo $PUBKEY | head -c 200)" 2>&1 | tee -a "$RESULT_FILE"

echo "=== Step 3: Create Captcha Task ===" 2>&1 | tee -a "$RESULT_FILE"
CREATE=$(curl -s --max-time 30 "https://v1.captchasolv.com/createTask" \
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
  }")
echo "Create response: $CREATE" 2>&1 | tee -a "$RESULT_FILE"

TASK_ID=$(echo "$CREATE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('taskId',''))" 2>/dev/null || echo "")
echo "Task ID: $TASK_ID" 2>&1 | tee -a "$RESULT_FILE"

if [ -z "$TASK_ID" ] || [ "$TASK_ID" = "" ]; then
  echo "FAILED: No task ID" 
  exit 1
fi

echo "=== Step 4: Poll for Captcha Result ===" 2>&1 | tee -a "$RESULT_FILE"
TOKEN=""
for i in $(seq 1 24); do
  sleep 5
  R=$(curl -s --max-time 15 "https://v1.captchasolv.com/getTaskResult" \
    -H "Content-Type: application/json" \
    -d "{\"clientKey\": \"$CAPTCHASOLV_KEY\", \"taskId\": $TASK_ID}")
  
  ST=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null || echo "")
  ERR=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errorCode',''))" 2>/dev/null || echo "")
  
  if [ "$ST" = "ready" ]; then
    TOKEN=$(echo "$R" | python3 -c "import sys,json; d=json.load(sys.stdin); sol=d.get('solution',{}); print(sol.get('token','') or sol.get('gRecaptchaResponse',''))" 2>/dev/null || echo "")
    echo "SOLVED at poll $i ($((i*5))s)! Token length: ${#TOKEN}" 2>&1 | tee -a "$RESULT_FILE"
    break
  fi
  
  if [ -n "$ERR" ] && [ "$ERR" != "" ] && [ "$ERR" != "None" ]; then
    echo "Poll $i: error=$ERR" 2>&1 | tee -a "$RESULT_FILE"
    if [ "$ERR" = "ERROR_CAPTCHA_UNSOLVABLE" ]; then
      echo "Captcha unsolvable, stopping" 2>&1 | tee -a "$RESULT_FILE"
      break
    fi
  else
    echo "Poll $i: status=$ST" 2>&1 | tee -a "$RESULT_FILE"
  fi
done

if [ -z "$TOKEN" ] || [ "$TOKEN" = "" ]; then
  echo "FAILED: No captcha token" 2>&1 | tee -a "$RESULT_FILE"
  exit 1
fi

echo "=== Step 5: Sendcode ===" 2>&1 | tee -a "$RESULT_FILE"
SENDCODE=$(curl -s --max-time 30 --proxy "$PROXY" -X POST "${TERABOX}/passport/register_v4/sendcode" \
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
  --data-urlencode "g_identity=${TOKEN}")

echo "Sendcode response: $SENDCODE" 2>&1 | tee -a "$RESULT_FILE"

ERRNO=$(echo "$SENDCODE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errno', d.get('error_code', d.get('code', 'unknown'))))" 2>/dev/null || echo "parse_error")
MSG=$(echo "$SENDCODE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('errmsg', d.get('msg', '')))" 2>/dev/null || echo "")
echo "errno=$ERRNO, msg=$MSG" 2>&1 | tee -a "$RESULT_FILE"

if [ "$ERRNO" = "0" ]; then
  echo "SUCCESS! OTP sent to $EMAIL" 2>&1 | tee -a "$RESULT_FILE"
  exit 0
else
  echo "FAILED: errno=$ERRNO" 2>&1 | tee -a "$RESULT_FILE"
  exit 1
fi
