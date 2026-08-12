/**
 * Quick direct test: proxy + captcha + sendcode in one go.
 * Uses CaptchaSolv API directly, no project modules.
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

const API_KEY = process.env.CAPTCHASOLV_API_KEY || '40fd4b6c-efd9-4a07-99df-53b0cb3888db';
const PROXY = 'http://156.146.59.3:9002';
const TERABOX = 'https://www.1024terabox.com';
const SITEKEY = '6LceASUfAAAAAHBcvTdvuPVieBvEaOEPfSGf9b7'; // fallback sitekey

async function main() {
  console.log('=== QUICK DIRECT TEST ===\n');
  
  // Step 1: Test proxy works with TeraBox
  console.log('[1] Testing proxy with TeraBox...');
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  const agent = new HttpsProxyAgent(PROXY);
  
  try {
    const res = await fetch(`${TERABOX}/passport/getpubkey?app_id=250528&web=1&channel=dubox&clienttype=0`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
      // @ts-ignore
      agent,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    console.log(`    getpubkey: code=${data.code ?? data.errno}`);
  } catch (e: any) {
    console.log(`    FAILED: ${e.message}`);
    return;
  }

  // Step 2: Create temp email
  console.log('[2] Creating temp email...');
  const username = Array.from({ length: 12 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const email = `${username}@mailistry.com`;
  console.log(`    Email: ${email}`);

  // Step 3: Sendcode (will need captcha)
  console.log('[3] sendcode without captcha...');
  let sendRes: any;
  try {
    const qs = new URLSearchParams({ app_id: '250528', web: '1', channel: 'dubox', clienttype: '0' });
    const body = new URLSearchParams({ email, op_type: '1', pass_version: '3.0', reg_source: 'share', koltype: '0' });
    const res = await fetch(`${TERABOX}/passport/register_v4/sendcode?${qs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': `${TERABOX}/`, 'Origin': TERABOX, 'Accept': 'application/json',
      },
      // @ts-ignore
      agent,
      body,
      signal: AbortSignal.timeout(20000),
    });
    sendRes = await res.json();
    const errno = sendRes.errno ?? sendRes.error_code ?? sendRes.code;
    console.log(`    errno=${errno} errmsg=${sendRes.errmsg || 'none'}`);
  } catch (e: any) {
    console.log(`    FAILED: ${e.message}`);
  }

  // Step 4: Solve captcha via CaptchaSolv WITH proxy (v2 Standard first)
  console.log('\n[4] Solving reCAPTCHA v2 Standard (proxy-bound)...');
  
  // Parse proxy for CaptchaSolv
  const parsedProxy = new URL(PROXY);
  const port = parseInt(parsedProxy.port, 10) || 80;
  
  const task = {
    type: 'RecaptchaV2Task',
    websiteURL: `${TERABOX}/`,
    websiteKey: SITEKEY,
    proxyType: 'http',
    proxyAddress: parsedProxy.hostname,
    proxyPort: port,
  };
  
  console.log(`    Task: type=${task.type}, proxy=${task.proxyType}://${task.proxyAddress}:${task.proxyPort}`);
  console.log(`    sitekey: ${SITEKEY}`);
  
  const t0 = Date.now();
  let captchaResult: any;
  try {
    const res = await fetch('https://v1.captchasolv.com/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: API_KEY,
        task,
        waitForSlot: true,
        maxWaitTime: 120,
      }),
      signal: AbortSignal.timeout(130000),
    });
    captchaResult = await res.json();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    
    console.log(`    Response in ${elapsed}s: errorId=${captchaResult.errorId}, errorCode=${captchaResult.errorCode || 'none'}`);
    
    if (captchaResult.errorId === 0 && captchaResult.solution?.token) {
      console.log(`    ★ SOLVED! Token length=${captchaResult.solution.token.length}`);
    } else {
      console.log(`    FAILED: ${captchaResult.errorCode} - ${captchaResult.errorDescription}`);
      
      // Try v2 Enterprise as fallback
      console.log('\n[4b] Trying v2 Enterprise...');
      const entTask = { ...task, type: 'RecaptchaV2EnterpriseTask' };
      const t1 = Date.now();
      const res2 = await fetch('https://v1.captchasolv.com/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: API_KEY, task: entTask, waitForSlot: true, maxWaitTime: 120 }),
        signal: AbortSignal.timeout(130000),
      });
      captchaResult = await res2.json();
      const elapsed2 = ((Date.now() - t1) / 1000).toFixed(1);
      console.log(`    Response in ${elapsed2}s: errorId=${captchaResult.errorId}, errorCode=${captchaResult.errorCode || 'none'}`);
      
      if (captchaResult.errorId === 0 && captchaResult.solution?.token) {
        console.log(`    ★ SOLVED! Token length=${captchaResult.solution.token.length}`);
      } else {
        console.log(`    FAILED: ${captchaResult.errorCode} - ${captchaResult.errorDescription}`);
        return;
      }
    }
  } catch (e: any) {
    console.log(`    CAPTCHA API ERROR: ${e.message}`);
    return;
  }

  const captchaToken = captchaResult.solution.token;
  console.log(`\n[5] Retrying sendcode with captcha token (len=${captchaToken.length})...`);
  
  try {
    const qs = new URLSearchParams({ app_id: '250528', web: '1', channel: 'dubox', clienttype: '0' });
    const body = new URLSearchParams({
      email,
      op_type: '1',
      pass_version: '3.0',
      reg_source: 'share',
      koltype: '0',
      g_identity: captchaToken,
    });
    const res = await fetch(`${TERABOX}/passport/register_v4/sendcode?${qs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': `${TERABOX}/`, 'Origin': TERABOX, 'Accept': 'application/json',
      },
      // @ts-ignore
      agent,
      body,
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    const errno = data.errno ?? data.error_code ?? data.code;
    console.log(`    Result: errno=${errno} errmsg=${data.errmsg || data.msg || 'none'}`);
    console.log(`    Full response: ${JSON.stringify(data).substring(0, 400)}`);
    
    if (errno === 0) {
      console.log('\n★★★ OTP SENT! SIGNUP WORKING! ★★★');
    } else {
      console.log(`\n    sendcode failed (errno ${errno})`);
    }
  } catch (e: any) {
    console.log(`    FAILED: ${e.message}`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
