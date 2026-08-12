/**
 * Full verified flow test: captcha solve → sendcode → check result
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const { TeraBoxSession, encryptEmail } = await import('../src/lib/terabox/api');
  const { createTempEmail } = await import('../src/lib/catchmail');

  const apiKey = process.env.CAPTCHASOLV_API_KEY || '';
  const siteKey = '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';

  // Step 1: Setup TeraBox session
  const tb = new TeraBoxSession('fulltest');
  tb.setProxyUrl(null);

  console.log('--- Setup ---');
  const visit = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
  console.log(`Visit: ${visit.success ? 'OK' : visit.error}`);

  const pk = await tb.getPubKey();
  console.log(`Pubkey: ${pk?.pubkey ? 'OK' : 'NONE'}`);

  const email = await createTempEmail();
  console.log(`Email: ${email.address}`);

  let enc: string, isEnc = false;
  try { enc = await encryptEmail(email.address, pk!.pubkey); isEnc = true; } catch { enc = email.address; }

  // Step 2: Sendcode (expect captcha needed)
  console.log('\n--- Sendcode (no captcha) ---');
  const res1 = await tb.sendVerificationCode(enc, undefined, isEnc);
  console.log(`errno=${res1.errno} needsCaptcha=${res1.needsCaptcha}`);

  // Step 3: Solve captcha
  console.log('\n--- Solving Captcha (async, up to 120s) ---');
  const createRes = await fetch('https://v1.captchasolv.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: { type: 'RecaptchaV2TaskProxyless', websiteURL: 'https://www.1024terabox.com/', websiteKey: siteKey },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const createData = await createRes.json();
  console.log(`Task created: ${createData.taskId}`);

  if (createData.errorId !== 0) {
    console.error(`Error: ${createData.errorDescription || createData.errorCode}`);
    return;
  }

  const taskId = createData.taskId;
  const t0 = Date.now();
  let token: string | null = null;

  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch('https://v1.captchasolv.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
      signal: AbortSignal.timeout(15000),
    });
    const pollData = await pollRes.json();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);

    if (pollData.status === 'ready') {
      token = pollData.solution?.token || pollData.solution?.gRecaptchaResponse;
      console.log(`★ SOLVED in ${elapsed}s! Token length: ${token?.length || 0}`);
      break;
    }

    if (pollData.errorId && pollData.errorId !== 0) {
      console.error(`Error at ${elapsed}s: ${pollData.errorDescription || pollData.errorCode}`);
      return;
    }

    process.stdout.write(`${elapsed}s `);
  }

  if (!token) {
    console.error('\nCaptcha solve timed out');
    return;
  }

  // Step 4: Sendcode with captcha token
  console.log('\n\n--- Sendcode with captcha token ---');
  await new Promise(r => setTimeout(r, 500));
  const res2 = await tb.sendVerificationCode(enc, token, isEnc);
  console.log(`Result: success=${res2.success} errno=${res2.errno} error=${res2.error || 'none'}`);
  if (res2.rawResponse) console.log(`RAW: ${JSON.stringify(res2.rawResponse).substring(0, 500)}`);

  if (res2.success) {
    console.log('\n★★★ SUCCESS: OTP SENT TO EMAIL! ★★★');
    console.log(`API Token: ${res2.token?.substring(0, 15)}...`);
    console.log(`Retry period: ${res2.retryPeriod}s`);
    console.log('\nThe full captcha → sendcode flow is WORKING!');
  } else {
    console.log('\n✗ Token rejected — trying one more time with fresh token...');
    
    // Retry with fresh token
    const createRes2 = await fetch('https://v1.captchasolv.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: { type: 'RecaptchaV2TaskProxyless', websiteURL: 'https://www.1024terabox.com/', websiteKey: siteKey },
      }),
      signal: AbortSignal.timeout(30000),
    });
    const createData2 = await createRes2.json();
    if (createData2.taskId) {
      const t1 = Date.now();
      let token2: string | null = null;
      for (let i = 0; i < 24; i++) {
        await new Promise(r => setTimeout(r, 5000));
        const pollRes = await fetch('https://v1.captchasolv.com/getTaskResult', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientKey: apiKey, taskId: createData2.taskId }),
          signal: AbortSignal.timeout(15000),
        });
        const pollData = await pollRes.json();
        if (pollData.status === 'ready') {
          token2 = pollData.solution?.token || pollData.solution?.gRecaptchaResponse;
          console.log(`Fresh token obtained in ${((Date.now() - t1) / 1000).toFixed(0)}s, len=${token2?.length}`);
          break;
        }
        if (pollData.errorId && pollData.errorId !== 0) break;
        process.stdout.write('.');
      }
      if (token2) {
        const res3 = await tb.sendVerificationCode(enc, token2, isEnc);
        console.log(`\nRetry result: success=${res3.success} errno=${res3.errno}`);
        if (res3.success) console.log('★★★ SUCCESS on retry! ★★★');
        else console.log('✗ Still rejected');
      }
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
