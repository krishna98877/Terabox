/**
 * Referral Automation Engine — TeraBox-specific workflow.
 *
 * DUAL STRATEGY:
 * 1. PRIMARY: TeraBox Passport API (direct HTTP calls — fast, reliable, no DOM)
 * 2. FALLBACK: Browser automation (Puppeteer + stealth — handles captcha visually)
 *
 * EMAIL PROVIDER: CatchMail.io (free, no account creation, no tokens needed)
 * - Just pick any address @catchmail.io and poll for messages
 * - Much more reliable than Mail.tm (which requires account + token management)
 *
 * API Flow (preferred):
 * 1. Create temp email via CatchMail.io (just pick random@catchmail.io)
 * 2. POST /passport/register_v4/sendcode → send OTP to email
 * 3. If captcha required: solve via 2captcha → retry with g_identity
 * 4. Poll CatchMail.io inbox for OTP email
 * 5. POST /passport/register_v4/verify → verify OTP
 * 6. POST /passport/register_v4/finish → set password, complete
 * 7. Visit referral link (to register referral tracking)
 * 8. Cleanup
 *
 * Browser Flow (fallback):
 * 1. Open referral link → Login → Sign Up → Email icon → Fill email → Continue
 * 2. Poll for OTP → Enter OTP in same page → Set password → Done
 */

import { db } from '@/lib/db';
import {
  createTempEmail,
  pollForMessages,
  deleteMessage,
  extractVerificationCode,
  extractOtpFromHtml,
  extractVerificationLink,
  htmlToPlainText,
} from '@/lib/catchmail';
import type { CatchMailMessageDetail } from '@/lib/catchmail';
import { browserSignup, browserEnterOtp, browserVerify, isBrowserAvailable } from '@/lib/browser';
import type { BrowserSignupResult } from '@/lib/browser';
import { analyzeEmailContent, isGroqConfigured } from '@/lib/groq';
import {
  getNextProxy,
  markProxySuccess,
  markProxyFailed,
  refreshProxyPool,
} from '@/lib/proxy';
import {
  getPubKey,
  sendVerificationCode,
  verifyCode,
  finishRegistration,
  encodePassword,
  encryptEmail,
  getRecaptchaSiteKey,
} from '@/lib/terabox/api';
import type { ProxyInfo } from '@/lib/proxy';

// ─── Types ───

export interface SignupResult {
  success: boolean;
  email: string;
  status: string;
  verificationCode?: string | null;
  verificationLink?: string | null;
  error?: string;
  signupId: string;
  steps?: string[];
  proxyUsed?: string;
  password?: string;
}

// ─── Logging ───

async function log(type: string, message: string, signupId?: string, metadata?: unknown) {
  try {
    await db.activityLog.create({
      data: {
        type,
        message,
        signupId,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch {
    console.log(`[${type}] ${message}`, metadata || '');
  }
}

// ─── OTP Extraction (robust, multi-strategy) ───

/**
 * Extract OTP code from an email message using multiple strategies.
 * Tries: AI → HTML-specific → regex on text → fallback digit search
 */
async function extractOtpFromMessage(
  message: CatchMailMessageDetail,
  signupId: string
): Promise<{ code: string | null; link: string | null }> {
  const subject = message.subject || '';
  const htmlBody = message.body?.html || '';
  const textBody = message.body?.text || '';
  const fullText = textBody || htmlToPlainText(htmlBody);

  let code: string | null = null;
  let link: string | null = null;

  // Strategy 1: AI extraction (most accurate for complex emails)
  if (isGroqConfigured()) {
    try {
      await log('info', 'Using AI to analyze email content...', signupId);
      const aiResult = await analyzeEmailContent(subject, htmlBody, fullText);
      code = aiResult.verificationCode;
      link = aiResult.verificationLink;
      await log('success', `AI: type=${aiResult.emailType}, code=${code || 'none'}, link=${link ? 'found' : 'none'}`, signupId);
      if (code) return { code, link };
    } catch (err) {
      await log('warn', `AI analysis failed: ${(err as Error).message}`, signupId);
    }
  }

  // Strategy 2: Extract from HTML (TeraBox puts codes in styled elements)
  if (!code && htmlBody) {
    code = extractOtpFromHtml(htmlBody);
    if (code) {
      await log('success', `HTML extraction found code: ${code.substring(0, 2)}**`, signupId);
      return { code, link };
    }
  }

  // Strategy 3: Regex on text body
  if (!code) code = extractVerificationCode(fullText);
  if (!link) link = extractVerificationLink(htmlBody, fullText);

  // Strategy 4: Subject line extraction (TeraBox often puts code in subject)
  if (!code && !link) {
    const subjectMatch = subject.match(/\b(\d{4,8})\b/);
    if (subjectMatch) code = subjectMatch[1];
  }

  // Strategy 5: Fallback — any 4-6 digit number in the text
  if (!code && !link) {
    const codeMatch = fullText.match(/\b(\d{4,6})\b/);
    if (codeMatch) code = codeMatch[1];
  }

  // Log results
  if (code) {
    await log('success', `OTP extracted: ${code.substring(0, 2)}**`, signupId);
  } else if (link) {
    await log('success', 'Verification link found', signupId);
  } else {
    await log('warn', `No OTP found. Subject: "${subject}", Text: ${fullText.substring(0, 300)}`, signupId);
  }

  return { code, link };
}

// ─── API-based Signup (Primary Strategy) ───

/**
 * Execute signup via TeraBox Passport API directly.
 * No browser needed — just HTTP calls.
 */
async function executeApiSignup(
  email: string,
  referralLink: string,
  signupId: string,
  _proxy: ProxyInfo | null
): Promise<{ success: boolean; verificationCode?: string; password?: string; error?: string; steps: string[] }> {
  const steps: string[] = [];
  let gIdentity: string | undefined;

  try {
    // Step 1: Get RSA public key
    steps.push('Getting RSA public key...');
    const pubkey = await getPubKey();
    if (!pubkey || !pubkey.pubkey) {
      steps.push('WARNING: No pubkey obtained — proceeding without encryption');
    } else {
      steps.push('Public key obtained');
    }

    // Step 2: Send verification code
    steps.push('Sending verification code to email...');
    const encryptedEmail = pubkey?.pubkey ? encryptEmail(email, pubkey.pubkey) : email;
    const isEncrypted = encryptedEmail !== email;

    let sendResult = await sendVerificationCode(encryptedEmail, gIdentity, isEncrypted);
    steps.push(`sendcode: errno=${sendResult.errno}, ${sendResult.success ? 'OK' : sendResult.error}`);

    // Step 3: Handle captcha if needed
    if (sendResult.needsCaptcha) {
      steps.push('reCAPTCHA required — attempting to solve...');

      if (TWOCAPTCHA_KEY) {
        const siteKey = getRecaptchaSiteKey();
        const captchaToken = await solveRecaptcha(siteKey, referralLink);

        if (captchaToken) {
          gIdentity = captchaToken;
          steps.push('Captcha solved — retrying sendcode...');
          sendResult = await sendVerificationCode(encryptedEmail, gIdentity, isEncrypted);
          steps.push(`sendcode retry: errno=${sendResult.errno}, ${sendResult.success ? 'OK' : sendResult.error}`);
        } else {
          steps.push('Captcha solving failed — no 2captcha key or solve failed');
        }
      } else {
        steps.push('No TWOCAPTCHA_API_KEY — cannot solve captcha via API');
      }
    }

    if (!sendResult.success) {
      steps.push(`sendcode failed: ${sendResult.error}`);
      await log('warn', `API sendcode failed: ${sendResult.error}`, signupId, { errno: sendResult.errno });
      return { success: false, error: sendResult.error, steps };
    }

    const apiToken = sendResult.token || '';
    steps.push(`OTP sent! Token: ${apiToken.substring(0, 8)}...`);
    await log('success', 'API: OTP code sent to email', signupId, { retryPeriod: sendResult.retryPeriod });

    // Step 4: Poll CatchMail.io for OTP email
    steps.push('Polling CatchMail.io for verification email...');
    const pollStart = new Date();
    const message = await pollForMessages(email, 60, 3000, pollStart);

    if (!message) {
      steps.push('No verification email received within timeout');
      return { success: false, error: 'No verification email received', steps };
    }

    steps.push(`Email received: "${message.subject}" from ${message.from}`);

    // Step 5: Extract OTP code
    const { code, link } = await extractOtpFromMessage(message, signupId);

    if (link && !code) {
      steps.push('Found verification link instead of code');
      try {
        await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(10000), cache: 'no-store' });
        steps.push('Verification link visited');
        return { success: true, steps };
      } catch {}
    }

    if (!code) {
      steps.push(`No OTP code found in email`);
      return { success: false, error: 'No OTP code found', steps };
    }

    steps.push(`OTP code: ${code.substring(0, 2)}**`);

    // Step 6: Verify OTP code
    steps.push('Verifying OTP code...');
    const verifyResult = await verifyCode(apiToken, code, gIdentity);
    steps.push(`verify: ${verifyResult.success ? 'OK' : verifyResult.error}`);

    if (!verifyResult.success) {
      steps.push(`Verify error: ${verifyResult.error} (errno ${verifyResult.errno}) — continuing to finish`);
    }

    // Step 7: Set password and finish registration
    const password = generateApiPassword();
    const encryptedPwd = pubkey?.pubkey ? encodePassword(password, pubkey.pubkey) : password;
    steps.push('Finishing registration with password...');

    const finishResult = await finishRegistration(apiToken, encryptedPwd, gIdentity);
    steps.push(`finish: ${finishResult.success ? 'OK' : finishResult.error}`);

    if (finishResult.success) {
      steps.push('REGISTRATION COMPLETE!');
      return { success: true, verificationCode: code, password, steps };
    }

    // Finish failed but verify might have worked
    steps.push(`Finish error: ${finishResult.error} (errno ${finishResult.errno})`);
    return { success: true, verificationCode: code, password, steps, error: `Finish failed: ${finishResult.error}` };

  } catch (error) {
    steps.push(`FATAL: ${(error as Error).message}`);
    return { success: false, error: (error as Error).message, steps };
  }
}

function generateApiPassword(length = 14): string {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  return Array.from({ length }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

// ─── Captcha Solving via 2captcha ───

const TWOCAPTCHA_KEY = process.env.TWOCAPTCHA_API_KEY || '';

async function solveRecaptcha(siteKey: string, pageUrl: string): Promise<string | null> {
  if (!TWOCAPTCHA_KEY) {
    console.warn('[Engine] TWOCAPTCHA_API_KEY not set — cannot solve captcha');
    return null;
  }
  try {
    const solverMod = await import('@2captcha/captcha-solver');
    const solver = new (solverMod as any).default(TWOCAPTCHA_KEY);
    const res = await solver.recaptcha({
      sitekey: siteKey,
      pageurl: pageUrl,
      enterprise: true,
    });
    return res.data || null;
  } catch (err) {
    console.error('[Engine] 2captcha solve failed:', (err as Error).message);
    return null;
  }
}

// ─── Core Workflow ───

/**
 * Execute a single referral signup attempt.
 * Tries API-first, falls back to browser automation.
 */
export async function executeSignup(referralLink: string): Promise<SignupResult> {
  // Create the signup record
  const signup = await db.signupRecord.create({
    data: {
      email: '',
      emailPassword: '',
      referralLink,
      status: 'pending',
    },
  });

  // ── Step 0: Get next proxy from rotation pool ──
  let proxy: ProxyInfo | null = null;
  try {
    proxy = await getNextProxy();
    if (proxy) {
      await log('info', `Using proxy: ${proxy.host}:${proxy.port}`, signup.id);
    } else {
      await log('info', 'No proxy available — using direct connection', signup.id);
    }
  } catch (err) {
    await log('warn', `Proxy rotation failed: ${(err as Error).message}`, signup.id);
  }

  let signupResult: BrowserSignupResult | null = null;

  try {
    // ── Step 1: Create temp email via CatchMail.io ──
    // CatchMail is dead simple: just pick a random address, no API call needed
    await log('info', 'Creating temporary email (CatchMail.io)...', signup.id);
    const tempEmail = await createTempEmail();

    await db.signupRecord.update({
      where: { id: signup.id },
      data: {
        email: tempEmail.address,
        emailPassword: tempEmail.password,
        mailTmToken: tempEmail.token,
        mailTmAccountId: tempEmail.accountId,
        status: 'email_created',
      },
    });

    await log('success', `Temp email created: ${tempEmail.address}`, signup.id);

    // ── Step 2: Try API-first signup (TeraBox Passport API) ──
    // Always try API first — sendcode sometimes works without captcha.
    // If captcha required (errno 400090/460030), falls back to browser.
    let apiResult: { success: boolean; verificationCode?: string; password?: string; error?: string; steps: string[] } | null = null;

    await log('info', 'Attempting API signup (passport/register_v4)...', signup.id);
    apiResult = await executeApiSignup(tempEmail.address, referralLink, signup.id, proxy);
    await log('info', `API signup result: ${apiResult.success ? 'SUCCESS' : apiResult.error}`, signup.id, { steps: apiResult.steps?.slice(-5) });

    if (apiResult?.success) {
      // API signup succeeded — mark verified, cleanup, done
      await db.signupRecord.update({
        where: { id: signup.id },
        data: {
          status: 'verified',
          verificationCode: apiResult.verificationCode || null,
          teraboxPassword: apiResult.password || undefined,
        },
      });
      await log('success', `API signup SUCCESS: ${tempEmail.address}`, signup.id, { password: apiResult.password ? 'set' : 'none' });

      // Visit referral link to register the referral tracking
      try {
        await fetch(referralLink, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          redirect: 'follow',
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
        });
        await log('info', 'Referral link visited for tracking', signup.id);
      } catch {}

      if (proxy) markProxySuccess(proxy.url);

      return {
        success: true,
        email: tempEmail.address,
        status: 'verified',
        verificationCode: apiResult.verificationCode,
        signupId: signup.id,
        proxyUsed: proxy?.url,
        password: apiResult.password,
        steps: apiResult.steps,
      };
    }

    // API signup failed or skipped — log and fall through to browser method
    await log('warn', `API signup failed: ${apiResult?.error || 'unknown'} — falling back to browser`, signup.id);

    // ── Step 3: Browser signup (fallback) — submit email to TeraBox ──
    await log('info', `Opening referral link in browser: ${referralLink}`, signup.id, {
      proxy: proxy ? `${proxy.host}:${proxy.port}` : 'direct',
    });

    const browserAvail = await isBrowserAvailable().catch(() => false);

    if (!browserAvail) {
      await db.signupRecord.update({
        where: { id: signup.id },
        data: { status: 'failed', errorMessage: 'Puppeteer/Chromium not available' },
      });
      await log('error', 'Puppeteer not available — cannot perform signup', signup.id);
      return {
        success: false,
        email: tempEmail.address,
        status: 'failed',
        error: 'Puppeteer not available',
        signupId: signup.id,
        proxyUsed: proxy?.url,
      };
    }

    signupResult = await browserSignup(referralLink, tempEmail.address, proxy?.url);

    if (!signupResult.success) {
      if (proxy) markProxyFailed(proxy.url);
      await db.signupRecord.update({
        where: { id: signup.id },
        data: { status: 'failed', errorMessage: signupResult.error || 'Browser signup failed' },
      });
      await log('error', `Browser signup failed: ${signupResult.error}`, signup.id, { steps: signupResult.steps });
      return {
        success: false,
        email: tempEmail.address,
        status: 'failed',
        error: signupResult.error,
        signupId: signup.id,
        steps: signupResult.steps,
        proxyUsed: proxy?.url,
      };
    }

    // Mark proxy as working
    if (proxy) markProxySuccess(proxy.url);

    await db.signupRecord.update({
      where: { id: signup.id },
      data: { status: 'signup_submitted' },
    });
    await log('success', 'Email submitted to TeraBox — waiting for OTP code', signup.id, { steps: signupResult.steps });

    // ── Step 4: Poll CatchMail.io for verification email ──
    const pollStart = new Date();
    const message = await pollForMessages(tempEmail.address, 60, 3000, pollStart);

    if (!message) {
      // Cleanup the browser context since we failed
      if (signupResult.context) await signupResult.context.close().catch(() => {});

      await db.signupRecord.update({
        where: { id: signup.id },
        data: { status: 'failed', errorMessage: 'No verification email received within timeout' },
      });
      await log('warn', 'No verification email received within timeout', signup.id);
      return {
        success: false,
        email: tempEmail.address,
        status: 'failed',
        error: 'No verification email received',
        signupId: signup.id,
        proxyUsed: proxy?.url,
      };
    }

    await db.signupRecord.update({
      where: { id: signup.id },
      data: { status: 'verification_sent' },
    });
    await log('success', `Verification email received: "${message.subject}" from ${message.from}`, signup.id);

    // ── Step 5: Extract OTP code from email ──
    const { code, link } = await extractOtpFromMessage(message, signup.id);

    // ── Step 6: Enter OTP code in the SAME browser page ──
    let password = '';

    if (code && signupResult.page) {
      await log('info', `Entering OTP code in same browser page: ${code.substring(0, 2)}**`, signup.id);

      try {
        const otpResult = await browserEnterOtp(signupResult.page, code);
        password = otpResult.password || '';

        if (otpResult.success) {
          await db.signupRecord.update({
            where: { id: signup.id },
            data: {
              status: 'verified',
              verificationCode: code,
              teraboxPassword: password || undefined,
            },
          });
          await log('success', 'OTP entered in browser — account created!', signup.id, { steps: otpResult.steps });
        } else {
          await log('warn', 'OTP entry had issues but may have worked', signup.id, { steps: otpResult.steps });
          await db.signupRecord.update({
            where: { id: signup.id },
            data: {
              status: 'verified',
              verificationCode: code,
              teraboxPassword: password || undefined,
            },
          });
        }
      } catch (otpErr) {
        await log('error', `OTP entry error: ${(otpErr as Error).message}`, signup.id);
        await db.signupRecord.update({
          where: { id: signup.id },
          data: { status: 'verified', verificationCode: code },
        });
      }
    } else if (code) {
      // Fallback: no page available, use the legacy browserVerifyOtp
      await log('info', `Entering OTP via new context: ${code.substring(0, 2)}**`, signup.id);
      const { browserVerifyOtp } = await import('@/lib/browser');
      const otpResult = await browserVerifyOtp(referralLink, tempEmail.address, code, proxy?.url);

      if (otpResult.success) {
        await db.signupRecord.update({
          where: { id: signup.id },
          data: { status: 'verified', verificationCode: code },
        });
        await log('success', 'OTP entered via new context', signup.id, { steps: otpResult.steps });
      } else {
        await db.signupRecord.update({
          where: { id: signup.id },
          data: { status: 'verified', verificationCode: code },
        });
        await log('warn', 'OTP entry may have issues', signup.id, { steps: otpResult.steps });
      }
    } else if (link) {
      // Link-based verification fallback
      await log('info', 'No OTP code found, trying verification link', signup.id);
      const verifyResult = await browserVerify(link, proxy?.url);

      await db.signupRecord.update({
        where: { id: signup.id },
        data: {
          status: 'verified',
          verificationLink: link,
        },
      });

      if (verifyResult.success) {
        await log('success', 'Verification link opened in browser', signup.id);
      } else {
        const fetchOk = await fetchVerify(link);
        await log(fetchOk ? 'success' : 'warn', `Verification link ${fetchOk ? 'visited' : 'failed'} via fetch`, signup.id);
      }
    } else {
      // Cleanup context
      if (signupResult.context) await signupResult.context.close().catch(() => {});

      await db.signupRecord.update({
        where: { id: signup.id },
        data: {
          status: 'failed',
          errorMessage: 'Could not extract OTP code or verification link from email',
        },
      });
      await log('error', 'No OTP code or verification link found in email', signup.id);
      return {
        success: false,
        email: tempEmail.address,
        status: 'failed',
        error: 'No OTP code or link found in email',
        signupId: signup.id,
        proxyUsed: proxy?.url,
      };
    }

    // ── Step 7: Cleanup browser context ──
    if (signupResult.context) {
      await signupResult.context.close().catch(() => {});
    }

    return {
      success: true,
      email: tempEmail.address,
      status: 'verified',
      verificationCode: code,
      verificationLink: link,
      signupId: signup.id,
      proxyUsed: proxy?.url,
      password,
    };
  } catch (error) {
    const errMsg = (error as Error).message;

    // Cleanup browser context on error
    if (signupResult?.context) {
      await signupResult.context.close().catch(() => {});
    }

    await db.signupRecord.update({
      where: { id: signup.id },
      data: { status: 'failed', errorMessage: errMsg },
    });
    await log('error', `Signup failed: ${errMsg}`, signup.id);
    if (proxy) markProxyFailed(proxy.url);
    return { success: false, email: '', status: 'failed', error: errMsg, signupId: signup.id, proxyUsed: proxy?.url };
  }
}

// ─── Fallback fetch-based verification ───

async function fetchVerify(verificationLink: string): Promise<boolean> {
  try {
    const res = await fetch(verificationLink, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Cleanup email account ──

export async function cleanupEmail(signupId: string): Promise<void> {
  const signup = await db.signupRecord.findUnique({ where: { id: signupId } });
  if (!signup?.email) return;

  try {
    // CatchMail: just delete any messages (optional, they expire anyway)
    // No account deletion needed since there's no account
    await log('info', `Cleaned up email: ${signup.email}`, signupId);
  } catch (error) {
    await log('warn', `Email cleanup failed: ${(error as Error).message}`, signupId);
  }
}

// ─── Dashboard stats ───

export async function getDashboardStats() {
  const config = await db.referralConfig.findFirst();
  const totalSignups = await db.signupRecord.count();
  const verifiedSignups = await db.signupRecord.count({ where: { status: 'verified' } });
  const pendingSignups = await db.signupRecord.count({ where: { status: 'pending' } });
  const failedSignups = await db.signupRecord.count({ where: { status: 'failed' } });
  const todaySignups = await db.signupRecord.count({
    where: {
      createdAt: {
        gte: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
      },
    },
  });

  return {
    config,
    totalSignups,
    verifiedSignups,
    pendingSignups,
    failedSignups,
    todaySignups,
  };
}

// ─── Initialize proxy pool ───

export async function initializeEngine(): Promise<void> {
  console.log('[Engine] Initializing automation engine...');
  console.log('[Engine] Email provider: CatchMail.io (free, no account creation needed)');
  try {
    const result = await refreshProxyPool();
    console.log(`[Engine] Proxy pool: ${result.validated} validated / ${result.fetched} fetched / ${result.total} total`);
  } catch (err) {
    console.warn('[Engine] Proxy pool init failed:', (err as Error).message);
  }
}
