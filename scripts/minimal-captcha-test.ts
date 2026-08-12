/**
 * Minimal test: Just check CaptchaSolv API connectivity + sitekey
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const apiKey = process.env.CAPTCHASOLV_API_KEY || '';
  console.log(`API Key: ${apiKey.substring(0, 8)}...`);

  // 1. Check balance
  console.log('\n--- Balance Check ---');
  try {
    const res = await fetch('https://v1.captchasolv.com/getBalance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${JSON.stringify(data)}`);
  } catch (e) {
    console.error(`Balance check FAILED: ${(e as Error).message}`);
  }

  // 2. Get sitekey from TeraBox
  console.log('\n--- Sitekey Extraction ---');
  try {
    const res = await fetch('https://www.1024terabox.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    const html = await res.text();
    console.log(`HTML length: ${html.length}`);
    
    // Extract sitekey
    const patterns = [
      /sitekey['":\s]+['"]([a-zA-Z0-9_-]{40})['"]/,
      /data-sitekey=['"]([a-zA-Z0-9_-]{40})['"]/,
      /render['":\s]+['"]([a-zA-Z0-9_-]{40})['"]/,
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m) { console.log(`Sitekey found: ${m[1].substring(0, 30)}...`); break; }
    }
  } catch (e) {
    console.error(`Sitekey extraction FAILED: ${(e as Error).message}`);
  }

  // 3. Quick captcha solve attempt (v2 Enterprise, proxyless, single attempt)
  console.log('\n--- Captcha Solve (single, 60s timeout) ---');
  try {
    const siteKey = '6LdC2q8ZAAAAAOtFpmShI2nOjO8lFfZ5dEzYmGJj'; // fallback
    // Try to get real sitekey first
    const htmlRes = await fetch('https://www.1024terabox.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10000),
    });
    const html = await htmlRes.text();
    const skMatch = html.match(/sitekey['":\s]+['"]([a-zA-Z0-9_-]{40})['"]/);
    const realSiteKey = skMatch?.[1] || siteKey;
    console.log(`Using sitekey: ${realSiteKey.substring(0, 30)}...`);

    // Create task
    const createRes = await fetch('https://v1.captchasolv.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'RecaptchaV2EnterpriseTaskProxyless',
          websiteURL: 'https://www.1024terabox.com/',
          websiteKey: realSiteKey,
        },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const createData = await createRes.json();
    console.log(`Create task: ${JSON.stringify(createData)}`);

    if (createData.errorId !== 0) {
      console.error(`Task creation FAILED: ${createData.errorDescription || createData.errorCode}`);
      return;
    }

    const taskId = createData.taskId;
    console.log(`Task ID: ${taskId} — polling for result...`);

    // Poll for result
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 5000)); // 5s intervals
      const pollRes = await fetch('https://v1.captchasolv.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
        signal: AbortSignal.timeout(15000),
      });
      const pollData = await pollRes.json();
      console.log(`  Poll ${i+1}: status=${pollData.status || 'unknown'}`);
      
      if (pollData.status === 'ready') {
        const token = pollData.solution?.token || pollData.solution?.gRecaptchaResponse;
        console.log(`\n★★★ CAPTCHA SOLVED! ★★★`);
        console.log(`Token length: ${token?.length || 0}`);
        console.log(`Token preview: ${token?.substring(0, 40)}...`);
        
        // Test sendcode
        console.log('\n--- Testing sendcode with token ---');
        const { TeraBoxSession, encryptEmail } = await import('../src/lib/terabox/api');
        const { createTempEmail } = await import('../src/lib/catchmail');
        
        const tb = new TeraBoxSession('mintest');
        tb.setProxyUrl(null);
        await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
        const pk = await tb.getPubKey();
        const email = await createTempEmail();
        console.log(`Email: ${email.address}`);
        
        let enc: string, isEnc = false;
        try { enc = await encryptEmail(email.address, pk!.pubkey); isEnc = true; } catch { enc = email.address; }
        
        const sendRes = await tb.sendVerificationCode(enc, token, isEnc);
        console.log(`Sendcode: success=${sendRes.success} errno=${sendRes.errno} error=${sendRes.error || 'none'}`);
        if (sendRes.rawResponse) console.log(`RAW: ${JSON.stringify(sendRes.rawResponse).substring(0, 500)}`);
        
        if (sendRes.success) console.log('\n★★★ OTP SENT — FULL FLOW WORKS! ★★★');
        else console.log('\n✗ Token rejected — IP mismatch (proxyless solve, TeraBox needs same IP)');
        return;
      }
      
      if (pollData.errorId && pollData.errorId !== 0) {
        console.error(`Poll error: ${pollData.errorDescription || pollData.errorCode}`);
        return;
      }
    }
    console.log('Polling timed out after 75s');
  } catch (e) {
    console.error(`Captcha solve FAILED: ${(e as Error).message}`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
