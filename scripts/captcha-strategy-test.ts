/**
 * Test multiple captcha solve strategies to find what works
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

const API_BASE = 'https://v1.captchasolv.com';
const apiKey = process.env.CAPTCHASOLV_API_KEY || '';

// Get real sitekey from TeraBox
async function getSitekey(): Promise<string> {
  const res = await fetch('https://www.1024terabox.com/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const patterns = [
    /sitekey['":\s]+['"]([a-zA-Z0-9_-]{30,50})['"]/,
    /data-sitekey=['"]([a-zA-Z0-9_-]{30,50})['"]/,
    /render['":\s]+['"]([a-zA-Z0-9_-]{30,50})['"]/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return '6LdC2q8ZAAAAAOtFpmShI2nOjO8lFfZ5dEzYmGJj'; // fallback
}

async function trySync(taskType: string, siteKey: string): Promise<void> {
  console.log(`\n=== SYNC: ${taskType} ===`);
  try {
    const res = await fetch(`${API_BASE}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: { type: taskType, websiteURL: 'https://www.1024terabox.com/', websiteKey: siteKey },
      }),
      signal: AbortSignal.timeout(90000),
    });
    const data = await res.json();
    console.log(`Response: ${JSON.stringify(data).substring(0, 500)}`);
    if (data.solution?.token || data.solution?.gRecaptchaResponse) {
      const token = data.solution.token || data.solution.gRecaptchaResponse;
      console.log(`★★★ SOLVED! Token length: ${token.length} ★★★`);
    }
  } catch (e) {
    console.log(`Error: ${(e as Error).message}`);
  }
}

async function tryAsync(taskType: string, siteKey: string, label: string): Promise<string | null> {
  console.log(`\n=== ASYNC: ${taskType} (${label}) ===`);
  try {
    // Create task
    const createRes = await fetch(`${API_BASE}/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: { type: taskType, websiteURL: 'https://www.1024terabox.com/', websiteKey: siteKey },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const createData = await createRes.json();
    if (createData.errorId !== 0) {
      console.log(`Create error: ${createData.errorDescription || createData.errorCode}`);
      return null;
    }
    const taskId = createData.taskId;
    console.log(`Task created: ${taskId}`);

    // Poll (max 60s)
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const pollRes = await fetch(`${API_BASE}/getTaskResult`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
        signal: AbortSignal.timeout(15000),
      });
      const pollData = await pollRes.json();
      
      if (pollData.status === 'ready') {
        const token = pollData.solution?.token || pollData.solution?.gRecaptchaResponse;
        console.log(`★★★ SOLVED in ~${(i + 1) * 5}s! Token length: ${token?.length || 0} ★★★`);
        return token;
      }
      
      if (pollData.errorId && pollData.errorId !== 0) {
        console.log(`Error: ${pollData.errorDescription || pollData.errorCode}`);
        return null;
      }
      console.log(`  ${i + 1}: processing...`);
    }
    console.log('Timed out after 60s');
    return null;
  } catch (e) {
    console.log(`Error: ${(e as Error).message}`);
    return null;
  }
}

async function main() {
  console.log('=== CAPTCHA STRATEGY TEST ===');
  console.log(`API Key: ${apiKey.substring(0, 8)}...`);
  
  const siteKey = await getSitekey();
  console.log(`Sitekey: ${siteKey.substring(0, 30)}... (len=${siteKey.length})`);

  // Strategy 1: v2 Standard Proxyless (simplest, fastest)
  const token1 = await tryAsync('RecaptchaV2TaskProxyless', siteKey, 'Standard v2 Proxyless');
  
  // Strategy 2: v2 Enterprise Proxyless (TeraBox uses Enterprise)
  if (!token1) {
    const token2 = await tryAsync('RecaptchaV2EnterpriseTaskProxyless', siteKey, 'Enterprise v2 Proxyless');
  }

  // Strategy 3: Try sync endpoint
  if (!token1) {
    await trySync('RecaptchaV2TaskProxyless', siteKey);
  }

  console.log('\n=== DONE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
