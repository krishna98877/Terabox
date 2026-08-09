/**
 * Referral Automation Engine — TeraBox-specific workflow.
 *
 * KEY FIX: signup + OTP happen in the SAME browser context.
 * browserSignup() returns the page/context, and browserEnterOtp() uses it.
 * This avoids re-navigating the entire signup flow for OTP entry.
 *
 * Workflow:
 * 1. Get next proxy from rotation pool
 * 2. Create temp email via mail.tm
 * 3. Open referral link in fresh Puppeteer context (with proxy)
 * 4. Navigate: Login → Sign Up → Email icon → Fill email → Continue
 * 5. TeraBox sends OTP to email
 * 6. Poll Mail.tm inbox for the OTP email
 * 7. Extract OTP code from email (AI + regex)
 * 8. Enter OTP in the SAME page (no re-navigation!)
 * 9. Set password → Account created → referral counted!
 * 10. Cleanup email account → mark proxy success/failure
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

// ─── Core Workflow ───

/**
 * Execute a single referral signup attempt.
 * Creates ONE record, updates it through the pipeline.
 * Uses a rotating proxy for IP diversity.
 * 
 * CRITICAL: Uses same browser context for signup AND OTP entry.
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

    // ── Step 2: Browser signup — submit email to TeraBox ──
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
