/**
 * End-to-End Pipeline Test — TeraBox Signup (Standalone)
 * Tests: Proxy → Captcha Solving → Sendcode (OTP)
 * 
 * Uses curl for HTTP requests (proxy support) and fetch for CaptchaSolv API.
 * No Next.js server required.
 */

import { execSync } from 'child_process';
import crypto from 'crypto';

// ─── Config ───
const CAPTCHASOLV_API_KEY = '40fd4b6c-efd9-4a07-99df-53b0cb3888db';
const CAPTCHASOLV_BASE = 'https://v1.captchasolv.com';
const RECAPTCHA_SITEKEY = '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';
const TERABOX_BASE = 'https://www.1024terabox.com';
const PROXY_URL = 'http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754';

// Random test email
const TEST_EMAIL = `e2etest${Date.now()}@gmail.com`;

// ─── Helpers ───
function log(step: string, msg: string) {
  console.log(`\n[${step}] ${msg}`);
}

function curl(url: string, options: { method?: string; data?: string; headers?: Record<string, string>; proxy?: string; timeout?: number } = {}): string {
  const args: string[] = ['curl', '-s'];
  args.push('--max-time', String(options.timeout || 20));
  if (options.proxy) args.push('--proxy', `"${options.proxy}"`);
  if (options.method === 'POST') args.push('-X', 'POST');
  if (options.data) args.push('--data', `'${options.data.replace(/'/g, "'\\''")}'`);
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      args.push('-H', `"${k}: ${v}"`);
    }
  }
  args.push(`"${url}"`);
  return execSync(args.join(' '), { encoding: 'utf-8', timeout: (options.timeout || 20) * 1000 + 5000 });
}

function parseProxyForCaptchaSolv(url: string) {
  const match = url.match(/http:\/\/([^:]+):([^@]+)@([^:]+):(\d+)/);
  if (!match) throw new Error(`Cannot parse proxy URL: ${url}`);
  return {
    proxyType: 'http',
    proxyAddress: match[3],
    proxyPort: parseInt(match[4]),
    proxyLogin: match[1],
    proxyPassword: match[2],
  };
}

// ─── Step 1: Proxy Connectivity ───
function testProxy(): boolean {
  log('PROXY', `Testing Webshare proxy...`);
  try {
    const ip = curl('https://ipv4.webshare.io/', { proxy: PROXY_URL, timeout: 10 }).trim();
    log('PROXY', `Webshare IP: ${ip}`);
    return true;
  } catch (err: any) {
    log('PROXY', `FAILED: ${err.message}`);
    return false;
  }
}

// ─── Step 2: TeraBox getpubkey ───
function getPubKey(): { pp1: string; pp2: string; pp4: string } | null {
  log('PUBKEY', 'Getting TeraBox public key via proxy...');
  try {
    const resp = curl(`${TERABOX_BASE}/passport/getpubkey?clienttype=0`, { proxy: PROXY_URL, timeout: 15 });
    const data = JSON.parse(resp);
    log('PUBKEY', `Response: code=${data.code}, pp1 length=${data.data?.pp1?.length || 0}`);
    return {
      pp1: data.data?.pp1 || '',
      pp2: data.data?.pp2 || '',
      pp4: data.data?.pp4 || '',
    };
  } catch (err: any) {
    log('PUBKEY', `FAILED: ${err.message}`);
    return null;
  }
}

// ─── Step 3: RSA Encrypt Email ───
function rsaEncryptEmail(email: string, pp1: string): string {
  // TeraBox's pp1 is a custom format (base64url encoded, ~360 chars)
  // It's NOT a standard RSA SPKI key — standard RSA-2048 SPKI is ~392 chars
  // The key bytes: 360 * 3/4 ≈ 270 bytes — too short for RSA-2048 SPKI (~294 bytes)
  
  // Convert base64url to standard base64
  const standardBase64 = pp1.replace(/-/g, '+').replace(/_/g, '/');
  const keyBytes = standardBase64.length * 3 / 4;
  
  log('ENCRYPT', `pp1 key size: ${Math.round(keyBytes)} bytes (standard RSA-2048 SPKI is ~294 bytes)`);
  
  if (keyBytes < 200 || keyBytes > 600) {
    log('ENCRYPT', `pp1 is NOT standard RSA SPKI format. TeraBox accepts unencrypted emails — sending as plaintext.`);
    return email;
  }
  
  // Try standard RSA encryption
  try {
    const lines = standardBase64.match(/.{1,64}/g) || [standardBase64];
    const pemKey = '-----BEGIN PUBLIC KEY-----\n' + lines.join('\n') + '\n-----END PUBLIC KEY-----';
    const buffer = Buffer.from(email, 'utf-8');
    const encrypted = crypto.publicEncrypt(
      { key: pemKey, padding: crypto.constants.RSA_PKCS1_PADDING },
      buffer
    ).toString('base64');
    log('ENCRYPT', `RSA encryption OK, encrypted length: ${encrypted.length}`);
    return encrypted;
  } catch (err: any) {
    log('ENCRYPT', `RSA encryption failed: ${err.message}. Sending email as plaintext.`);
    return email;
  }
}

// ─── Step 4: Solve reCAPTCHA v2 Standard WITH Proxy ───
async function solveCaptcha(): Promise<string | null> {
  log('CAPTCHA', 'Solving reCAPTCHA v2 Standard via CaptchaSolv WITH residential proxy...');
  
  const proxyParams = parseProxyForCaptchaSolv(PROXY_URL);
  
  const createPayload = {
    clientKey: CAPTCHASOLV_API_KEY,
    task: {
      type: 'RecaptchaV2Task',
      websiteURL: TERABOX_BASE,
      websiteKey: RECAPTCHA_SITEKEY,
      ...proxyParams,
    },
  };
  
  log('CAPTCHA', `Creating RecaptchaV2Task (proxy: ${proxyParams.proxyAddress}:${proxyParams.proxyPort})...`);
  
  try {
    // Create task
    const createResp = await fetch(`${CAPTCHASOLV_BASE}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    });
    const createData = await createResp.json() as any;
    log('CAPTCHA', `createTask: errorId=${createData.errorId}, taskId=${createData.taskId || 'N/A'}`);
    
    if (createData.errorId && createData.errorId !== 0) {
      log('CAPTCHA', `FAILED: ${createData.errorDescription} (${createData.errorCode})`);
      return null;
    }
    
    const taskId = createData.taskId;
    
    // Poll for result
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 5000));
      
      const resultResp = await fetch(`${CAPTCHASOLV_BASE}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: CAPTCHASOLV_API_KEY, taskId }),
      });
      const resultData = await resultResp.json() as any;
      
      if (resultData.status === 'ready') {
        const token = resultData.solution?.token || resultData.solution?.gRecaptchaResponse;
        log('CAPTCHA', `SOLVED! Token length: ${token?.length || 0}, time: ${(i+1)*5}s`);
        return token;
      }
      
      if (resultData.errorId && resultData.errorId !== 0) {
        if (resultData.errorCode === 'ERROR_LIMIT_EXCEEDED') {
          log('CAPTCHA', `Rate limited (${resultData.errorCode}). Waiting 15s...`);
          await new Promise(r => setTimeout(r, 15000));
          continue;
        }
        log('CAPTCHA', `FAILED: ${resultData.errorDescription} (${resultData.errorCode})`);
        return null;
      }
      
      log('CAPTCHA', `Poll ${i+1}/30: status=${resultData.status || 'processing'}...`);
    }
    
    log('CAPTCHA', 'FAILED: Timeout after 150s');
    return null;
  } catch (err: any) {
    log('CAPTCHA', `FAILED: ${err.message}`);
    return null;
  }
}

// ─── Step 5: TeraBox sendcode ───
function sendcode(email: string, gIdentity: string, encrypted: boolean): any {
  log('SENDCODE', 'Calling sendcode with captcha token via proxy...');
  
  const commonParams = {
    app_id: '250528',
    web: '1',
    channel: 'dubox',
    clienttype: '0',
  };
  
  const bodyParams: Record<string, string> = {
    ...commonParams,
    email,
    op_type: '1',
    pass_version: '3.0',
    reg_source: 'share',
    koltype: '0',
    g_identity: gIdentity,
  };
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Referer': `${TERABOX_BASE}/`,
    'Origin': TERABOX_BASE,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };
  
  if (encrypted) {
    headers['fs-ex-st'] = '1';
  }
  
  const body = new URLSearchParams(bodyParams).toString();
  
  try {
    const resp = curl(`${TERABOX_BASE}/passport/register_v4/sendcode`, {
      method: 'POST',
      data: body,
      headers,
      proxy: PROXY_URL,
      timeout: 30,
    });
    const data = JSON.parse(resp);
    log('SENDCODE', `Response: ${JSON.stringify(data).substring(0, 500)}`);
    return data;
  } catch (err: any) {
    log('SENDCODE', `FAILED: ${err.message}`);
    return null;
  }
}

// ─── Main ───
async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  TeraBox Signup Pipeline — End-to-End Test');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Email: ${TEST_EMAIL}`);
  console.log(`Proxy: ${PROXY_URL.replace(/:[^@]+@/, ':****@')}`);
  console.log(`Sitekey: ${RECAPTCHA_SITEKEY}`);
  console.log('═══════════════════════════════════════════════════════');
  
  // Step 1: Proxy
  if (!testProxy()) { console.log('\n❌ Proxy FAILED'); process.exit(1); }
  console.log('✅ Proxy OK');
  
  // Step 2: Get pubkey
  const pubkey = getPubKey();
  if (!pubkey) { console.log('\n❌ Pubkey FAILED'); process.exit(1); }
  console.log('✅ Pubkey OK');
  
  // Step 3: Encrypt email
  const encryptedEmail = rsaEncryptEmail(TEST_EMAIL, pubkey.pp1);
  const isEncrypted = encryptedEmail !== TEST_EMAIL;
  log('ENCRYPT', `Email: ${TEST_EMAIL} → ${isEncrypted ? 'ENCRYPTED' : 'PLAINTEXT'}`);
  
  // Step 4: Solve captcha
  console.log('\n━━━ CAPTCHA SOLVING ━━━');
  const captchaToken = await solveCaptcha();
  if (!captchaToken) { console.log('\n❌ Captcha FAILED'); process.exit(1); }
  console.log(`✅ Captcha solved! Token: ${captchaToken.substring(0, 60)}...`);
  
  // Step 5: Sendcode
  console.log('\n━━━ SENDCODE (OTP) ━━━');
  const result = sendcode(encryptedEmail, captchaToken, isEncrypted);
  
  if (!result) {
    console.log('\n❌ Sendcode request FAILED');
    process.exit(1);
  }
  
  const errno = result.errno ?? result.error_code ?? result.code;
  
  if (errno === 0) {
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('  ✅✅✅ PIPELINE WORKS END-TO-END! ✅✅✅');
    console.log(`  OTP sent to: ${TEST_EMAIL}`);
    console.log('═══════════════════════════════════════════════════════');
    process.exit(0);
  }
  
  // Captcha rejected → try with fresh token
  if (errno === 400090 || errno === 460030 || errno === 106) {
    console.log(`\n⚠️ Captcha rejected (errno ${errno}). Solving again with fresh token...`);
    const token2 = await solveCaptcha();
    if (token2) {
      console.log(`✅ Fresh captcha solved. Retrying sendcode...`);
      const result2 = sendcode(encryptedEmail, token2, isEncrypted);
      if (result2) {
        const errno2 = result2.errno ?? result2.error_code ?? result2.code;
        if (errno2 === 0) {
          console.log('\n  ✅✅✅ PIPELINE WORKS ON RETRY! ✅✅✅');
          process.exit(0);
        }
        console.log(`\n❌ Retry failed: errno=${errno2}, msg=${result2.errmsg || result2.msg}`);
      }
    }
  }
  
  console.log(`\n❌ Pipeline failed at sendcode: errno=${errno}, msg=${result.errmsg || result.msg}`);
  console.log(`Full response: ${JSON.stringify(result)}`);
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
