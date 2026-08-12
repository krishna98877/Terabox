/**
 * Direct test: TeraBoxSession sendcode flow
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

async function main() {
  const { TeraBoxSession, encryptEmail, getRecaptchaSiteKeyDynamic } = await import('../src/lib/terabox/api');
  const { createTempEmail } = await import('../src/lib/catchmail');

  // Create session WITHOUT proxy
  const tb = new TeraBoxSession('direct-noproxy');
  tb.setProxyUrl(null);

  // Step 1: Visit share link
  console.log('--- Visiting share link ---');
  const visit = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
  console.log(`Visit: ${visit.success ? 'OK' : visit.error}`);
  console.log(`Cookies: ${tb.getCookieCount()}`);

  // Step 2: Get pubkey
  console.log('\n--- Getting pubkey ---');
  const pk = await tb.getPubKey();
  console.log(`Pubkey: ${pk?.pubkey ? 'OK (len=' + pk.pubkey.length + ')' : 'NONE'}`);

  // Step 3: Create email
  const email = await createTempEmail();
  console.log(`Email: ${email.address}`);

  // Step 4: Encrypt email
  let enc: string, isEnc = false;
  try { enc = await encryptEmail(email.address, pk!.pubkey); isEnc = true; } catch (e) { 
    console.log(`Encryption failed: ${(e as Error).message}`);
    enc = email.address; 
  }
  console.log(`Encrypted: ${isEnc} (len=${enc.length})`);

  // Step 5: Sendcode WITHOUT captcha token first
  console.log('\n--- Sendcode (no captcha) ---');
  const res = await tb.sendVerificationCode(enc, undefined, isEnc);
  console.log(`Result: success=${res.success} errno=${res.errno} error=${res.error || 'none'}`);
  console.log(`needsCaptcha: ${res.needsCaptcha}`);
  if (res.rawResponse) console.log(`RAW: ${JSON.stringify(res.rawResponse).substring(0, 600)}`);

  console.log('\n=== DONE ===');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
