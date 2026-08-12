/**
 * Test captcha solving WITH proxy (proxy-bound token)
 * This is the correct approach for Enterprise reCAPTCHA
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  console.log('=== CAPTCHA TEST WITH PROXY ===\n');
  
  const { TeraBoxSession, isCaptchaErrno, getRecaptchaSiteKeyDynamic, encryptEmail } = await import('../src/lib/terabox/api');
  const { isCaptchaConfigured, solveRecaptcha } = await import('../src/lib/captcha');
  const { createTempEmail } = await import('../src/lib/catchmail');
  const { getNextProxy } = await import('../src/lib/proxy');

  // Get a proxy
  console.log('[1] Getting proxy...');
  const proxy = await getNextProxy();
  if (!proxy) { console.log('No proxy! Trying without...'); }
  else console.log(`    Proxy: ${proxy.host}:${proxy.port} (${proxy.country || '?'})`);

  // Create session WITH proxy
  const tb = new TeraBoxSession('proxytest');
  if (proxy) tb.setProxyUrl(proxy.url);
  else tb.setProxyUrl(null);

  // Visit share link
  console.log('[2] Visiting share link via proxy...');
  try {
    const v = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
    console.log(`    ${v.success ? 'OK' : v.error}`);
  } catch (e: any) { console.log(`    Error: ${e.message}`); }

  // Get pubkey
  console.log('[3] Getting pubkey...');
  const pk = await tb.getPubKey();
  if (!pk) { console.log('FAILED'); return; }
  console.log(`    Got pubkey`);

  // Create email
  const email = await createTempEmail();
  console.log(`[4] Email: ${email.address}`);

  // sendcode (first try — will likely need captcha)
  console.log('[5] sendcode (no captcha)...');
  let res = await tb.sendVerificationCode(email.address, undefined, false);
  console.log(`    success=${res.success} errno=${res.errno} needsCaptcha=${res.needsCaptcha}`);

  if (res.needsCaptcha && isCaptchaConfigured()) {
    const siteKey = await getRecaptchaSiteKeyDynamic(proxy?.url);
    console.log(`[6] Sitekey: ${siteKey?.substring(0, 20)}...`);

    for (let i = 0; i < 3; i++) {
      console.log(`\n    === Attempt ${i+1}/3 ===`);
      console.log(`    Solving captcha WITH proxy (proxy-bound token)...`);
      
      const t0 = Date.now();
      const result = await solveRecaptcha(siteKey, 'https://www.1024terabox.com/', proxy?.url);
      const elapsed = ((Date.now()-t0)/1000).toFixed(1);
      
      if (!result?.token) { console.log(`    Solve FAILED after ${elapsed}s`); if (result?.errors?.length) console.log(`    Errors: ${JSON.stringify(result.errors)}`); continue; }
      console.log(`    Solved in ${elapsed}s, len=${result.token.length}`);

      console.log(`    Retrying sendcode with proxy-bound token...`);
      await new Promise(r => setTimeout(r, 1000));
      res = await tb.sendVerificationCode(email.address, result.token, false);
      console.log(`    success=${res.success} errno=${res.errno}`);
      if (res.rawResponse) console.log(`    RAW: ${JSON.stringify(res.rawResponse).substring(0, 300)}`);
      
      if (res.success) {
        console.log('\n★★★ CAPTCHA ACCEPTED — OTP SENT ★★★');
        console.log(`Token: ${res.token?.substring(0, 10)}...`);
        break;
      }
      if (isCaptchaErrno(res.errno)) {
        console.log(`    Rejected (errno ${res.errno}) — retrying...`);
        continue;
      }
      break;
    }
  }

  console.log('\n=== RESULT ===');
  console.log(`success=${res.success} errno=${res.errno} error=${res.error||'none'}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
