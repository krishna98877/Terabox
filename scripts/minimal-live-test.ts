/**
 * Step-by-step live test with progress saving to file
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });
import * as fs from 'fs';

const LOG = '/home/z/my-project/scripts/test-progress.log';
function log(msg: string) {
  const line = `[${new Date().toISOString().substring(11, 19)}] ${msg}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}

async function main() {
  fs.writeFileSync(LOG, '');
  log('=== MINIMAL LIVE TEST ===');
  log(`API KEY: ${process.env.CAPTCHASOLV_API_KEY?.substring(0, 8)}... (len=${process.env.CAPTCHASOLV_API_KEY?.length || 0})`);

  if (!process.env.CAPTCHASOLV_API_KEY) {
    log('FATAL: CAPTCHASOLV_API_KEY not set!');
    process.exit(1);
  }

  const { TeraBoxSession, encryptEmail, getRecaptchaSiteKeyDynamic, isCaptchaErrno } = await import('../src/lib/terabox/api');
  const { isCaptchaConfigured, solveRecaptcha, getBalance } = await import('../src/lib/captcha');
  const { createTempEmail } = await import('../src/lib/catchmail');

  log(`Captcha configured: ${isCaptchaConfigured()}`);
  
  const bal = await getBalance();
  log(`Balance: ${bal.error ? `ERR: ${bal.error}` : `$${bal.balance}`} (${bal.provider})`);

  // Session
  const tb = new TeraBoxSession('mintest');
  tb.setProxyUrl(null);
  log('Session created (no proxy)');

  // Visit share link
  log('Visiting share link...');
  const v = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
  log(`Visit: ${v.success ? 'OK' : v.error}`);

  // Pubkey
  log('Getting pubkey...');
  const pk = await tb.getPubKey();
  if (!pk?.pubkey) { log('FAILED: no pubkey'); process.exit(1); }
  log(`Pubkey: ${pk.pubkey.length} chars`);

  // Email
  log('Creating temp email...');
  const email = await createTempEmail();
  log(`Email: ${email.address}`);

  // Encrypt
  let enc: string, isEnc = false;
  try {
    enc = await encryptEmail(email.address, pk.pubkey);
    isEnc = true;
    log('Encrypted OK');
  } catch (e) {
    enc = email.address;
    log(`Encryption failed: ${(e as Error).message} — plaintext`);
  }

  // Sendcode (no captcha)
  log('sendcode (no captcha)...');
  let res = await tb.sendVerificationCode(enc, undefined, isEnc);
  log(`Result: success=${res.success} errno=${res.errno} needsCaptcha=${res.needsCaptcha}`);
  if (res.rawResponse) log(`RAW: ${JSON.stringify(res.rawResponse).substring(0, 400)}`);

  // Solve captcha
  if ((res.needsCaptcha || !res.success) && isCaptchaConfigured()) {
    log('Getting sitekey...');
    const siteKey = await getRecaptchaSiteKeyDynamic(undefined);
    log(`Sitekey: ${siteKey?.substring(0, 20)}... (len=${siteKey?.length || 0})`);
    if (!siteKey) { log('FAILED: no sitekey'); process.exit(1); }

    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`Captcha attempt ${attempt}/3 (proxyless)...`);
      const t0 = Date.now();
      const result = await solveRecaptcha(siteKey, 'https://www.1024terabox.com/', undefined);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      
      if (!result.token) {
        log(`FAILED after ${elapsed}s — ${result.errors.length} errors:`);
        result.errors.forEach(e => log(`  - ${e.phase}/${e.type}: ${e.error} ${e.errorCode || ''}`));
        continue;
      }
      
      log(`Solved in ${elapsed}s! Token length: ${result.token.length}`);

      // Retry sendcode
      log('Retrying sendcode with token...');
      await new Promise(r => setTimeout(r, 1000));
      res = await tb.sendVerificationCode(enc, result.token, isEnc);
      log(`Result: success=${res.success} errno=${res.errno} error=${res.error || 'none'}`);
      if (res.rawResponse) log(`RAW: ${JSON.stringify(res.rawResponse).substring(0, 400)}`);

      if (res.success) {
        log('★★★ CAPTCHA ACCEPTED — OTP SENT! ★★★');
        break;
      }
      if (isCaptchaErrno(res.errno)) {
        log(`Token rejected (errno ${res.errno}) — retrying...`);
        continue;
      }
      log('Non-captcha error — stopping');
      break;
    }
  } else if (!isCaptchaConfigured()) {
    log('Captcha not configured — skipping solve');
  }

  log(`FINAL: success=${res.success} errno=${res.errno} error=${res.error || 'none'}`);
  process.exit(res.success ? 0 : 1);
}

main().catch(e => { log(`FATAL: ${e}`); process.exit(1); });
