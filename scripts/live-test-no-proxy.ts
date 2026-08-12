/**
 * LIVE TEST: Signup without proxy
 * Tests the full captcha → sendcode → OTP flow with the new API key
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  console.log('=== LIVE TEST: No Proxy ===');
  console.log(`CAPTCHASOLV_API_KEY: ${process.env.CAPTCHASOLV_API_KEY?.substring(0, 8)}...`);
  console.log();

  // 1. Import modules
  const { TeraBoxSession, encryptEmail, getRecaptchaSiteKeyDynamic } = await import('../src/lib/terabox/api');
  const { isCaptchaConfigured, solveRecaptcha, getBalance } = await import('../src/lib/captcha');
  const { createTempEmail } = await import('../src/lib/catchmail');

  // 2. Check captcha config
  console.log(`Captcha configured: ${isCaptchaConfigured()}`);
  const bal = await getBalance();
  console.log(`Balance: ${bal.error ? `error: ${bal.error}` : `$${bal.balance}`} (provider: ${bal.provider || 'none'})`);
  console.log();

  // 3. Create TeraBox session (no proxy)
  const tb = new TeraBoxSession('livetest');
  tb.setProxyUrl(null);
  console.log('TeraBox session created (no proxy)');

  // 4. Visit share link first (sets cookies)
  console.log('\n--- Visiting share link ---');
  const visitResult = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
  console.log(`Visit result: ${visitResult.success ? 'OK' : visitResult.error}`);

  // 5. Get RSA public key
  console.log('\n--- Getting RSA public key ---');
  const pk = await tb.getPubKey();
  if (!pk?.pubkey) {
    console.error('FAILED: No pubkey obtained');
    process.exit(1);
  }
  console.log(`Pubkey obtained (len=${pk.pubkey.length})`);

  // 6. Create temp email
  console.log('\n--- Creating temp email ---');
  const email = await createTempEmail();
  console.log(`Email: ${email.address}`);

  // 7. Encrypt email
  let enc: string, isEnc = false;
  try {
    enc = await encryptEmail(email.address, pk.pubkey);
    isEnc = true;
    console.log(`Email encrypted (len=${enc.length})`);
  } catch (e) {
    enc = email.address;
    console.log(`Encryption failed: ${(e as Error).message} — using plaintext`);
  }

  // 8. Send verification code (first attempt — likely needs captcha)
  console.log('\n--- Sending verification code (attempt 1, no captcha) ---');
  let res = await tb.sendVerificationCode(enc, undefined, isEnc);
  console.log(`Result: success=${res.success} errno=${res.errno} error=${res.error || 'none'}`);
  if (res.rawResponse) console.log(`RAW: ${JSON.stringify(res.rawResponse).substring(0, 500)}`);

  // 9. If captcha needed — solve it!
  if (res.needsCaptcha || !res.success) {
    console.log('\n--- Captcha required — solving... ---');
    
    // Get sitekey
    const siteKey = await getRecaptchaSiteKeyDynamic(undefined);
    console.log(`Sitekey: ${siteKey?.substring(0, 20)}... (len=${siteKey?.length || 0})`);
    
    if (!siteKey) {
      console.error('FAILED: No sitekey obtained');
      process.exit(1);
    }

    // Try solving captcha (proxyless — no proxy)
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`\n--- Captcha solve attempt ${attempt}/3 (proxyless) ---`);
      const t0 = Date.now();
      const result = await solveRecaptcha(siteKey, 'https://www.1024terabox.com/', undefined);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      
      if (!result.token) {
        console.log(`FAILED after ${elapsed}s`);
        console.log(`Errors: ${JSON.stringify(result.errors, null, 2)}`);
        if (attempt >= 3) {
          console.error('\n★★★ ALL CAPTCHA ATTEMPTS FAILED ★★★');
          process.exit(1);
        }
        continue;
      }
      
      console.log(`Solved in ${elapsed}s! Token length: ${result.token.length}`);
      if (result.errors.length) console.log(`Non-fatal errors: ${JSON.stringify(result.errors)}`);

      // Retry sendcode with captcha token
      console.log(`\n--- Retrying sendcode with captcha token ---`);
      await new Promise(r => setTimeout(r, 1000)); // Brief delay
      res = await tb.sendVerificationCode(enc, result.token, isEnc);
      console.log(`Result: success=${res.success} errno=${res.errno} error=${res.error || 'none'}`);
      if (res.rawResponse) console.log(`RAW: ${JSON.stringify(res.rawResponse).substring(0, 500)}`);

      if (res.success) {
        console.log('\n★★★ CAPTCHA ACCEPTED — OTP SENT! ★★★');
        console.log(`API Token: ${res.token?.substring(0, 15)}...`);
        console.log(`Retry period: ${res.retryPeriod}s`);
        break;
      }

      // Token rejected?
      const { isCaptchaErrno } = await import('../src/lib/terabox/api');
      if (isCaptchaErrno(res.errno)) {
        console.log(`Token rejected (errno ${res.errno}) — getting fresh token...`);
        continue;
      }
      
      // Non-captcha error
      console.log(`Non-captcha error — stopping`);
      break;
    }
  }

  if (!res.success) {
    console.error(`\n★★★ SENDCODE FAILED: ${res.error} ★★★`);
    process.exit(1);
  }

  // 10. Wait for OTP email
  console.log('\n--- Waiting for OTP email (polling CatchMail.io)... ---');
  const { listMessages, getMessage, extractVerificationCode } = await import('../src/lib/catchmail');
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000)); // wait 5s between polls
    const inbox = await listMessages(email.address);
    if (inbox && inbox.messages && inbox.messages.length > 0) {
      console.log(`Got ${inbox.messages.length} message(s)!`);
      const latest = inbox.messages[0];
      console.log(`From: ${latest.from}, Subject: ${latest.subject}`);
      // Get full message to extract OTP
      const detail = await getMessage(email.address, latest.id);
      const otp = extractVerificationCode(detail?.body?.text || detail?.subject || '');
      if (otp) {
        console.log(`\n★★★ OTP FOUND: ${otp} ★★★`);
        break;
      }
      console.log(`No OTP found in message, preview: ${detail?.body?.text?.substring(0, 300)}`);
      break;
    }
    console.log(`Poll ${i+1}/12: no messages yet...`);
  }
  
  console.log('\n=== TEST RESULT: sendcode SUCCESS — OTP sent to email ===');
  console.log('The captcha solving + sendcode flow is WORKING!');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
