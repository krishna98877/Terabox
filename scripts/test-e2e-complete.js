/**
 * Complete E2E Test — TeraBox Signup Pipeline
 * Uses node-forge for RSA encryption, CaptchaSolv for captcha, proxy for everything
 */

const CAPTCHASOLV_KEY = '40fd4b6c-efd9-4a07-99df-53b0cb3888db';
const CAPTCHASOLV_BASE = 'https://v1.captchasolv.com';
const SITEKEY = '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';
const TERABOX = 'https://www.1024terabox.com';
const PROXY = 'http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754';
const EMAIL = 'e2etest' + Date.now() + '@gmail.com';

const { execSync } = require('child_process');
const forge = require('node-forge');

function curl(url, opts) {
  opts = opts || {};
  const args = ['curl', '-s', '--max-time', String(opts.timeout || 20)];
  if (opts.proxy) args.push('--proxy', '"' + opts.proxy + '"');
  if (opts.method === 'POST') args.push('-X', 'POST');
  var headers = opts.headers || {};
  for (var k in headers) {
    if (headers[k] !== undefined) args.push('-H', '"' + k + ': ' + headers[k] + '"');
  }
  if (opts.data) {
    for (var dk in opts.data) {
      args.push('--data-urlencode', dk + '=' + opts.data[dk]);
    }
  }
  args.push('"' + url + '"');
  return execSync(args.join(' '), { encoding: 'utf-8', timeout: (opts.timeout || 20) * 1000 + 10000 });
}

var chromeHeaders = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': TERABOX + '/',
  'Origin': TERABOX,
  'Accept': 'application/json, text/plain, */*',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

async function main() {
  console.log('============================================================');
  console.log('  TeraBox Signup Pipeline — Complete E2E Test');
  console.log('============================================================');
  console.log('Email: ' + EMAIL);
  
  // Step 1: Get pubkey
  console.log('\n[1] Getting pubkey...');
  var pubkeyRaw = curl(TERABOX + '/passport/getpubkey?clienttype=0', {
    proxy: PROXY,
    timeout: 15,
  });
  var pubkeyResp = JSON.parse(pubkeyRaw);
  var pp1 = pubkeyResp.data && pubkeyResp.data.pp1;
  console.log('  Pubkey OK — pp1 length: ' + (pp1 ? pp1.length : 0));

  // Step 2: RSA encrypt email
  console.log('\n[2] RSA-encrypting email...');
  var encryptedEmail = EMAIL;
  var isEncrypted = false;
  try {
    var standardBase64 = pp1.replace(/-/g, '+').replace(/_/g, '/');
    var keyBytes = standardBase64.length * 3 / 4;
    
    if (keyBytes < 200 || keyBytes > 600) {
      console.log('  pp1 is ' + Math.round(keyBytes) + ' bytes — not standard RSA SPKI. Using plaintext.');
    } else {
      var lines = standardBase64.match(/.{1,64}/g) || [standardBase64];
      var pemKey = '-----BEGIN PUBLIC KEY-----\n' + lines.join('\n') + '\n-----END PUBLIC KEY-----';
      var pki = forge.pki;
      var publicKey = pki.publicKeyFromPem(pemKey);
      var encrypted = publicKey.encrypt(EMAIL, 'RSAES-PKCS1-V1_5');
      encryptedEmail = forge.util.encode64(encrypted);
      isEncrypted = true;
      console.log('  RSA encryption OK — encrypted length: ' + encryptedEmail.length);
    }
  } catch (err) {
    console.log('  RSA failed: ' + err.message + '. Using plaintext.');
  }

  // Step 3: Solve captcha
  console.log('\n[3] Solving reCAPTCHA v2 Standard (proxy-bound)...');
  var createResp = await fetch(CAPTCHASOLV_BASE + '/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: CAPTCHASOLV_KEY,
      task: {
        type: 'RecaptchaV2Task',
        websiteURL: TERABOX,
        websiteKey: SITEKEY,
        proxyType: 'http',
        proxyAddress: '31.59.20.176',
        proxyPort: 6754,
        proxyLogin: 'zvuvwjcq',
        proxyPassword: 'd0y8143zsfif',
      },
    }),
  });
  var createData = await createResp.json();
  console.log('  Task created: ' + createData.taskId);
  
  var captchaToken = null;
  var startTime = Date.now();
  
  for (var i = 0; i < 24; i++) {
    await new Promise(function(r) { setTimeout(r, 5000); });
    var pollResp = await fetch(CAPTCHASOLV_BASE + '/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: CAPTCHASOLV_KEY, taskId: createData.taskId }),
    });
    var pollData = await pollResp.json();
    
    if (pollData.status === 'ready') {
      captchaToken = (pollData.solution && pollData.solution.token) || (pollData.solution && pollData.solution.gRecaptchaResponse);
      console.log('  SOLVED in ' + ((Date.now() - startTime) / 1000).toFixed(0) + 's — token length: ' + (captchaToken ? captchaToken.length : 0));
      break;
    }
    
    if (pollData.errorId && pollData.errorId !== 0) {
      console.log('  Error: ' + pollData.errorCode + ' — ' + pollData.errorDescription);
      if (pollData.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') break;
      if (pollData.errorCode === 'ERROR_LIMIT_EXCEEDED') {
        console.log('  Rate limited, waiting 15s...');
        await new Promise(function(r) { setTimeout(r, 15000); });
      }
    } else {
      console.log('  Poll ' + (i+1) + '/24...');
    }
  }
  
  if (!captchaToken) {
    console.log('\nFAILED: Captcha solving failed');
    process.exit(1);
  }

  // Step 4: IMMEDIATELY call sendcode (token expires in ~2 min!)
  console.log('\n[4] Calling sendcode IMMEDIATELY (token is time-sensitive)...');
  var sendHeaders = Object.assign({}, chromeHeaders);
  if (isEncrypted) sendHeaders['fs-ex-st'] = '1';
  
  var sendcodeResp = curl(TERABOX + '/passport/register_v4/sendcode', {
    method: 'POST',
    proxy: PROXY,
    timeout: 30,
    headers: sendHeaders,
    data: {
      app_id: '250528',
      web: '1',
      channel: 'dubox',
      clienttype: '0',
      email: encryptedEmail,
      op_type: '1',
      pass_version: '3.0',
      reg_source: 'share',
      koltype: '0',
      g_identity: captchaToken,
    },
  });
  
  console.log('  Response: ' + sendcodeResp);
  var respData = JSON.parse(sendcodeResp);
  var errno = respData.errno !== undefined ? respData.errno : (respData.error_code !== undefined ? respData.error_code : respData.code);
  var msg = respData.errmsg || respData.msg || '';
  
  if (errno === 0) {
    console.log('\n============================================================');
    console.log('  >>> PIPELINE WORKS! OTP SENT! <<<');
    console.log('  Email: ' + EMAIL);
    console.log('============================================================');
    process.exit(0);
  }
  
  console.log('\nsendcode failed: errno=' + errno + ', msg=' + msg);
  
  // If captcha rejected, retry with fresh token
  if (errno === 400090 || errno === 460030 || errno === 106 || errno === 10) {
    console.log('\n[5] Captcha rejected. Solving fresh captcha and retrying...');
    var create2 = await fetch(CAPTCHASOLV_BASE + '/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: CAPTCHASOLV_KEY,
        task: {
          type: 'RecaptchaV2Task',
          websiteURL: TERABOX,
          websiteKey: SITEKEY,
          proxyType: 'http',
          proxyAddress: '31.59.20.176',
          proxyPort: 6754,
          proxyLogin: 'zvuvwjcq',
          proxyPassword: 'd0y8143zsfif',
        },
      }),
    });
    var create2Data = await create2.json();
    
    var token2 = null;
    var start2 = Date.now();
    for (var j = 0; j < 24; j++) {
      await new Promise(function(r) { setTimeout(r, 5000); });
      var poll2 = await fetch(CAPTCHASOLV_BASE + '/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: CAPTCHASOLV_KEY, taskId: create2Data.taskId }),
      });
      var poll2Data = await poll2.json();
      if (poll2Data.status === 'ready') {
        token2 = (poll2Data.solution && poll2Data.solution.token) || (poll2Data.solution && poll2Data.solution.gRecaptchaResponse);
        console.log('  Fresh token in ' + ((Date.now() - start2) / 1000).toFixed(0) + 's! Length: ' + (token2 ? token2.length : 0));
        break;
      }
      console.log('  Retry poll ' + (j+1) + '/24...');
    }
    
    if (token2) {
      console.log('  Retrying sendcode IMMEDIATELY...');
      var resp2 = curl(TERABOX + '/passport/register_v4/sendcode', {
        method: 'POST',
        proxy: PROXY,
        timeout: 30,
        headers: sendHeaders,
        data: {
          app_id: '250528',
          web: '1',
          channel: 'dubox',
          clienttype: '0',
          email: encryptedEmail,
          op_type: '1',
          pass_version: '3.0',
          reg_source: 'share',
          koltype: '0',
          g_identity: token2,
        },
      });
      console.log('  Retry response: ' + resp2);
      var resp2Data = JSON.parse(resp2);
      var errno2 = resp2Data.errno !== undefined ? resp2Data.errno : (resp2Data.error_code !== undefined ? resp2Data.error_code : resp2Data.code);
      if (errno2 === 0) {
        console.log('\n  >>> PIPELINE WORKS ON RETRY! <<<');
        process.exit(0);
      }
      console.log('  Retry errno: ' + errno2);
    }
  }
  
  process.exit(1);
}

main().catch(function(err) { console.error('Fatal:', err); process.exit(1); });
