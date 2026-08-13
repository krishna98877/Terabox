/**
 * Fast End-to-End Signup Test with Free Proxies
 * Optimized: shorter timeouts, fewer proxies, faster validation
 */

import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

// ─── Config ───
const CAPTCHASOLV_API_KEY = '40fd4b6c-efd9-4a07-99df-53b0cb3888db';
const CAPTCHASOLV_BASE = 'https://v1.captchasolv.com';
const TERABOX_BASE = 'https://www.1024terabox.com';
const APP_ID = '250528';

// ─── Utility ───
function nodeFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const mod = isHttps ? https : http;
    const timeout = options.timeout || 10000;
    
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout,
    };

    if (options.agent) reqOptions.agent = options.agent;

    const timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timeout ${timeout}ms`));
    }, timeout + 2000);

    const req = mod.request(reqOptions, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        clearTimeout(timer);
        const body = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, headers: res.headers, body, ok: res.statusCode >= 200 && res.statusCode < 300 });
      });
      res.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
    
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    
    if (options.body) req.write(options.body);
    req.end();
  });
}

let HttpsProxyAgent;
try {
  const mod = await import('https-proxy-agent');
  HttpsProxyAgent = mod.HttpsProxyAgent;
} catch {
  console.error('❌ npm install https-proxy-agent first');
  process.exit(1);
}

function makeAgent(proxyUrl) { return new HttpsProxyAgent(proxyUrl); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Fetch proxies ───
async function fetchProxies() {
  console.log('📡 Fetching free HTTP proxies...\n');
  const allProxies = [];
  
  // Source 1: ProxyScrape elite HTTP
  try {
    const res = await nodeFetch('https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=5000&proxy_format=protocolipport&anonymity=elite&country=us,gb,de,ca,fr,nl', { timeout: 10000 });
    const lines = res.body.trim().split('\n').filter(l => l.includes('://'));
    console.log(`  ProxyScrape elite: ${lines.length} proxies`);
    allProxies.push(...lines.map(l => l.trim()));
  } catch (e) { console.warn(`  ProxyScrape elite failed: ${e.message}`); }
  
  // Source 2: ProxyScrape all HTTP
  try {
    const res = await nodeFetch('https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=5000&proxy_format=protocolipport&anonymity=anonymous', { timeout: 10000 });
    const lines = res.body.trim().split('\n').filter(l => l.includes('://'));
    console.log(`  ProxyScrape anonymous: ${lines.length} proxies`);
    allProxies.push(...lines.map(l => l.trim()));
  } catch (e) { console.warn(`  ProxyScrape anon failed: ${e.message}`); }
  
  // Source 3: Geonode
  try {
    const res = await nodeFetch('https://proxylist.geonode.com/free-proxy/list?limit=30&page=1&sort=score&order=desc&type=http&protocol=http', { timeout: 10000 });
    const data = JSON.parse(res.body);
    const proxies = (data.data || []).map(p => `http://${p.ip}:${p.port}`);
    console.log(`  Geonode: ${proxies.length} proxies`);
    allProxies.push(...proxies);
  } catch (e) { console.warn(`  Geonode failed: ${e.message}`); }
  
  // Deduplicate
  const unique = [...new Set(allProxies.filter(p => p && p.startsWith('http')))];
  console.log(`\n  Total unique: ${unique.length}`);
  return unique;
}

// ─── Validate single proxy ───
async function validateProxy(proxyUrl) {
  const agent = makeAgent(proxyUrl);
  try {
    const res = await nodeFetch('https://httpbin.org/ip', { agent, timeout: 5000 });
    if (!res.ok) return null;
    const data = JSON.parse(res.body);
    return { url: proxyUrl, ip: data.origin };
  } catch {
    return null;
  }
}

// ─── TeraBox sitekey extraction ───
async function getSiteKey(proxyUrl) {
  console.log('\n🔍 Extracting reCAPTCHA sitekey...');
  const agent = proxyUrl ? makeAgent(proxyUrl) : undefined;
  try {
    const res = await nodeFetch(`${TERABOX_BASE}/passport/account/create`, {
      agent, timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    });
    const html = res.body;
    
    // Multiple patterns
    const patterns = [
      /sitekey['":\s]+['"]([0-9A-Za-z_-]{39,41})['"]/,
      /data-sitekey=['"]([0-9A-Za-z_-]{39,41})['"]/,
      /render['"]\s*,\s*['"]([0-9A-Za-z_-]{39,41})['"]/,
      /k=([0-9A-Za-z_-]{39,41})/,
    ];
    
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1]) { console.log(`  ✅ Sitekey: ${m[1]}`); return m[1]; }
    }
    
    // Search for any 40-char key-like string
    const anyKey = html.match(/([0-9A-Za-z_-]{40})/);
    if (anyKey?.[1] && anyKey[1].includes('-')) {
      console.log(`  ✅ Possible sitekey: ${anyKey[1]}`);
      return anyKey[1];
    }
    
    console.log('  ⚠️ No sitekey found in HTML — will use errmsg sitekey');
    return null;
  } catch (e) {
    console.warn(`  ⚠️ Sitekey fetch failed: ${e.message}`);
    return null;
  }
}

// ─── Get pubkey ───
async function getPubKey(proxyUrl) {
  const agent = proxyUrl ? makeAgent(proxyUrl) : undefined;
  const params = `app_id=${APP_ID}&web=1&channel=dubox&clienttype=0`;
  try {
    const res = await nodeFetch(`${TERABOX_BASE}/passport/getpubkey?${params}`, {
      method: 'POST', agent, timeout: 15000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });
    const data = JSON.parse(res.body);
    console.log(`  getpubkey: errno=${data.errno}, hasKey=${!!(data.data?.pp1 || data.pp1)}`);
    return data;
  } catch (e) {
    console.error(`  getpubkey failed: ${e.message}`);
    return null;
  }
}

// ─── Solve reCAPTCHA ───
async function solveCaptcha(siteKey, pageUrl, proxyUrl, type = 'v2') {
  const isEnt = type === 'v2ent';
  const taskType = isEnt 
    ? (proxyUrl ? 'RecaptchaV2EnterpriseTask' : 'RecaptchaV2EnterpriseTaskProxyless')
    : (proxyUrl ? 'RecaptchaV2Task' : 'RecaptchaV2TaskProxyless');
  
  console.log(`\n🧩 Solving ${isEnt ? 'v2 Enterprise' : 'v2 Standard'} reCAPTCHA...`);
  console.log(`  Type: ${taskType}, Proxy: ${proxyUrl ? 'YES' : 'NO'}`);
  
  const task = {
    type: taskType,
    websiteURL: pageUrl,
    websiteKey: siteKey,
  };
  
  if (isEnt) task.enterprisePayload = { s: '' };
  
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    task.proxyType = 'http';
    task.proxyAddress = u.hostname;
    task.proxyPort = parseInt(u.port || '80');
    if (u.username) task.proxyLogin = u.username;
    if (u.password) task.proxyPassword = u.password;
  }
  
  // Create task
  const createRes = await nodeFetch(`${CAPTCHASOLV_BASE}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: CAPTCHASOLV_API_KEY, task }),
    timeout: 30000,
  });
  
  const createData = JSON.parse(createRes.body);
  console.log(`  Create: ${JSON.stringify(createData).substring(0, 200)}`);
  
  if (createData.errorId && createData.errorId !== 0) {
    return { success: false, error: `${createData.errorCode}: ${createData.errorDescription}` };
  }
  
  const taskId = createData.taskId;
  if (!taskId) return { success: false, error: 'No taskId', raw: createData };
  
  console.log(`  TaskID: ${taskId} — polling...`);
  
  // Poll
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    try {
      const rRes = await nodeFetch(`${CAPTCHASOLV_BASE}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: CAPTCHASOLV_API_KEY, taskId }),
        timeout: 15000,
      });
      const rData = JSON.parse(rRes.body);
      
      if (rData.status === 'ready') {
        const token = rData.solution?.gRecaptchaResponse || rData.solution?.token;
        if (token) {
          console.log(`  ✅ SOLVED! Token length: ${token.length}, time: ~${(i+1)*5}s`);
          return { success: true, token, solveTime: (i+1)*5 };
        }
        return { success: false, error: 'No token in solution' };
      }
      
      if (rData.errorId && rData.errorId !== 0) {
        if (rData.errorCode === 'ERROR_LIMIT_EXCEEDED') {
          console.log(`  ⏳ Rate limited — waiting 10s...`);
          await sleep(10000);
          continue;
        }
        return { success: false, error: `${rData.errorCode}: ${rData.errorDescription}` };
      }
      
      process.stdout.write(`  ⏳ ${((i+1)*5)}s `);
    } catch (e) {
      process.stdout.write(`  ⚠️ poll err `);
    }
  }
  console.log('');
  return { success: false, error: 'Timeout 120s' };
}

// ─── Send code ───
async function sendCode(proxyUrl, gIdentity) {
  const email = `test${Date.now()}${Math.random().toString(36).slice(2,6)}@catchmail.io`;
  const agent = proxyUrl ? makeAgent(proxyUrl) : undefined;
  const params = `app_id=${APP_ID}&web=1&channel=dubox&clienttype=0`;
  
  const bodyObj = {
    email,
    op_type: '1',
    pass_version: '3.0',
    reg_source: 'share',
    koltype: '0',
  };
  if (gIdentity) bodyObj.g_identity = gIdentity;
  
  const body = new URLSearchParams(Object.entries(bodyObj).map(([k,v]) => [k,v])).toString();
  
  console.log(`\n📤 Sending code to ${email} (g_identity: ${gIdentity ? gIdentity.substring(0,20)+'...' : 'none'})`);
  
  try {
    const res = await nodeFetch(`${TERABOX_BASE}/passport/register_v4/sendcode?${params}`, {
      method: 'POST', agent, timeout: 30000, body,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Referer': `${TERABOX_BASE}/`,
        'Origin': TERABOX_BASE,
        'Accept': 'application/json, text/plain, */*',
      },
    });
    
    let data;
    try { data = JSON.parse(res.body); } catch { data = { raw: res.body.substring(0, 300) }; }
    
    const errno = data.errno ?? data.error_code ?? data.code;
    const isCaptcha = [400090, 460030, 106, 10, 18].includes(errno);
    
    console.log(`  sendcode result: errno=${errno}, needsCaptcha=${isCaptcha}`);
    console.log(`  Response: ${JSON.stringify(data).substring(0, 400)}`);
    
    // Extract sitekey from errmsg if captcha needed
    let captchaSiteKey = null;
    if (isCaptcha && data.errmsg) {
      const m = data.errmsg.match(/sitekey[=:\s]+([0-9A-Za-z_-]{39,41})/i) ||
                data.errmsg.match(/([0-9A-Za-z_-]{40})/);
      if (m?.[1]) {
        captchaSiteKey = m[1];
        console.log(`  Captcha sitekey from errmsg: ${captchaSiteKey}`);
      }
    }
    
    return { success: errno === 0, errno, needsCaptcha: isCaptcha, email, data, captchaSiteKey };
  } catch (e) {
    return { success: false, error: e.message, email };
  }
}

// ═══════════════════════════════════════════════════
// ★★★ MAIN ★★★
// ═══════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  TeraBox Signup Test — Free Proxy + CaptchaSolv     ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  
  // Phase 1: Fetch proxies
  const proxies = await fetchProxies();
  if (proxies.length === 0) {
    console.error('❌ No proxies found!');
    process.exit(1);
  }
  
  // Phase 2: Validate (top 25, batches of 5, 5s timeout each)
  console.log('\n━━━ Validating proxies (top 25, 5s timeout) ━━━');
  const validProxies = [];
  const testSlice = proxies.slice(0, 25);
  
  for (let i = 0; i < testSlice.length; i += 5) {
    const batch = testSlice.slice(i, i + 5);
    const results = await Promise.allSettled(batch.map(p => validateProxy(p)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        validProxies.push(r.value);
        console.log(`  ✅ ${r.value.url} → IP: ${r.value.ip}`);
      }
    }
  }
  
  console.log(`\n  Valid: ${validProxies.length}/${testSlice.length}`);
  
  if (validProxies.length === 0) {
    console.error('❌ No valid proxies. Free datacenter proxies are too slow/unreliable.');
    console.log('\n💡 Use residential proxies: Webshare.io (10 free), IPRoyal, or BrightData.');
    process.exit(1);
  }
  
  // Phase 3: Test signup with best proxy
  console.log('\n━━━ Testing signup flow ━━━');
  
  for (let i = 0; i < Math.min(3, validProxies.length); i++) {
    const proxy = validProxies[i];
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  Proxy ${i+1}: ${proxy.url} (IP: ${proxy.ip})`);
    console.log(`${'═'.repeat(55)}`);
    
    // A: Test pubkey
    const pubkey = await getPubKey(proxy.url);
    if (!pubkey || (pubkey.errno !== 0 && pubkey.code !== 0)) {
      console.warn('  ❌ Pubkey failed — skip');
      continue;
    }
    
    // B: Send code WITHOUT captcha first (see if TeraBox even needs captcha)
    console.log('\n  Step 1: Try sendcode without captcha...');
    const noCaptchaResult = await sendCode(proxy.url, null);
    
    if (noCaptchaResult.success) {
      console.log(`\n  🎉🎉🎉 SUCCESS without captcha! OTP sent to ${noCaptchaResult.email}!`);
      console.log(`  Proxy ${proxy.url} works perfectly with TeraBox!`);
      
      // Save working proxy
      const fs = await import('node:fs');
      fs.mkdirSync('/home/z/my-project/upload', { recursive: true });
      fs.writeFileSync('/home/z/my-project/upload/proxies.txt', proxy.url + '\n');
      console.log('  💾 Saved to /home/z/my-project/upload/proxies.txt');
      return;
    }
    
    if (!noCaptchaResult.needsCaptcha) {
      console.log(`  ❌ sendcode failed (not captcha): errno ${noCaptchaResult.errno}`);
      continue;
    }
    
    console.log(`  TeraBox wants captcha (errno ${noCaptchaResult.errno}) — solving...`);
    
    // C: Get sitekey
    let siteKey = noCaptchaResult.captchaSiteKey;
    if (!siteKey) {
      siteKey = await getSiteKey(proxy.url);
    }
    if (!siteKey) {
      console.log('  ⚠️ No sitekey — skipping');
      continue;
    }
    
    // D: Solve v2 Standard (WITH proxy — proven to work!)
    const pageUrl = `${TERABOX_BASE}/passport/account/create`;
    const captchaResult = await solveCaptcha(siteKey, pageUrl, proxy.url, 'v2');
    
    if (!captchaResult.success) {
      console.error(`  ❌ v2 Standard failed: ${captchaResult.error}`);
      
      // Try v2 Enterprise as fallback
      console.log('\n  🔄 Trying v2 Enterprise...');
      const entResult = await solveCaptcha(siteKey, pageUrl, proxy.url, 'v2ent');
      if (!entResult.success) {
        console.error(`  ❌ v2 Enterprise also failed: ${entResult.error}`);
        continue;
      }
      
      // Try sendcode with enterprise token
      const entSend = await sendCode(proxy.url, entResult.token);
      if (entSend.success) {
        console.log(`\n  🎉🎉🎉 SUCCESS with v2 Enterprise! OTP sent!`);
        const fs = await import('node:fs');
        fs.mkdirSync('/home/z/my-project/upload', { recursive: true });
        fs.writeFileSync('/home/z/my-project/upload/proxies.txt', proxy.url + '\n');
        return;
      }
      console.log(`  ❌ v2 Enterprise token rejected: errno ${entSend.errno}`);
      continue;
    }
    
    // E: Send code with captcha token
    console.log('\n  Step 2: Send code WITH captcha token...');
    const sendResult = await sendCode(proxy.url, captchaResult.token);
    
    if (sendResult.success) {
      console.log(`\n  🎉🎉🎉 SUCCESS! OTP sent to ${sendResult.email}!`);
      console.log(`  Full pipeline works: proxy → captcha → sendcode → OTP!`);
      console.log(`  Proxy: ${proxy.url}, IP: ${proxy.ip}`);
      
      // Save working proxy
      const fs = await import('node:fs');
      fs.mkdirSync('/home/z/my-project/upload', { recursive: true });
      fs.writeFileSync('/home/z/my-project/upload/proxies.txt', proxy.url + '\n');
      console.log('  💾 Saved to /home/z/my-project/upload/proxies.txt');
      return;
    }
    
    if (sendResult.needsCaptcha) {
      console.log(`  ⚠️ Token rejected — still needs captcha (errno ${sendResult.errno})`);
      
      // Extract new sitekey if provided
      let newSiteKey = sendResult.captchaSiteKey || siteKey;
      
      // Try v2 Enterprise with new sitekey
      console.log('\n  🔄 Retrying with v2 Enterprise...');
      const entResult = await solveCaptcha(newSiteKey, pageUrl, proxy.url, 'v2ent');
      if (entResult.success) {
        const retrySend = await sendCode(proxy.url, entResult.token);
        if (retrySend.success) {
          console.log(`\n  🎉🎉🎉 SUCCESS with v2 Enterprise retry!`);
          const fs = await import('node:fs');
          fs.mkdirSync('/home/z/my-project/upload', { recursive: true });
          fs.writeFileSync('/home/z/my-project/upload/proxies.txt', proxy.url + '\n');
          return;
        }
        console.log(`  ❌ v2 Enterprise also rejected: errno ${retrySend.errno}`);
      }
    } else {
      console.log(`  ❌ sendcode failed: errno ${sendResult.errno}`);
    }
  }
  
  console.log('\n❌ All proxy attempts failed.');
  console.log('💡 Free datacenter proxies may be too slow/flagged for TeraBox.');
  console.log('   Try: Webshare.io (10 free residential), IPRoyal, or BrightData.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
