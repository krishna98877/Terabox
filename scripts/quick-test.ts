/**
 * Quick test — just test sendcode + captcha, NO PROXY
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  console.log('=== QUICK TEST: sendcode WITHOUT proxy ===\n');

  const { TeraBoxSession, isCaptchaErrno, getRecaptchaSiteKeyDynamic, encryptEmail } = await import('../src/lib/terabox/api');
  const { isCaptchaConfigured, solveRecaptcha } = await import('../src/lib/captcha');
  const { createTempEmail } = await import('../src/lib/catchmail');

  // 1. Create session (no proxy)
  const tb = new TeraBoxSession('qtest');
  tb.setProxyUrl(null);
  console.log('[1] Session created — no proxy');

  // 2. Visit share link
  console.log('[2] Visiting share link...');
  try {
    const v = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
    console.log(`    ${v.success ? 'OK' : v.error}`);
  } catch (e: any) {
    console.log(`    Error: ${e.message}`);
  }

  // 3. Get pubkey
  console.log('[3] Getting pubkey...');
  const pk = await tb.getPubKey();
  if (!pk) { console.log('FAILED to get pubkey'); return; }
  console.log(`    Got pubkey (${pk.pubkey?.length} chars)`);

  // 4. Create email
  console.log('[4] Creating email...');
  const email = await createTempEmail();
  console.log(`    ${email.address}`);

  // 5. Encrypt
  let enc: string, isEnc = false;
  try {
    enc = await encryptEmail(email.address, pk.pubkey);
    isEnc = true;
    console.log('[5] Encrypted OK');
  } catch {
    enc = email.address;
    console.log('[5] Encryption failed, using plaintext');
  }

  // 6. sendcode (no captcha)
  console.log('\n[6] sendcode (no captcha token)...');
  let res = await tb.sendVerificationCode(enc, undefined, isEnc);
  console.log(`    success=${res.success} errno=${res.errno} needsCaptcha=${res.needsCaptcha}`);
  console.log(`    error=${res.error || 'none'}`);
  if (res.rawResponse) console.log(`    RAW: ${JSON.stringify(res.rawResponse).substring(0, 500)}`);

  // 7. If captcha needed, solve
  if (res.needsCaptcha && isCaptchaConfigured()) {
    console.log('\n[7] Solving captcha (proxyless)...');
    const sk = await getRecaptchaSiteKeyDynamic(undefined);
    console.log(`    sitekey: ${sk?.substring(0, 15)}...`);

    for (let i = 0; i < 2; i++) {
      console.log(`\n    --- attempt ${i+1}/2 ---`);
      const t0 = Date.now();
      const token = await solveRecaptcha(sk, 'https://www.1024terabox.com/', undefined);
      console.log(`    Solved in ${((Date.now()-t0)/1000).toFixed(1)}s, len=${token?.length || 0}`);

      if (!token) { console.log('    Solve FAILED'); continue; }

      console.log(`    Retrying sendcode with token...`);
      await new Promise(r => setTimeout(r, 800));
      res = await tb.sendVerificationCode(enc, token, isEnc);
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
