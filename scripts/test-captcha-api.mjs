/**
 * Direct CaptchaSolv API test — validates the new API key works.
 * Tests: balance check, reCAPTCHA v2 Enterprise solving, token retrieval
 */
const API_BASE = 'https://v1.captchasolv.com';
const API_KEY = '40fd4b6c-efd9-4a07-99df-53b0cb3888db';

async function apiPost(endpoint, body, timeoutMs = 30000) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res.json();
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  CaptchaSolv API Test — New Key Validation');
  console.log('═══════════════════════════════════════════════════');
  console.log(`API Key: ${API_KEY.substring(0, 8)}...${API_KEY.substring(API_KEY.length - 4)}`);
  console.log(`Base URL: ${API_BASE}`);
  console.log('');

  // 1. Health check
  console.log('─── Step 1: Health Check ───');
  try {
    const healthRes = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(5000) });
    const health = await healthRes.json();
    console.log(`Health: ${JSON.stringify(health)}`);
  } catch (err) {
    console.error(`Health check failed: ${err.message}`);
  }

  // 2. Balance check
  console.log('');
  console.log('─── Step 2: Balance Check ───');
  try {
    const balanceRes = await apiPost('/getBalance', { clientKey: API_KEY }, 10000);
    console.log(`Balance response: ${JSON.stringify(balanceRes)}`);
    if (balanceRes.errorId === 0) {
      console.log(`Balance: $${balanceRes.balance}`);
    } else {
      console.log(`Balance check returned error (OK for free-tier keys): ${balanceRes.errorCode} - ${balanceRes.errorDescription}`);
      console.log(`  Free-tier keys have 100 solves/day quota, not balance.`);
    }
  } catch (err) {
    console.error(`Balance check failed: ${err.message}`);
    console.log(`  This is OK for free-tier keys — continuing with captcha solve test.`);
  }

  // 3. Get dynamic sitekey from TeraBox
  console.log('');
  console.log('─── Step 3: Get TeraBox reCAPTCHA SiteKey ───');
  let siteKey = '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH'; // fallback
  try {
    const teraboxRes = await fetch('https://www.1024terabox.com/', {
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await teraboxRes.text();
    console.log(`TeraBox HTML length: ${html.length}`);
    // Extract sitekey
    const patterns = [
      /sitekey['":\s]+['"]([A-Za-z0-9_-]{40})['"]/,
      /data-sitekey=['"]([A-Za-z0-9_-]{40})['"]/,
      /recaptcha.*?['"]([A-Za-z0-9_-]{40})['"]/i,
    ];
    let found = false;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) {
        siteKey = match[1];
        console.log(`Dynamic sitekey extracted: ${siteKey}`);
        found = true;
        break;
      }
    }
    if (!found) {
      console.log(`Could not extract sitekey from HTML — using fallback`);
    }
    console.log(`SiteKey: ${siteKey}`);
  } catch (err) {
    console.error(`TeraBox fetch failed: ${err.message}`);
    console.log(`Using fallback sitekey: ${siteKey}`);
  }

  // 4. Try solving reCAPTCHA v2 Enterprise (PROXYLESS — since user said "without proxy first")
  console.log('');
  console.log('─── Step 4: Solve reCAPTCHA v2 Enterprise (Proxyless) ───');
  console.log(`   SiteKey: ${siteKey}`);
  console.log(`   PageURL: https://www.1024terabox.com/`);
  console.log(`   Type: RecaptchaV2EnterpriseTaskProxyless`);
  
  const solveStart = Date.now();
  try {
    // Try with sync /solve endpoint first
    const syncRes = await apiPost('/solve', {
      clientKey: API_KEY,
      task: {
        type: 'RecaptchaV2EnterpriseTaskProxyless',
        websiteURL: 'https://www.1024terabox.com/',
        websiteKey: siteKey,
      },
    }, 130000);
    
    const solutionToken = syncRes.solution?.token || syncRes.solution?.gRecaptchaResponse;
    if (syncRes.errorId === 0 && solutionToken) {
      const elapsed = ((Date.now() - solveStart) / 1000).toFixed(1);
      console.log(`CAPTCHA V2 ENTERPRISE SOLVED in ${elapsed}s!`);
      console.log(`   Token length: ${solutionToken.length}`);
      console.log(`   Token prefix: ${solutionToken.substring(0, 30)}...`);
      console.log(`   Cost: ${syncRes.cost || 'N/A'}`);
    } else {
      console.error(`Enterprise v2 failed: ${syncRes.errorCode} - ${syncRes.errorDescription}`);
      console.log(`Full response: ${JSON.stringify(syncRes).substring(0, 500)}`);
    }
  } catch (err) {
    console.error(`Enterprise v2 error: ${err.message}`);
  }

  // 5. Also try standard RecaptchaV2 (non-Enterprise)
  console.log('');
  console.log('─── Step 5: Solve reCAPTCHA v2 Standard (Proxyless) ───');
  const solve2Start = Date.now();
  try {
    const syncRes = await apiPost('/solve', {
      clientKey: API_KEY,
      task: {
        type: 'RecaptchaV2TaskProxyless',
        websiteURL: 'https://www.1024terabox.com/',
        websiteKey: siteKey,
      },
    }, 130000);
    
    const solutionToken = syncRes.solution?.token || syncRes.solution?.gRecaptchaResponse;
    if (syncRes.errorId === 0 && solutionToken) {
      const elapsed = ((Date.now() - solve2Start) / 1000).toFixed(1);
      console.log(`STANDARD V2 CAPTCHA SOLVED in ${elapsed}s!`);
      console.log(`   Token length: ${solutionToken.length}`);
      console.log(`   Token prefix: ${solutionToken.substring(0, 30)}...`);
    } else {
      console.error(`Standard v2 failed: ${syncRes.errorCode} - ${syncRes.errorDescription}`);
      console.log(`Full response: ${JSON.stringify(syncRes).substring(0, 500)}`);
    }
  } catch (err) {
    console.error(`Standard v2 error: ${err.message}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Test Complete');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
