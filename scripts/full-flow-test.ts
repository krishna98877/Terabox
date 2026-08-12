/**
 * Full flow test: solve captcha + sendcode
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const { TeraBoxSession, encryptEmail } = await import('../src/lib/terabox/api');
  const { createTempEmail } = await import('../src/lib/catchmail');

  const tb = new TeraBoxSession('fullflow');
  tb.setProxyUrl(null);

  // Visit share link
  console.log('--- Visit share link ---');
  await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
  console.log(`Cookies: ${tb.getCookieCount()}`);

  // Get pubkey
  const pk = await tb.getPubKey();
  console.log(`Pubkey: ${pk?.pubkey ? 'OK' : 'NONE'}`);

  // Create email
  const email = await createTempEmail();
  console.log(`Email: ${email.address}`);

  // Encrypt (or plain)
  let enc: string, isEnc = false;
  try { enc = await encryptEmail(email.address, pk!.pubkey); isEnc = true; } catch { enc = email.address; }

  // Sendcode (expect captcha needed)
  console.log('\n--- Sendcode (no captcha) ---');
  let res = await tb.sendVerificationCode(enc, undefined, isEnc);
  console.log(`errno=${res.errno} needsCaptcha=${res.needsCaptcha}`);

  if (!res.needsCaptcha) {
    console.log('Unexpected: no captcha needed or error:', res.error);
    return;
  }

  // Solve captcha using CaptchaSolv directly
  console.log('\n--- Solving captcha ---');
  const apiKey = process.env.CAPTCHASOLV_API_KEY || '';
  
  // Try MULTIPLE sitekeys and task types
  const sitekeys = [
    '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH',  // hardcoded fallback
    '6LdC2q8ZAAAAAOtFpmShI2nOjO8lFfZ5dEzYmGJj',  // common TeraBox key
  ];
  
  const taskTypes = [
    'RecaptchaV2TaskProxyless',              // Standard v2 (errno 400090 = "verify_v2")
    'RecaptchaV2EnterpriseTaskProxyless',    // Enterprise v2
  ];

  for (const siteKey of sitekeys) {
    for (const taskType of taskTypes) {
      console.log(`\n  Trying: sitekey=${siteKey.substring(0, 15)}... type=${taskType}`);
      
      try {
        // Create task
        const createRes = await fetch('https://v1.captchasolv.com/createTask', {
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
          console.log(`  Create error: ${createData.errorDescription || createData.errorCode}`);
          continue;
        }
        
        const taskId = createData.taskId;
        console.log(`  Task ID: ${taskId}`);

        // Poll for result (max 90s)
        let token: string | null = null;
        for (let i = 0; i < 18; i++) {
          await new Promise(r => setTimeout(r, 5000));
          const pollRes = await fetch('https://v1.captchasolv.com/getTaskResult', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientKey: apiKey, taskId }),
            signal: AbortSignal.timeout(15000),
          });
          const pollData = await pollRes.json();
          
          if (pollData.status === 'ready') {
            token = pollData.solution?.token || pollData.solution?.gRecaptchaResponse;
            console.log(`  ★ Solved in ~${(i + 1) * 5}s! Token len=${token?.length || 0}`);
            break;
          }
          
          if (pollData.errorId && pollData.errorId !== 0) {
            console.log(`  Poll error: ${pollData.errorDescription || pollData.errorCode}`);
            break;
          }
        }

        if (!token) {
          console.log(`  Timed out or failed`);
          continue;
        }

        // Try sendcode with token
        console.log(`  Testing sendcode with token...`);
        await new Promise(r => setTimeout(r, 500));
        const sendRes = await tb.sendVerificationCode(enc, token, isEnc);
        console.log(`  Result: success=${sendRes.success} errno=${sendRes.errno} error=${sendRes.error || 'none'}`);
        if (sendRes.rawResponse) console.log(`  RAW: ${JSON.stringify(sendRes.rawResponse).substring(0, 300)}`);

        if (sendRes.success) {
          console.log('\n★★★ FULL FLOW SUCCESS: OTP SENT! ★★★');
          console.log(`Token: ${sendRes.token?.substring(0, 15)}...`);
          return;
        }

        // If captcha errno, token was rejected — try next
        if (sendRes.errno === 400090 || sendRes.errno === 460030 || sendRes.errno === 106) {
          console.log(`  Token rejected (errno ${sendRes.errno}) — trying next combo`);
          continue;
        }

        // Non-captcha error
        console.log(`  Non-captcha error — stopping`);
        return;
        
      } catch (e) {
        console.log(`  Error: ${(e as Error).message}`);
      }
    }
  }

  console.log('\n✗ ALL COMBINATIONS FAILED');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
