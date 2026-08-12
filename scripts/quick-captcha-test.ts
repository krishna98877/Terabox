/**
 * Quick: just test sitekey extraction + captcha solve
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const { getRecaptchaSiteKeyDynamic } = await import('../src/lib/terabox/api');
  const { isCaptchaConfigured, solveRecaptcha } = await import('../src/lib/captcha');
  const { getNextProxy } = await import('../src/lib/proxy');

  // Test 1: Extract sitekey (no proxy)
  console.log('=== Sitekey Extraction ===');
  const sk1 = await getRecaptchaSiteKeyDynamic(undefined);
  console.log(`No proxy: ${sk1}`);

  // Test 2: Extract sitekey (with proxy)
  const proxy = await getNextProxy();
  if (proxy) {
    console.log(`\nProxy: ${proxy.host}:${proxy.port}`);
    const sk2 = await getRecaptchaSiteKeyDynamic(proxy.url);
    console.log(`With proxy: ${sk2}`);
  }

  // Test 3: Solve captcha proxyless
  if (isCaptchaConfigured()) {
    console.log('\n=== Solving Captcha (proxyless) ===');
    const t0 = Date.now();
    const token = await solveRecaptcha(sk1, 'https://www.1024terabox.com/', undefined);
    console.log(`Time: ${((Date.now()-t0)/1000).toFixed(1)}s`);
    console.log(`Token len: ${token?.token?.length || 0}`);
    console.log(`Token preview: ${token?.token?.substring(0, 30) || 'NONE'}...`);
    if (token?.errors?.length) console.log(`Errors: ${JSON.stringify(token.errors)}`);

    // Now test the sendcode API directly to see if token works
    console.log('\n=== Testing sendcode with token ===');
    const { TeraBoxSession, encryptEmail } = await import('../src/lib/terabox/api');
    const { createTempEmail } = await import('../src/lib/catchmail');
    
    const tb = new TeraBoxSession('sktest');
    tb.setProxyUrl(null);
    
    // Visit share link first
    await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
    
    const pk = await tb.getPubKey();
    if (!pk) { console.log('No pubkey'); return; }
    
    const email = await createTempEmail();
    console.log(`Email: ${email.address}`);
    
    let enc: string, isEnc = false;
    try { enc = await encryptEmail(email.address, pk.pubkey); isEnc = true; } 
    catch { enc = email.address; }
    
    // sendcode WITH the token
    if (token?.token) {
      const res = await tb.sendVerificationCode(enc, token.token, isEnc);
      console.log(`Result: success=${res.success} errno=${res.errno} error=${res.error||'none'}`);
      if (res.rawResponse) console.log(`RAW: ${JSON.stringify(res.rawResponse)}`);
    }
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
