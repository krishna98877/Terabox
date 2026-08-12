/**
 * Test with proxy — use one of the validated proxies
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  console.log('=== TEST WITH PROXY ===\n');

  const { TeraBoxSession, isCaptchaErrno, getRecaptchaSiteKeyDynamic, encryptEmail } = await import('../src/lib/terabox/api');
  const { isCaptchaConfigured, solveRecaptcha } = await import('../src/lib/captcha');
  const { createTempEmail } = await import('../src/lib/catchmail');
  const { getNextProxy } = await import('../src/lib/proxy');

  // Get a proxy
  console.log('[1] Getting proxy...');
  const proxy = await getNextProxy();
  if (!proxy) {
    console.log('No proxy available!');
    return;
  }
  console.log(`    Proxy: ${proxy.host}:${proxy.port} (${proxy.country || 'unknown'}) [${proxy.source}]`);

  // Create session with proxy
  const tb = new TeraBoxSession('ptest');
  tb.setProxyUrl(proxy.url);
  console.log('[2] Session created with proxy');

  // Visit share link
  console.log('[3] Visiting share link...');
  try {
    const v = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
    console.log(`    ${v.success ? 'OK' : v.error}`);
  } catch (e: any) {
    console.log(`    Error: ${e.message}`);
  }

  // Get pubkey
  console.log('[4] Getting pubkey...');
  const pk = await tb.getPubKey();
  if (!pk) { console.log('FAILED'); return; }
  console.log(`    Got pubkey (${pk.pubkey?.length} chars)`);

  // Create email
  console.log('[5] Creating email...');
  const email = await createTempEmail();
  console.log(`    ${email.address}`);

  // Encrypt
  let enc: string, isEnc = false;
  try {
    enc = await encryptEmail(email.address, pk.pubkey);
    isEnc = true;
    console.log('[6] Encrypted OK');
  } catch (e: any) {
    enc = email.address;
    console.log(`[6] Encryption failed: ${e.message}, using plaintext`);
  }

  // sendcode
  console.log('\n[7] sendcode (no captcha)...');
  let res = await tb.sendVerificationCode(enc, undefined, isEnc);
  console.log(`    success=${res.success} errno=${res.errno} needsCaptcha=${res.needsCaptcha}`);
  console.log(`    error=${res.error || 'none'}`);
  if (res.rawResponse) console.log(`    RAW: ${JSON.stringify(res.rawResponse).substring(0, 500)}`);

  // Solve captcha with proxy
  if (res.needsCaptcha && isCaptchaConfigured()) {
    console.log('\n[8] Solving captcha WITH PROXY...');
    const sk = await getRecaptchaSiteKeyDynamic(proxy.url);
    console.log(`    sitekey: ${sk?.substring(0, 20)}... (len=${sk?.length || 0})`);

    for (let i = 0; i < 3; i++) {
      console.log(`\n    --- attempt ${i+1}/3 ---`);
      const t0 = Date.now();
      const result = await solveRecaptcha(sk, 'https://www.1024terabox.com/', proxy.url);
      console.log(`    Solved in ${((Date.now()-t0)/1000).toFixed(1)}s, len=${result?.token?.length || 0}`);
      if (result?.errors?.length) console.log(`    Errors: ${JSON.stringify(result.errors)}`);

      if (!result?.token) { console.log('    Solve FAILED'); continue; }

      console.log(`    Retrying sendcode with proxy-bound token...`);
      await new Promise(r => setTimeout(r, 800));
      res = await tb.sendVerificationCode(enc, result.token, isEnc);
      console.log(`    success=${res.success} errno=${res.errno}`);
      if (res.rawResponse) console.log(`    RAW: ${JSON.stringify(res.rawResponse).substring(0, 500)}`);
      
      if (res.success) { console.log('\n★★★ CAPTCHA ACCEPTED — OTP SENT ★★★'); break; }
      if (isCaptchaErrno(res.errno)) { console.log(`    Token rejected (errno ${res.errno}), retrying...`); continue; }
      break;
    }
  }

  console.log('\n=== DONE ===');
  console.log(`Final: success=${res.success} errno=${res.errno} error=${res.error||'none'}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
