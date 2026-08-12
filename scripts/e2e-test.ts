/**
 * END-TO-END TEST: Full signup flow — proxy + captcha + sendcode
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });
import * as fs from 'fs';

// Catch ALL unhandled rejections — prevents silent crashes
process.on('unhandledRejection', (reason) => {
  const msg = `UNHANDLED REJECTION: ${reason}`;
  fs.appendFileSync('/home/z/my-project/scripts/e2e-test.log', `[FATAL] ${msg}\n`);
  console.error(msg);
  process.exit(2);
});

const LOG = '/home/z/my-project/scripts/e2e-test.log';
function log(msg: string) {
  const line = `[${new Date().toISOString().substring(11, 19)}] ${msg}\n`;
  fs.appendFileSync(LOG, line);
  process.stdout.write(line);
}

async function main() {
  fs.writeFileSync(LOG, '');
  log('=== E2E TEST: Full Signup Flow ===');
  log(`API KEY: ${process.env.CAPTCHASOLV_API_KEY?.substring(0, 8)}...`);

  const { TeraBoxSession, encryptEmail, getRecaptchaSiteKeyDynamic, isCaptchaErrno } = await import('../src/lib/terabox/api');
  const { isCaptchaConfigured, solveRecaptcha } = await import('../src/lib/captcha');
  const { createTempEmail } = await import('../src/lib/catchmail');
  const { getNextProxy, refreshProxyPool } = await import('../src/lib/proxy');

  // 1. Get proxy
  log('Refreshing proxy pool...');
  try { await refreshProxyPool(); } catch (e) { log(`Refresh: ${(e as Error).message}`); }
  const proxy = await getNextProxy();
  if (proxy) {
    log(`Proxy: ${proxy.host}:${proxy.port} (${proxy.country || '?'}, ${proxy.source || '?'})`);
  } else {
    log('No proxy — trying direct (captcha will likely fail proxyless)');
  }

  // 2. Create session WITH proxy
  const tb = new TeraBoxSession('e2e');
  tb.setProxyUrl(proxy?.url || null);

  // 3. Visit share link
  log('Visiting share link...');
  try {
    const v = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
    log(`Visit: ${v.success ? 'OK' : v.error}`);
  } catch (e) { log(`Visit error: ${(e as Error).message}`); }

  // 4. Get pubkey
  log('Getting pubkey...');
  const pk = await tb.getPubKey();
  if (!pk?.pubkey) { log('FAILED: no pubkey'); process.exit(1); }
  log(`Pubkey: ${pk.pubkey.length} chars`);

  // 5. Create email
  log('Creating temp email...');
  const email = await createTempEmail();
  log(`Email: ${email.address}`);

  // 6. Encrypt email
  let enc: string, isEnc = false;
  try {
    enc = await encryptEmail(email.address, pk.pubkey);
    isEnc = true;
    log('Encrypted OK');
  } catch (e) {
    enc = email.address;
    log(`Encryption failed: ${(e as Error).message} — plaintext`);
  }

  // 7. Sendcode (no captcha)
  log('sendcode (no captcha)...');
  let res = await tb.sendVerificationCode(enc, undefined, isEnc);
  log(`Result: success=${res.success} errno=${res.errno} needsCaptcha=${res.needsCaptcha}`);
  if (res.rawResponse) log(`RAW: ${JSON.stringify(res.rawResponse).substring(0, 300)}`);

  // 8. Solve captcha + retry sendcode
  if ((res.needsCaptcha || !res.success) && isCaptchaConfigured()) {
    log('Getting sitekey...');
    const siteKey = await getRecaptchaSiteKeyDynamic(proxy?.url);
    log(`Sitekey: ${siteKey?.substring(0, 20)}... (len=${siteKey?.length || 0})`);
    if (!siteKey) { log('FAILED: no sitekey'); process.exit(1); }

    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`\n--- Captcha attempt ${attempt}/3 ---`);
      const t0 = Date.now();
      const result = await solveRecaptcha(siteKey, 'https://www.1024terabox.com/', proxy?.url);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      
      if (!result.token) {
        log(`FAILED after ${elapsed}s — ${result.errors.length} errors:`);
        result.errors.forEach(e => log(`  - ${e.phase}/${e.type}: ${e.error} ${e.errorCode || ''}`));
        continue;
      }
      
      log(`Solved in ${elapsed}s! Token length: ${result.token.length}`);

      // Retry sendcode WITH SAME PROXY (token is IP-bound!)
      log('Retrying sendcode with captcha token...');
      await new Promise(r => setTimeout(r, 1000));
      res = await tb.sendVerificationCode(enc, result.token, isEnc);
      log(`Result: success=${res.success} errno=${res.errno} error=${res.error || 'none'}`);
      if (res.rawResponse) log(`RAW: ${JSON.stringify(res.rawResponse).substring(0, 300)}`);

      if (res.success) {
        log('\n★★★ CAPTCHA ACCEPTED — OTP SENT! ★★★');
        break;
      }
      if (isCaptchaErrno(res.errno)) {
        log(`Token rejected (errno ${res.errno}) — retrying...`);
        continue;
      }
      log('Non-captcha error — stopping');
      break;
    }
  }

  log(`\nFINAL: success=${res.success} errno=${res.errno} error=${res.error || 'none'}`);
  process.exit(res.success ? 0 : 1);
}

main().catch(e => { log(`FATAL: ${e}`); process.exit(1); });
