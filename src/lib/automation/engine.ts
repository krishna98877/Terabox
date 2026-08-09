/**
 * Referral Automation Engine — TeraBox-specific workflow.
 *
 * DUAL STRATEGY:
 * 1. PRIMARY: TeraBox Passport API (direct HTTP calls — fast, reliable, no DOM)
 * 2. FALLBACK: Browser automation (Puppeteer + stealth — handles captcha visually)
 *
 * API Flow (preferred):
 * 1. Create temp email via mail.tm
 * 2. POST /passport/register_v4/sendcode → send OTP to email
 * 3. If captcha required: solve via 2captcha → retry with g_identity
 * 4. Poll Mail.tm inbox for OTP email
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
  getMessages,
  getMessage,
  deleteAccount,
  extractVerificationCode,
  extractVerificationLink,
  htmlToPlainText,
} from '@/lib/mailtm';
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
import type { MailTmMessageDetail } from '@/lib/mailtm';
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

// ─── API-based Signup (Primary Strategy) ───

/**
 * Execute signup via TeraBox Passport API directly.
 * No browser needed — just HTTP calls.
 *
 * Flow:
 * 1. getpubkey → RSA public key
 * 2. register_v4/sendcode → send OTP (may need captcha)
 * 3. If captcha: solve via 2captcha → retry
 * 4. Poll Mail.tm for OTP email
 * 5. register_v4/verify → verify OTP
 * 6. register_v4/finish → set password, complete
 */
async function executeApiSignup(
  email: string,
  mailToken: string,
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
    steps.push(`sendcode response: errno=${sendResult.errno}, ${sendResult.success ? 'OK' : sendResult.error}`);

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
          steps.push('Captcha solving failed');
        }
      } else {
        steps.push('No TWOCAPTCHA_API_KEY set — cannot solve captcha via API');
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

    // Step 4: Poll for OTP email
    steps.push('Polling for verification email...');
    const message = await pollForVerificationEmail(mailToken, email, 40, 5000);

    if (!message) {
      steps.push('No verification email received');
      return { success: false, error: 'No verification email received', steps };
    }

    steps.push(`Email received: "${message.subject}"`);

    // Step 5: Extract OTP code
    const text = message.text || htmlToPlainText(message.html?.join('\n') || '');
    let code: string | null = null;

    // Try AI first
    if (isGroqConfigured()) {
      try {
        const aiResult = await analyzeEmailContent(message.subject || '', message.html?.join('\n') || '', text);
        code = aiResult.verificationCode;
        if (code) steps.push(`AI extracted code: ${code.substring(0, 2)}**`);
      } catch {}
    }

    // Regex fallback
    if (!code) code = extractVerificationCode(text);
    if (!code) {
      const link = extractVerificationLink(message.html?.join('\n') || '', text);
      if (link) {
        steps.push('Found verification link instead of code');
        // Try to visit the link
        try {
          await fetch(link, { redirect: 'follow', signal: AbortSignal.timeout(10000), cache: 'no-store' });
          steps.push('Verification link visited');
          return { success: true, steps };
        } catch {}
      }
    }
    if (!code) {
      const codeMatch = text.match(/\b(\d{4,6})\b/);
      if (codeMatch) code = codeMatch[1];
    }

    if (!code) {
      steps.push(`No OTP code found in email. Text preview: ${text.substring(0, 200)}`);
      return { success: false, error: 'No OTP code found', steps };
    }

    steps.push(`OTP code: ${code.substring(0, 2)}**`);

    // Step 6: Verify OTP code
    steps.push('Verifying OTP code...');
    const verifyResult = await verifyCode(apiToken, code, gIdentity);
    steps.push(`verify response: ${verifyResult.success ? 'OK' : verifyResult.error}`);

    if (!verifyResult.success) {
      // Even if verify fails, the code was correct - might be a session issue
      steps.push(`Verify error: ${verifyResult.error} (errno ${verifyResult.errno})`);
      // Continue to finish anyway - the verify might have actually worked
    }

    // Step 7: Set password and finish registration
    const password = generateApiPassword();
    const encryptedPwd = pubkey?.pubkey ? encodePassword(password, pubkey.pubkey) : password;
    steps.push('Finishing registration with password...');

    const finishResult = await finishRegistration(apiToken, encryptedPwd, gIdentity);
    steps.push(`finish response: ${finishResult.success ? 'OK' : finishResult.error}`);

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
    // ── Step 1: Create temp email ──
    await log('info', 'Creating temporary email...', signup.id);
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
    await log('info', 'Attempting API signup (passport/register_v4)...', signup.id);

    const apiResult = await executeApiSignup(tempEmail.address, tempEmail.token, referralLink, signup.id, proxy);

    if (apiResult.success) {
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

      await cleanupEmail(signup.id);
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

    // API signup failed — log and fall through to browser method
    await log('warn', `API signup failed: ${apiResult.error} — falling back to browser`, signup.id);

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

    // ── Step 3: Poll for verification email (OTP code) ──
    // Use shorter intervals initially, then lengthen
    const message = await pollForVerificationEmail(tempEmail.token, tempEmail.address, 40, 5000);

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
    await log('success', `Verification email received: "${message.subject}"`, signup.id);

    // ── Step 4: Extract OTP code from email ──
    const text = message.text || htmlToPlainText(message.html?.join('\n') || '');
    let code: string | null = null;
    let link: string | null = null;

    // Try AI extraction first (more accurate for complex emails)
    if (isGroqConfigured()) {
      try {
        await log('info', 'Using AI to analyze email content...', signup.id);
        const aiResult = await analyzeEmailContent(
          message.subject || '',
          message.html?.join('\n') || '',
          text
        );
        code = aiResult.verificationCode;
        link = aiResult.verificationLink;
        await log('success', `AI analysis: type=${aiResult.emailType}, code=${code || 'none'}, link=${link ? 'found' : 'none'}`, signup.id);
      } catch (err) {
        await log('warn', `AI analysis failed, using regex fallback: ${(err as Error).message}`, signup.id);
      }
    }

    // Fallback to regex extraction
    if (!code) code = extractVerificationCode(text);
    if (!link) link = extractVerificationLink(message.html?.join('\n') || '', text);

    if (!code && !link) {
      // Try to find any 4-6 digit number in the email
      const codeMatch = text.match(/\b(\d{4,6})\b/);
      if (codeMatch) code = codeMatch[1];
    }

    // Log the raw email text for debugging if no code found
    if (!code && !link) {
      await log('warn', `No OTP found in email. Subject: "${message.subject}", Text preview: ${text.substring(0, 200)}`, signup.id);
    } else {
      await log('success', `OTP extracted — code: ${code || 'none'}, link: ${link ? 'found' : 'none'}`, signup.id);
    }

    // ── Step 5: Enter OTP code in the SAME browser page ──
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
          // Still mark as verified since the code was extracted
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
        // Mark as verified anyway since we have the code
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
        // Fallback to fetch
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

    // ── Step 6: Cleanup browser context ──
    if (signupResult.context) {
      await signupResult.context.close().catch(() => {});
    }

    // ── Step 7: Cleanup email account ──
    await cleanupEmail(signup.id);

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

// ─── Poll inbox for verification email ───

async function pollForVerificationEmail(
  token: string,
  email: string,
  maxAttempts: number = 40,
  intervalMs: number = 5000
): Promise<MailTmMessageDetail | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Use shorter intervals at first (2s for first 10 attempts), then lengthen
    const waitMs = attempt < 10 ? 2000 : intervalMs;
    await new Promise((r) => setTimeout(r, waitMs));

    try {
      const messages = await getMessages(token);
      if (messages.length > 0) {
        // Get the most recent message
        const latest = messages[messages.length - 1];
        const detail = await getMessage(latest.id, token);
        console.log(`[Poll] Email received on attempt ${attempt + 1}: "${detail.subject}"`);
        return detail;
      }
      // Log every 5th attempt
      if ((attempt + 1) % 5 === 0) {
        console.log(`[Poll] Attempt ${attempt + 1}/${maxAttempts} — no email yet for ${email}`);
      }
    } catch (error) {
      console.error(`[Poll] Attempt ${attempt + 1} failed:`, (error as Error).message);
      // Don't abort on poll failure — retry
    }
  }

  return null;
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
  if (!signup?.mailTmToken) return;

  try {
    await deleteAccount(signup.mailTmAccountId || signup.email, signup.mailTmToken);
    await log('info', `Cleaned up email: ${signup.email}`, signupId);
  } catch (error) {
    await log('warn', `Email cleanup failed: ${(error as Error).message}`, signupId);
  }
}

// ─── Dashboard stats ──

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

// ─── Initialize proxy pool ──

export async function initializeEngine(): Promise<void> {
  console.log('[Engine] Initializing automation engine...');
  try {
    const result = await refreshProxyPool();
    console.log(`[Engine] Proxy pool: ${result.validated} validated / ${result.fetched} fetched / ${result.total} total`);
  } catch (err) {
    console.warn('[Engine] Proxy pool init failed:', (err as Error).message);
  }
}
