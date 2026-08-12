/**
 * Full end-to-end signup test using uploaded proxies.
 * Uses the project's own TeraBoxSession + solveRecaptcha for proper flow.
 */
import { config } from 'dotenv';
config({ path: '/home/z/my-project/.env' });

import * as fs from 'fs';

const LOG_FILE = '/home/z/my-project/scripts/proxy-test-results.log';
const PROXY_FILE = '/home/z/my-project/upload/proxies.txt';

function log(msg: string) {
  const ts = new Date().toISOString().substring(11, 19);
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

async function main() {
  fs.writeFileSync(LOG_FILE, `=== E2E PROXY TEST ${new Date().toISOString()} ===\n`);

  // Load modules
  const { TeraBoxSession, isCaptchaErrno, getRecaptchaSiteKeyDynamic, encryptEmail } = await import('../src/lib/terabox/api');
  const { solveRecaptcha, isCaptchaConfigured } = await import('../src/lib/captcha');
  const { createTempEmail, pollForMessages } = await import('../src/lib/catchmail/client');

  // Read proxies
  const proxyLines = fs.readFileSync(PROXY_FILE, 'utf-8').trim().split('\n').filter(l => l.trim());
  log(`Loaded ${proxyLines.length} proxies`);

  if (!isCaptchaConfigured()) {
    log('ERROR: CaptchaSolv not configured!');
    return;
  }

  // Test a selection of proxies
  const testProxies = proxyLines.slice(0, 20);
  log(`Testing first ${testProxies.length} proxies`);

  for (let pIdx = 0; pIdx < testProxies.length; pIdx++) {
    const proxyUrl = testProxies[pIdx].trim();
    log(`\n${'═'.repeat(60)}`);
    log(`Proxy ${pIdx + 1}/${testProxies.length}: ${proxyUrl}`);

    // Create TeraBox session WITH proxy
    const tb = new TeraBoxSession(`proxytest-${pIdx}`);
    tb.setProxyUrl(proxyUrl);

    // Step 1: Visit share link (establishes cookies)
    log('[1] Visiting share link...');
    try {
      const visitResult = await tb.visitShareLink('https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ');
      log(`    Visit: ${visitResult.success ? 'OK' : visitResult.error || 'failed'}`);
    } catch (e: any) {
      log(`    Visit error: ${e.message?.substring(0, 60)}`);
    }

    // Step 2: Get pubkey
    log('[2] Getting pubkey...');
    const pk = await tb.getPubKey();
    if (!pk) {
      log('    getpubkey FAILED — skipping proxy');
      continue;
    }
    log(`    pubkey OK (pp1 len=${pk.pp1.length})`);

    // Step 3: Create temp email
    log('[3] Creating temp email...');
    const emailResult = await createTempEmail();
    const email = emailResult.address;
    log(`    Email: ${email}`);

    // Don't encrypt email — TeraBox's custom pubkey format doesn't work with standard RSA.
    // TeraBox accepts unencrypted emails (both formats supported).
    // Also don't set fs-ex-st header since we're not encrypting.
    const encryptedEmail = email;
    const isEncrypted = false;

    // Step 4: Send verification code (first try — no captcha)
    log('[4] sendcode (no captcha)...');
    let sendResult = await tb.sendVerificationCode(encryptedEmail, undefined, false);
    log(`    Result: success=${sendResult.success} errno=${sendResult.errno} needsCaptcha=${sendResult.needsCaptcha}`);

    if (sendResult.success) {
      log('\n★★★ OTP SENT WITHOUT CAPTCHA! ★★★');
      log(`Email: ${email}, Proxy: ${proxyUrl}`);
      await pollAndExtractOtp(email, tb, sendResult.token);
      return; // SUCCESS!
    }

    if (!sendResult.needsCaptcha) {
      log(`    sendcode error: ${sendResult.error}`);
      if (sendResult.rawResponse) log(`    Raw: ${JSON.stringify(sendResult.rawResponse).substring(0, 300)}`);
      continue;
    }

    // Step 5: Extract sitekey and solve captcha
    log('[5] Captcha required — extracting sitekey...');
    const siteKey = await getRecaptchaSiteKeyDynamic(proxyUrl);
    if (!siteKey) {
      log('    No sitekey — skipping proxy');
      continue;
    }
    log(`    Sitekey: ${siteKey.substring(0, 25)}...`);

    // Try up to 3 captcha solve attempts
    for (let attempt = 1; attempt <= 3; attempt++) {
      log(`\n    === Captcha attempt ${attempt}/3 ===`);

      const t0 = Date.now();
      const result = await solveRecaptcha(siteKey, 'https://www.1024terabox.com/', proxyUrl);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      if (!result?.token) {
        log(`    Solve FAILED after ${elapsed}s`);
        if (result?.errors?.length) {
          for (const err of result.errors) {
            log(`    Error: phase=${err.phase} type=${err.type} error=${err.error} code=${err.errorCode || 'none'}`);
          }
        }
        // Rate limit backoff
        const hasLimitError = result?.errors?.some(e => e.errorCode === 'ERROR_LIMIT_EXCEEDED');
        if (hasLimitError) {
          log('    Rate limited — waiting 12s...');
          await new Promise(r => setTimeout(r, 12000));
        }
        continue;
      }

      log(`    SOLVED in ${elapsed}s, token length=${result.token.length}`);
      if (result.errors.length > 0) {
        log(`    Warnings: ${JSON.stringify(result.errors)}`);
      }

      // Step 6: Retry sendcode with captcha token
      log('    Retrying sendcode with token...');
      await new Promise(r => setTimeout(r, 1500)); // Brief delay

      sendResult = await tb.sendVerificationCode(encryptedEmail, result.token, false);
      log(`    Result: success=${sendResult.success} errno=${sendResult.errno} needsCaptcha=${sendResult.needsCaptcha}`);

      if (sendResult.success) {
        log('\n★★★ OTP SENT SUCCESSFULLY! ★★★');
        log(`Email: ${email}`);
        log(`Proxy: ${proxyUrl}`);
        log(`Captcha errors/warnings: ${JSON.stringify(result.errors)}`);
        if (sendResult.rawResponse) log(`Raw: ${JSON.stringify(sendResult.rawResponse).substring(0, 300)}`);

        // Poll for OTP and complete verification
        await pollAndExtractOtp(email, tb, sendResult.token);
        return; // SUCCESS!
      }

      if (isCaptchaErrno(sendResult.errno)) {
        log(`    Token rejected (errno ${sendResult.errno}) — retrying with new token...`);
        if (sendResult.rawResponse) log(`    Raw: ${JSON.stringify(sendResult.rawResponse).substring(0, 200)}`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      log(`    sendcode failed: ${sendResult.error}`);
      if (sendResult.rawResponse) log(`    Raw: ${JSON.stringify(sendResult.rawResponse).substring(0, 200)}`);
      break;
    }

    log(`\n    Proxy ${proxyUrl} — signup failed, trying next...`);
  }

  log('\n=== ALL PROXIES TESTED — NO SUCCESSFUL SIGNUP ===');
}

async function pollAndExtractOtp(email: string, tb: any, token?: string): Promise<void> {
  const { extractVerificationCode } = await import('../src/lib/catchmail/extractors');
  
  log('\n[Poll] Waiting for OTP email...');
  try {
    const message = await pollForMessages(email, 30, 3000);
    if (!message) {
      log('[Poll] No email received (timeout)');
      return;
    }

    const text = message.body?.text || '';
    const html = message.body?.html || '';
    log(`[Poll] Email received! Subject: "${message.subject}" From: ${message.from}`);

    // Try to extract verification code
    let code: string | null = null;
    try {
      code = extractVerificationCode(message);
    } catch {
      // Manual extraction
    }
    if (!code) {
      const match = (text + html).match(/\b(\d{6})\b/);
      code = match?.[1] || null;
    }

    if (!code) {
      log(`[Poll] Could not extract code from email`);
      log(`[Poll] Body preview: ${text.substring(0, 200)}`);
      return;
    }

    log(`[Poll] OTP code: ${code}`);

    // Verify the code
    log('[Verify] Verifying OTP code...');
    const verifyResult = await tb.verifyCode(token || '', code);
    log(`[Verify] Result: success=${verifyResult.success} errno=${verifyResult.errno}`);

    if (verifyResult.success) {
      log('\n★★★ OTP VERIFIED! Registration can proceed! ★★★');
    } else {
      log(`[Verify] Failed: ${verifyResult.error}`);
    }
  } catch (e: any) {
    log(`[Poll] Error: ${e.message?.substring(0, 80)}`);
  }
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  console.error(e);
  process.exit(1);
});
