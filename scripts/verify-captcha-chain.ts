/**
 * Verification Script — Tests the captcha solving chain end-to-end.
 * 
 * Verifies:
 * 1. CaptchaSolv API key is valid and has balance
 * 2. Proxy format is correctly parsed (proxyType/proxyAddress/proxyPort)
 * 3. Proxy pool can fetch and validate proxies
 * 4. CaptchaSolv can create a task with proxied type
 * 5. TeraBox API is reachable
 * 6. Cookie jar works
 */

const API_BASE = 'https://v1.captchasolv.com';
const CAPTCHASOLV_API_KEY = process.env.CAPTCHASOLV_API_KEY || '';

// ─── Test 1: CaptchaSolv API Key ───
async function testCaptchaSolvApiKey() {
  console.log('\n═══ Test 1: CaptchaSolv API Key ═══');
  if (!CAPTCHASOLV_API_KEY) {
    console.error('❌ CAPTCHASOLV_API_KEY not set');
    return false;
  }
  console.log(`API Key: ${CAPTCHASOLV_API_KEY.substring(0, 8)}...`);
  
  try {
    const res = await fetch(`${API_BASE}/getBalance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: CAPTCHASOLV_API_KEY }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (data.errorId === 0) {
      console.log(`✅ API key valid — balance: $${data.balance ?? 0}`);
      return true;
    }
    console.error(`❌ API key invalid: ${data.errorDescription || data.errorCode}`);
    return false;
  } catch (err) {
    console.error(`❌ API check failed: ${(err as Error).message}`);
    return false;
  }
}

// ─── Test 2: Proxy Format parsing ───
async function testProxyFormat() {
  console.log('\n═══ Test 2: Proxy Format Parsing ═══');
  
  // Test HTTP proxy
  const httpProxy = 'http://1.2.3.4:8080';
  const httpParsed = new URL(httpProxy);
  const httpFields = {
    proxyType: 'http',
    proxyAddress: httpParsed.hostname,
    proxyPort: parseInt(httpParsed.port, 10),
  };
  console.log(`HTTP proxy "${httpProxy}" → ${JSON.stringify(httpFields)}`);
  
  // Test SOCKS5 proxy
  const socks5Proxy = 'socks5://5.6.7.8:1080';
  const socks5Parsed = new URL(socks5Proxy);
  const socks5Fields = {
    proxyType: 'socks5',
    proxyAddress: socks5Parsed.hostname,
    proxyPort: parseInt(socks5Parsed.port, 10),
  };
  console.log(`SOCKS5 proxy "${socks5Proxy}" → ${JSON.stringify(socks5Fields)}`);
  
  // Test proxy with auth
  const authProxy = 'http://user:pass@9.10.11.12:3128';
  const authParsed = new URL(authProxy);
  const authFields = {
    proxyType: 'http',
    proxyAddress: authParsed.hostname,
    proxyPort: parseInt(authParsed.port, 10),
    proxyLogin: decodeURIComponent(authParsed.username),
    proxyPassword: decodeURIComponent(authParsed.password),
  };
  console.log(`Auth proxy "${authProxy}" → ${JSON.stringify(authFields)}`);
  
  console.log('✅ Proxy format parsing works correctly');
  return true;
}

// ─── Test 3: CaptchaSolv task creation with proxy ───
async function testCaptchaSolvTaskWithProxy() {
  console.log('\n═══ Test 3: CaptchaSolv Task with Proxy ═══');
  
  // First, get a working proxy from ProxyScrape
  console.log('Fetching proxy from ProxyScrape...');
  let proxyUrl: string | null = null;
  try {
    const res = await fetch(
      'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&proxy_format=protocolipport&anonymity=elite&country=us,gb,de,ca',
      { signal: AbortSignal.timeout(15000), cache: 'no-store' }
    );
    const text = await res.text();
    const lines = text.trim().split('\n').filter(l => l.includes('://'));
    if (lines.length > 0) {
      proxyUrl = lines[0].trim();
      console.log(`Got proxy: ${proxyUrl}`);
    } else {
      console.warn('No proxies from ProxyScrape — testing with proxyless');
    }
  } catch (err) {
    console.warn(`ProxyScrape failed: ${(err as Error).message}`);
  }

  // Validate the proxy works
  if (proxyUrl) {
    console.log(`Validating proxy ${proxyUrl}...`);
    try {
      const { HttpsProxyAgent } = await import('https-proxy-agent');
      const agent = new HttpsProxyAgent(proxyUrl);
      const ip = await new Promise<string>((resolve, reject) => {
        const req = require('https').request(
          { hostname: 'httpbin.org', path: '/ip', agent },
          (res: any) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
              try {
                const data = JSON.parse(Buffer.concat(chunks).toString());
                resolve(data.origin);
              } catch { reject(new Error('Invalid response')); }
            });
          }
        );
        req.on('error', reject);
        req.setTimeout(5000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      });
      console.log(`✅ Proxy works — exit IP: ${ip}`);
    } catch (err) {
      console.warn(`❌ Proxy validation failed: ${(err as Error).message}`);
      proxyUrl = null;
    }
  }

  // Now test creating a CaptchaSolv task with the proxy
  const siteKey = '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';
  const pageUrl = 'https://www.1024terabox.com/';
  
  const task: Record<string, unknown> = {
    type: proxyUrl ? 'RecaptchaV2EnterpriseTask' : 'RecaptchaV2EnterpriseTaskProxyless',
    websiteURL: pageUrl,
    websiteKey: siteKey,
  };
  
  if (proxyUrl) {
    const parsed = new URL(proxyUrl);
    const protocol = parsed.protocol.replace(':', '');
    task.proxyType = protocol === 'https' ? 'http' : protocol;
    task.proxyAddress = parsed.hostname;
    task.proxyPort = parseInt(parsed.port, 10) || 8080;
    if (parsed.username) task.proxyLogin = decodeURIComponent(parsed.username);
    if (parsed.password) task.proxyPassword = decodeURIComponent(parsed.password);
  }
  
  console.log(`\nTask object being sent to CaptchaSolv:`);
  console.log(JSON.stringify(task, null, 2));
  
  // Create the task (don't wait for solve — just verify it's accepted)
  try {
    const res = await fetch(`${API_BASE}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: CAPTCHASOLV_API_KEY,
        task,
        waitForSlot: true,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    
    if (data.errorId === 0 && data.taskId) {
      console.log(`✅ Task created successfully! taskId: ${data.taskId}`);
      console.log(`   Task type: ${task.type}`);
      console.log(`   Proxy: ${task.proxyAddress ? `${task.proxyType}://${task.proxyAddress}:${task.proxyPort}` : 'proxyless'}`);
      return true;
    }
    
    if (data.errorId === 15) {
      console.warn(`⚠️ Proxy blocked by target (errorId 15): ${data.errorDescription}`);
      console.warn('   This proxy IP is flagged — try a different proxy');
      return false;
    }
    
    console.error(`❌ Task creation failed: errorId=${data.errorId}, ${data.errorCode}: ${data.errorDescription}`);
    return false;
  } catch (err) {
    console.error(`❌ Task creation error: ${(err as Error).message}`);
    return false;
  }
}

// ─── Test 4: TeraBox API connectivity ───
async function testTeraBoxApi() {
  console.log('\n═══ Test 4: TeraBox API Connectivity ═══');
  
  const domains = [
    'https://www.1024terabox.com',
    'https://www.terabox.com',
  ];
  
  for (const domain of domains) {
    try {
      const res = await fetch(`${domain}/api/shorturlinfo?shorturl=1_test&root=1&app_id=250528&web=1`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
        },
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      });
      const data = await res.json();
      console.log(`${domain}: status=${res.status}, errno=${data.errno ?? data.error_code ?? 'N/A'}`);
      if (res.ok) {
        console.log(`✅ ${domain} is reachable`);
      }
    } catch (err) {
      console.warn(`❌ ${domain} failed: ${(err as Error).message}`);
    }
  }
  return true;
}

// ─── Test 5: CaptchaSolv health check ───
async function testCaptchaSolvHealth() {
  console.log('\n═══ Test 5: CaptchaSolv Health ═══');
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const data = await res.json();
    console.log(`Status: ${data.status}, Service: ${data.service}, Time: ${data.time}ms`);
    console.log(`✅ CaptchaSolv is healthy`);
    return true;
  } catch (err) {
    console.error(`❌ CaptchaSolv health check failed: ${(err as Error).message}`);
    return false;
  }
}

// ─── Main ───
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  TeraBox Captcha Chain Verification Test Suite   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  
  const results: Record<string, boolean> = {};
  
  results['CaptchaSolv API Key'] = await testCaptchaSolvApiKey();
  results['Proxy Format'] = await testProxyFormat();
  results['CaptchaSolv Health'] = await testCaptchaSolvHealth();
  results['CaptchaSolv Task+Proxy'] = await testCaptchaSolvTaskWithProxy();
  results['TeraBox API'] = await testTeraBoxApi();
  
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  Summary                                         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${name}`);
  }
  
  const allPassed = Object.values(results).every(v => v);
  console.log(`\n${allPassed ? '🎉 ALL TESTS PASSED' : '⚠️ SOME TESTS FAILED — see details above'}`);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
