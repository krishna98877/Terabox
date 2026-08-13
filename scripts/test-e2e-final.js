/**
 * Complete E2E Test — TeraBox Signup Pipeline (FINAL)
 * 
 * Key findings:
 * - pp1 from getpubkey is a RAW RSA modulus (N), not SPKI format
 * - Must build RSA key from N + e=65537 using forge.pki.setRsaPublicKey()
 * - CaptchaSolv RecaptchaV2Task with proxy works (sometimes)
 * - CaptchaSolv RecaptchaV2TaskProxyless works (sometimes)
 * - Must solve captcha and use token IMMEDIATELY (expires ~2 min)
 * - Must visit TeraBox page first to get session cookies
 */

const CAPTCHASOLV_KEY = '40fd4b6c-efd9-4a07-99df-53b0cb3888db';
const CAPTCHASOLV_BASE = 'https://v1.captchasolv.com';
const SITEKEY = '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';
const TERABOX = 'https://www.1024terabox.com';
const PROXY = 'http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754';
const EMAIL = 'e2etest' + Date.now() + '@gmail.com';

const { execSync } = require('child_process');
const forge = require('node-forge');
const fs = require('fs');

function curl(url, opts) {
  opts = opts || {};
  var args = ['curl', '-s', '--max-time', String(opts.timeout || 20)];
  if (opts.proxy) args.push('--proxy', '"' + opts.proxy + '"');
  if (opts.cookieJar) {
    args.push('-b', opts.cookieJar);
    args.push('-c', opts.cookieJar);
  }
  if (opts.method === 'POST') args.push('-X', 'POST');
  var headers = opts.headers || {};
  for (var k in headers) {
    if (headers[k] !== undefined && headers[k] !== null) {
      args.push('-H', '"' + k + ': ' + headers[k] + '"');
    }
  }
  if (opts.data) {
    for (var dk in opts.data) {
      args.push('--data-urlencode', dk + '=' + opts.data[dk]);
    }
  }
  args.push('"' + url + '"');
  try {
    return execSync(args.join(' '), { encoding: 'utf-8', timeout: (opts.timeout || 20) * 1000 + 10000 });
  } catch(e) {
    return null;
  }
}

var chromeHeaders = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Referer': TERABOX + '/',
  'Origin': TERABOX,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="131", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
};

function rsaEncryptWithRawModulus(data, pp1) {
  // pp1 is a base64url-encoded RAW RSA modulus (N)
  // Standard RSA exponent e = 65537 (0x10001)
  var standardBase64 = pp1.replace(/-/g, '+').replace(/_/g, '/');
  var keyBytes = Buffer.from(standardBase64, 'base64');
  var nHex = keyBytes.toString('hex');
  
  var n = new forge.jsbn.BigInteger(nHex, 16);
  var e = new forge.jsbn.BigInteger('10001', 16);
  var publicKey = forge.pki.setRsaPublicKey(n, e);
  
  var encrypted = publicKey.encrypt(data, 'RSAES-PKCS1-V1_5');
  return forge.util.encode64(encrypted);
}

async function solveCaptcha(proxyAddress, proxyPort) {
  var taskDef = {
    type: 'RecaptchaV2Task',
    websiteURL: TERABOX,
    websiteKey: SITEKEY,
    proxyType: 'http',
    proxyAddress: proxyAddress,
    proxyPort: proxyPort,
    proxyLogin: 'zvuvwjcq',
    proxyPassword: 'd0y8143zsfif',
  };
  
  console.log('  Creating RecaptchaV2Task (proxy: ' + proxyAddress + ':' + proxyPort + ')...');
  var createResp = await fetch(CAPTCHASOLV_BASE + '/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: CAPTCHASOLV_KEY, task: taskDef }),
  });
  var createData = await createResp.json();
  
  if (createData.errorId && createData.errorId !== 0) {
    console.log('  Create FAILED: ' + createData.errorCode + ' — ' + createData.errorDescription);
    return null;
  }
  
  console.log('  Task ID: ' + createData.taskId);
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
      var token = (pollData.solution && pollData.solution.token) || (pollData.solution && pollData.solution.gRecaptchaResponse);
      console.log('  SOLVED in ' + ((Date.now() - startTime) / 1000).toFixed(0) + 's! Token length: ' + (token ? token.length : 0));
      return token;
    }
    
    if (pollData.errorId && pollData.errorId !== 0) {
      if (pollData.errorCode === 'ERROR_LIMIT_EXCEEDED') {
        console.log('  Rate limited, waiting 15s...');
        await new Promise(function(r) { setTimeout(r, 15000); });
        continue;
      }
      console.log('  Error: ' + pollData.errorCode + ' — ' + pollData.errorDescription);
      if (pollData.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') return null;
    }
    
    if (i % 3 === 2) console.log('  Poll ' + (i+1) + '/24 (' + ((i+1)*5) + 's)...');
  }
  
  return null;
}

async function solveCaptchaProxyless() {
  console.log('  Creating RecaptchaV2TaskProxyless...');
  var createResp = await fetch(CAPTCHASOLV_BASE + '/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: CAPTCHASOLV_KEY,
      task: {
        type: 'RecaptchaV2TaskProxyless',
        websiteURL: TERABOX,
        websiteKey: SITEKEY,
      },
    }),
  });
  var createData = await createResp.json();
  console.log('  Task ID: ' + createData.taskId);
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
      var token = (pollData.solution && pollData.solution.token) || (pollData.solution && pollData.solution.gRecaptchaResponse);
      console.log('  SOLVED in ' + ((Date.now() - startTime) / 1000).toFixed(0) + 's! Token length: ' + (token ? token.length : 0));
      return token;
    }
    
    if (pollData.errorId && pollData.errorId !== 0) {
      console.log('  Error: ' + pollData.errorCode);
      if (pollData.errorCode === 'ERROR_CAPTCHA_UNSOLVABLE') return null;
    }
    
    if (i % 3 === 2) console.log('  Poll ' + (i+1) + '/24...');
  }
  
  return null;
}

async function main() {
  console.log('============================================================');
  console.log('  TeraBox Signup Pipeline — Complete E2E Test (FINAL)');
  console.log('============================================================');
  console.log('Email: ' + EMAIL);
  
  var cookieJar = '/tmp/terabox_session.txt';
  
  // Step 1: Visit main page to get session cookies
  console.log('\n[1] Getting session cookies...');
  curl(TERABOX + '/', { proxy: PROXY, cookieJar: cookieJar, timeout: 15 });
  console.log('  Session cookies obtained');
  
  // Step 2: Get pubkey
  console.log('\n[2] Getting pubkey...');
  var pubkeyResp = curl(TERABOX + '/passport/getpubkey?clienttype=0', {
    proxy: PROXY, cookieJar: cookieJar, timeout: 15,
  });
  var pubkeyData = JSON.parse(pubkeyResp);
  var pp1 = pubkeyData.data && pubkeyData.data.pp1;
  console.log('  pp1 length: ' + (pp1 ? pp1.length : 0));

  // Step 3: RSA encrypt email using raw modulus
  console.log('\n[3] RSA-encrypting email with raw modulus...');
  var encryptedEmail;
  try {
    encryptedEmail = rsaEncryptWithRawModulus(EMAIL, pp1);
    console.log('  RSA encryption OK! Length: ' + encryptedEmail.length);
  } catch(err) {
    console.log('  RSA FAILED: ' + err.message + '. Using plaintext.');
    encryptedEmail = EMAIL;
  }

  // Step 4: Solve captcha (try proxyless first as it's faster, then with proxy)
  console.log('\n[4] Solving reCAPTCHA v2 Standard...');
  console.log('  Strategy: try proxyless first, then with proxy');
  
  var captchaToken = await solveCaptchaProxyless();
  
  if (!captchaToken) {
    console.log('  Proxyless failed. Trying with proxy...');
    captchaToken = await solveCaptcha('31.59.20.176', 6754);
  }
  
  if (!captchaToken) {
    console.log('  Proxy 1 failed. Trying proxy 2...');
    captchaToken = await solveCaptcha('45.38.107.97', 6014);
  }
  
  if (!captchaToken) {
    console.log('  All captcha attempts failed.');
    process.exit(1);
  }

  // Step 5: IMMEDIATELY call sendcode
  console.log('\n[5] Calling sendcode IMMEDIATELY...');
  var sendHeaders = Object.assign({}, chromeHeaders);
  sendHeaders['fs-ex-st'] = '1'; // RSA-encrypted email
  
  var sendcodeResp = curl(TERABOX + '/passport/register_v4/sendcode', {
    method: 'POST',
    proxy: PROXY,
    cookieJar: cookieJar,
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
  
  if (!sendcodeResp) {
    console.log('  sendcode request FAILED (no response)');
    process.exit(1);
  }
  
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
  
  console.log('\nsendcode errno=' + errno + ', msg=' + msg);
  
  // If captcha rejected, solve again and retry
  if (errno === 400090 || errno === 460030 || errno === 106 || errno === 10) {
    console.log('\n[6] Captcha rejected (errno ' + errno + '). Solving fresh and retrying...');
    var freshToken = await solveCaptchaProxyless();
    if (!freshToken) freshToken = await solveCaptcha('31.59.20.176', 6754);
    
    if (freshToken) {
      console.log('  Fresh token obtained! Retrying sendcode IMMEDIATELY...');
      var retryResp = curl(TERABOX + '/passport/register_v4/sendcode', {
        method: 'POST',
        proxy: PROXY,
        cookieJar: cookieJar,
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
          g_identity: freshToken,
        },
      });
      
      if (retryResp) {
        console.log('  Retry response: ' + retryResp);
        var retryData = JSON.parse(retryResp);
        var retryErrno = retryData.errno !== undefined ? retryData.errno : (retryData.error_code !== undefined ? retryData.error_code : retryData.code);
        if (retryErrno === 0) {
          console.log('\n  >>> PIPELINE WORKS ON RETRY! <<<');
          process.exit(0);
        }
      }
    }
  }
  
  console.log('\nPipeline failed.');
  process.exit(1);
}

main().catch(function(err) { console.error('Fatal:', err); process.exit(1); });
