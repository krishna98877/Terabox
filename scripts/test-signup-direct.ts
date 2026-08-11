/**
 * Direct test script for signup engine — NO PROXY
 * Runs outside Next.js, directly tests the TeraBox API + captcha flow
 */

// Load env
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

import { TeraBoxSession, isCaptchaErrno, getRecaptchaSiteKeyDynamic } from '../src/lib/terabox/api';
import { isCaptchaConfigured, solveRecaptcha } from '../src/lib/captcha';

const REFERRAL_LINK = 'https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ';

async function main() {
  console.log('=== LIVE TEST — NO PROXY ===\n');
  
  // Step 1: Create session (no proxy)
  const sessionId = `test-${Date.now().toString(36)}`;
  const tbSession = new TeraBoxSession(sessionId);
  tbSession.setProxyUrl(null); // NO PROXY
  console.log('[1] Session created (no proxy)\n');

  // Step 2: Visit share link first (sets referral cookies)
  console.log('[2] Visiting share link...');
  try {
    const visitResult = await tbSession.visitShareLink(REFERRAL_LINK);
    console.log(`    Result: ${visitResult.success ? 'OK' : visitResult.error}`);
    if (visitResult.error) console.log(`    Full response:`, JSON.stringify(visitResult).substring(0, 500));
  } catch (err) {
    console.log(`    Visit error: ${(err as Error).message}`);
  }
  console.log('');

  // Step 3: Get RSA public key
  console.log('[3] Getting RSA public key...');
  const pubkey = await tbSession.getPubKey();
  if (!pubkey) {
    console.log('    FATAL: Could not get public key. Aborting.');
    process.exit(1);
  }
  console.log(`    Pubkey: ${pubkey.pubkey?.substring(0, 30)}...`);
  console.log('');

  // Step 4: Create temp email
  console.log('[4] Creating temp email (CatchMail.io)...');
  const { createTempEmail } = await import('../src/lib/catchmail');
  const tempEmail = await createTempEmail();
  console.log(`    Email: ${tempEmail.address}`);
  console.log('');

  // Step 5: Encrypt email
  console.log('[5] Encrypting email...');
  const { encryptEmail } = await import('../src/lib/terabox/api');
  let encryptedEmail: string;
  let isEncrypted = false;
  try {
    encryptedEmail = await encryptEmail(tempEmail.address, pubkey.pubkey);
    isEncrypted = true;
    console.log(`    Encrypted: ${encryptedEmail.substring(0, 20)}...`);
  } catch (err) {
    encryptedEmail = tempEmail.address;
    console.log(`    Encryption failed: ${(err as Error).message} — using plaintext`);
  }
  console.log('');

  // Step 6: Send verification code (first attempt — likely needs captcha)
  console.log('[6] Sending verification code (attempt 1 — no captcha token)...');
  let sendResult = await tbSession.sendVerificationCode(encryptedEmail, undefined, isEncrypted);
  console.log(`    Result: success=${sendResult.success}, errno=${sendResult.errno}, error=${sendResult.error || 'none'}`);
  console.log(`    needsCaptcha=${sendResult.needsCaptcha}`);
  if (sendResult.rawResponse) {
    console.log(`    RAW API RESPONSE: ${JSON.stringify(sendResult.rawResponse, null, 2)}`);
  }
  console.log('');

  // Step 7: If captcha required, solve it
  if (sendResult.needsCaptcha) {
    console.log('[7] Captcha required! Attempting to solve...');
    
    if (!isCaptchaConfigured()) {
      console.log('    FATAL: CAPTCHASOLV_API_KEY not set! Cannot solve captcha.');
      console.log('    Set it in .env file');
      process.exit(1);
    }
    
    console.log('    Getting reCAPTCHA sitekey (dynamic)...');
    const siteKey = await getRecaptchaSiteKeyDynamic(undefined); // no proxy
    console.log(`    Sitekey: ${siteKey?.substring(0, 15)}...`);
    
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      console.log(`\n    --- Captcha solve attempt ${attempt + 1}/${MAX_RETRIES} ---`);
      console.log('    Solving reCAPTCHA (NO PROXY — proxyless token)...');
      
      const startTime = Date.now();
      const captchaToken = await solveRecaptcha(siteKey, 'https://www.1024terabox.com/', undefined); // NO PROXY
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      
      if (!captchaToken) {
        console.log(`    Captcha solve FAILED after ${elapsed}s`);
        continue;
      }
      
      console.log(`    Captcha solved in ${elapsed}s — token length: ${captchaToken.length}`);
      console.log(`    Token preview: ${captchaToken.substring(0, 20)}...`);
      
      // Retry sendcode with captcha token
      console.log('    Retrying sendcode with captcha token...');
      await new Promise(r => setTimeout(r, 1000)); // natural delay
      
      sendResult = await tbSession.sendVerificationCode(encryptedEmail, captchaToken, isEncrypted);
      console.log(`    Result: success=${sendResult.success}, errno=${sendResult.errno}, error=${sendResult.error || 'none'}`);
      if (sendResult.rawResponse) {
        console.log(`    RAW API RESPONSE: ${JSON.stringify(sendResult.rawResponse, null, 2)}`);
      }
      
      if (sendResult.success) {
        console.log('\n    ★★★ CAPTCHA ACCEPTED — OTP SENT! ★★★');
        break;
      }
      
      if (isCaptchaErrno(sendResult.errno)) {
        console.log(`    Token rejected (errno ${sendResult.errno}) — will retry with fresh token`);
        continue;
      }
      
      // Different error
      console.log(`    Different error (not captcha) — stopping`);
      break;
    }
  }
  
  console.log('\n=== TEST COMPLETE ===');
  console.log(`Final sendcode result: success=${sendResult.success}, errno=${sendResult.errno}`);
  if (!sendResult.success) {
    console.log(`Error: ${sendResult.error}`);
    if (sendResult.rawResponse) {
      console.log(`Raw response: ${JSON.stringify(sendResult.rawResponse, null, 2)}`);
    }
  } else {
    console.log(`Token: ${sendResult.token?.substring(0, 10)}...`);
    console.log('OTP was sent successfully! The rest of the flow would work from here.');
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
