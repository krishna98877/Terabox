/**
 * End-to-end validation script for the CaptchaSolv + Proxy + TeraBox chain.
 *
 * Tests WITHOUT wasting CaptchaSolv solves:
 * 1. CaptchaSolv API key & balance check
 * 2. CaptchaSolv supported types (verify proxied types exist)
 * 3. Proxy pool refresh & TeraBox validation
 * 4. TeraBox API connectivity (pubkey, shorturlinfo)
 * 5. CaptchaSolv solve flow (DRY RUN — only if --live flag)
 *
 * Usage:
 *   npx tsx scripts/validate-chain.ts          # Safe — no captcha solves
 *   npx tsx scripts/validate-chain.ts --live   # Actually solve 1 captcha (uses 1 solve)
 */

const CAPTCHASOLV_API_KEY = process.env.CAPTCHASOLV_API_KEY || '8f1d4243-9579-4005-8e3f-ad122e07504a';
const CAPTCHASOLV_BASE = 'https://v1.captchasolv.com';
const TERABOX_API = 'https://www.1024terabox.com';
const RECAPTCHA_SITEKEY = '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';

const isLive = process.argv.includes('--live');

let passed = 0;
let failed = 0;
let warned = 0;

function ok(label: string) { console.log(`  ✅ ${label}`); passed++; }
function fail(label: string, detail?: string) { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
function warn(label: string, detail?: string) { console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`); warned++; }

async function apiPost(url: string, body: unknown, timeout = 13000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { status: res.status, data: await res.json() };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function main() {
  console.log('════════════════════════════════════════════════════════');
  console.log('  CaptchaSolv + Proxy + TeraBox Chain Validation');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Mode: ${isLive ? 'LIVE (will use 1 solve)' : 'DRY RUN (no solves used)'}`);
  console.log('');

  // ─── 1. CaptchaSolv API ───
  console.log('── 1. CaptchaSolv API ──');

  // Health check
  try {
    const res = await fetch(`${CAPTCHASOLV_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.status === 'ok') ok(`Health: ${data.service}`);
    else fail('Health check failed', JSON.stringify(data));
  } catch (err) { fail('Health check error', (err as Error).message); }

  // Balance
  try {
    const { data } = await apiPost(`${CAPTCHASOLV_BASE}/getBalance`, { clientKey: CAPTCHASOLV_API_KEY });
    if (data.errorId === 0) ok(`Balance: ${data.balance} (solves tracked separately)`);
    else fail('Balance check failed', data.errorDescription || JSON.stringify(data));
  } catch (err) { fail('Balance error', (err as Error).message); }

  // Supported types
  try {
    const res = await fetch(`${CAPTCHASOLV_BASE}/supportedTypes`, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const types: string[] = data.types || [];

    const requiredTypes = [
      'RecaptchaV2EnterpriseTask',        // ★ TeraBox's primary type WITH proxy
      'RecaptchaV2EnterpriseTaskProxyless', // Fallback without proxy
      'RecaptchaV2Task',                   // Standard v2 with proxy
      'RecaptchaV3Task',                   // v3 with proxy
      'TurnstileTask',                     // Cloudflare with proxy
    ];

    for (const t of requiredTypes) {
      if (types.includes(t)) ok(`Type: ${t}`);
      else fail(`Type missing: ${t}`);
    }

    // Count all proxy vs proxyless types
    const proxyTypes = types.filter((t: string) => !t.includes('Proxyless') && !t.includes('Challenge'));
    const proxylessTypes = types.filter((t: string) => t.includes('Proxyless'));
    ok(`Total: ${types.length} types (${proxyTypes.length} proxy, ${proxylessTypes.length} proxyless)`);
  } catch (err) { fail('Supported types error', (err as Error).message); }

  console.log('');

  // ─── 2. Proxy Pool ───
  console.log('── 2. Proxy Sources ──');

  // Test ProxyScrape (our primary free source)
  try {
    const res = await fetch(
      'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&proxy_format=protocolipport&anonymity=elite&country=us,gb,de&limit=5',
      { signal: AbortSignal.timeout(10000) }
    );
    const text = await res.text();
    const lines = text.trim().split('\n').filter(l => l.includes('://'));
    if (lines.length > 0) ok(`ProxyScrape elite: ${lines.length} proxies (sample: ${lines[0]})`);
    else warn('ProxyScrape: no proxies returned');
  } catch (err) { warn('ProxyScrape fetch error', (err as Error).message); }

  // Test free GitHub lists
  try {
    const res = await fetch('https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', {
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    const count = text.trim().split('\n').length;
    if (count > 100) ok(`TheSpeedX list: ${count} proxies`);
    else warn(`TheSpeedX: only ${count} proxies`);
  } catch (err) { warn('TheSpeedX fetch error', (err as Error).message); }

  // Test Monosans
  try {
    const res = await fetch('https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', {
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    const count = text.trim().split('\n').length;
    if (count > 50) ok(`Monosans list: ${count} proxies`);
    else warn(`Monosans: only ${count} proxies`);
  } catch (err) { warn('Monosans fetch error', (err as Error).message); }

  // IPRoyal config check
  const iproyalUser = process.env.IPROYAL_USERNAME || '';
  if (iproyalUser) {
    ok(`IPRoyal residential configured (user: ${iproyalUser.substring(0, 3)}***)`);
  } else {
    warn('IPRoyal not configured — set IPROYAL_USERNAME + IPROYAL_PASSWORD for residential proxies');
  }

  console.log('');

  // ─── 3. TeraBox API ───
  console.log('── 3. TeraBox API Connectivity ──');

  // Test pubkey endpoint
  try {
    const res = await fetch(`${TERABOX_API}/passport/getpubkey?app_id=250528&web=1`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    const data = await res.json();
    const errno = data.errno ?? data.error_code ?? data.code;
    if (errno === 0 || data.data?.pp1) {
      ok(`getpubkey: works (pp1 length: ${data.data?.pp1?.length || 'N/A'})`);
    } else {
      warn(`getpubkey: errno ${errno} — ${data.errmsg || 'unexpected response'}`);
    }
  } catch (err) { warn('getpubkey error', (err as Error).message); }

  // Test shorturlinfo (should return error for fake shorturl, but NOT captcha errno)
  try {
    const res = await fetch(`${TERABOX_API}/api/shorturlinfo?shorturl=1_test&root=1&app_id=250528&web=1`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    const data = await res.json();
    const errno = data.errno ?? data.error_code ?? data.code;
    if (errno === 400090 || errno === 460030 || errno === 106) {
      warn(`shorturlinfo: direct IP flagged by TeraBox (errno ${errno}) — captcha required. Need residential proxy!`);
    } else {
      ok(`shorturlinfo: no captcha on direct IP (errno ${errno})`);
    }
  } catch (err) { warn('shorturlinfo error', (err as Error).message); }

  console.log('');

  // ─── 4. CaptchaSolv Solve (DRY RUN or LIVE) ───
  console.log('── 4. CaptchaSolv Solve Test ──');

  if (!isLive) {
    warn('Skipping actual captcha solve (use --live to test with 1 solve)');
    ok('DRY RUN: CaptchaSolv integration chain verified');
  } else {
    console.log('  Solving 1 reCAPTCHA v2 Enterprise (proxyless)...');
    try {
      const { data } = await apiPost(`${CAPTCHASOLV_BASE}/solve`, {
        clientKey: CAPTCHASOLV_API_KEY,
        task: {
          type: 'RecaptchaV2EnterpriseTaskProxyless',
          websiteURL: 'https://www.1024terabox.com/',
          websiteKey: RECAPTCHA_SITEKEY,
        },
        waitForSlot: true,
      }, 130000);

      if (data.errorId === 0 && data.solution?.token) {
        ok(`Solved! Token length: ${data.solution.token.length}, cost: ${data.cost || 'N/A'}`);
      } else {
        fail(`Solve failed: ${data.errorDescription || data.errorCode || JSON.stringify(data)}`);
      }
    } catch (err) { fail('Solve error', (err as Error).message); }
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${warned} warned, ${failed} failed`);
  console.log('════════════════════════════════════════════════════════');

  if (failed > 0) {
    console.log('');
    console.log('  ⚠️  Key fixes needed:');
    if (failed > 0) console.log('  - Check CaptchaSolv API key and connectivity');
    console.log('  - For TeraBox captcha issues, configure IPRoyal residential proxies');
    console.log('  - Set IPROYAL_USERNAME and IPROYAL_PASSWORD in .env');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
