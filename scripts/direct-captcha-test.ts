/**
 * Direct test: Just captcha solve + sendcode, no imports from engine
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  console.log('=== DIRECT CAPTCHA TEST ===');
  console.log(`API Key: ${process.env.CAPTCHASOLV_API_KEY?.substring(0, 8)}...`);

  // Step 1: Check captcha balance
  const { getBalance, isCaptchaConfigured, solveRecaptcha } = await import('../src/lib/captcha');
  console.log(`Configured: ${isCaptchaConfigured()}`);
  const bal = await getBalance();
  console.log(`Balance: ${bal.error ? `error: ${bal.error}` : `$${bal.balance}`}`);

  // Step 2: Get sitekey
  const { getRecaptchaSiteKeyDynamic } = await import('../src/lib/terabox/api');
  console.log('\nExtracting sitekey...');
  const siteKey = await getRecaptchaSiteKeyDynamic(undefined);
  console.log(`Sitekey: ${siteKey?.substring(0, 30)}... (len=${siteKey?.length || 0})`);

  if (!siteKey) {
    console.error('No sitekey!');
    process.exit(1);
  }

  // Step 3: Solve captcha (proxyless)
  console.log('\nSolving reCAPTCHA proxyless...');
  const t0 = Date.now();
  const result = await solveRecaptcha(siteKey, 'https://www.1024terabox.com/', undefined);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (result.token) {
    console.log(`✓ Solved in ${elapsed}s! Token length: ${result.token.length}`);
  } else {
    console.log(`✗ FAILED in ${elapsed}s`);
    console.log(`Errors: ${JSON.stringify(result.errors, null, 2)}`);
    process.exit(1);
  }

  // Step 4: Try sendcode
  const { TeraBoxSession, encryptEmail } = await import('../src/lib/terabox/api');
  const { createTempEmail } = await import('../src/lib/catchmail');

  const tb = new TeraBoxSession('directtest');
  tb.setProxyUrl(null);

  // Visit share link
  console.log('\nVisiting share link...');
  const visit = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
  console.log(`Visit: ${visit.success ? 'OK' : visit.error}`);

  // Get pubkey
  const pk = await tb.getPubKey();
  console.log(`Pubkey: ${pk?.pubkey ? 'OK (len=' + pk.pubkey.length + ')' : 'NONE'}`);

  // Create email
  const email = await createTempEmail();
  console.log(`Email: ${email.address}`);

  // Encrypt
  let enc: string, isEnc = false;
  try { enc = await encryptEmail(email.address, pk!.pubkey); isEnc = true; } catch { enc = email.address; }

  // Sendcode with token
  console.log('\nSending code with captcha token...');
  const res = await tb.sendVerificationCode(enc, result.token, isEnc);
  console.log(`Result: success=${res.success} errno=${res.errno} error=${res.error || 'none'}`);
  if (res.rawResponse) console.log(`RAW: ${JSON.stringify(res.rawResponse).substring(0, 500)}`);

  if (res.success) {
    console.log('\n★★★ SUCCESS: OTP SENT! ★★★');
  } else {
    console.log('\n✗ FAILED — token may have been rejected');
    // Try one more time with fresh token
    console.log('\n--- Retry with fresh token ---');
    const result2 = await solveRecaptcha(siteKey, 'https://www.1024terabox.com/', undefined);
    if (result2.token) {
      console.log(`Fresh token obtained (len=${result2.token.length})`);
      const res2 = await tb.sendVerificationCode(enc, result2.token, isEnc);
      console.log(`Result2: success=${res2.success} errno=${res2.errno} error=${res2.error || 'none'}`);
      if (res2.rawResponse) console.log(`RAW2: ${JSON.stringify(res2.rawResponse).substring(0, 500)}`);
    } else {
      console.log(`Solve failed: ${JSON.stringify(result2.errors)}`);
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
