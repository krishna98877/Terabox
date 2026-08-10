import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

import { createTempEmail, pollForMessages, listMessages, getDomains } from '@/lib/catchmail';
import { extractVerificationCode, extractOtpFromHtml, extractVerificationLink, htmlToPlainText } from '@/lib/catchmail';
import { is2CaptchaConfigured, getBalance } from '@/lib/captcha';

/**
 * Test Email + Captcha endpoint — for debugging email and captcha integration.
 *
 * GET /api/test-email?action=create     — Create a temp email
 * GET /api/test-email?action=check&email=xxx  — Check inbox for messages
 * GET /api/test-email?action=domains    — List available domains
 * GET /api/test-email?action=captcha    — Check 2captcha status + balance
 * GET /api/test-email?action=full       — Full flow: create email, wait 30s, check inbox
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'status';

  try {
    switch (action) {
      // ── Create temp email ──
      case 'create': {
        const email = await createTempEmail();
        return NextResponse.json({
          action: 'create',
          success: true,
          email: email.address,
          accountId: email.accountId,
          note: 'Email is implicitly created. Just start sending to it.',
          timestamp: new Date().toISOString(),
        });
      }

      // ── Check inbox ──
      case 'check': {
        const email = searchParams.get('email');
        if (!email) {
          return NextResponse.json({ error: 'Missing ?email= parameter' }, { status: 400 });
        }

        const inbox = await listMessages(email);
        const details = [];

        // Get full content of up to 3 most recent messages
        for (const msg of inbox.messages.slice(0, 3)) {
          try {
            const { getMessage } = await import('@/lib/catchmail');
            const detail = await getMessage(msg.id, email);
            const textBody = detail.body?.text || '';
            const htmlBody = detail.body?.html || '';
            const fullText = textBody || htmlToPlainText(htmlBody);

            details.push({
              id: msg.id,
              from: msg.from,
              subject: msg.subject,
              date: msg.date,
              textPreview: fullText.substring(0, 500),
              otpCode: extractVerificationCode(fullText),
              otpFromHtml: htmlBody ? extractOtpFromHtml(htmlBody) : null,
              verificationLink: extractVerificationLink(htmlBody, fullText),
            });
          } catch (err) {
            details.push({ id: msg.id, error: (err as Error).message });
          }
        }

        return NextResponse.json({
          action: 'check',
          email,
          totalMessages: inbox.count,
          messages: inbox.messages.slice(0, 10),
          details,
          timestamp: new Date().toISOString(),
        });
      }

      // ── List domains ──
      case 'domains': {
        const domains = await getDomains();
        return NextResponse.json({
          action: 'domains',
          domains,
          note: 'CatchMail.io requires no account creation. Just use any address @catchmail.io',
          timestamp: new Date().toISOString(),
        });
      }

      // ── Captcha status ──
      case 'captcha': {
        const configured = is2CaptchaConfigured();
        let balance: { balance: number; error?: string } | null = null;
        if (configured) {
          balance = await getBalance();
        }

        return NextResponse.json({
          action: 'captcha',
          provider: '2captcha',
          configured,
          apiKeySet: configured ? 'yes' : 'no (set CAPTCHASOLV_API_KEY env var)',
          balance: balance?.balance,
          balanceError: balance?.error,
          supportedTypes: ['reCAPTCHA v2', 'reCAPTCHA v3', 'Cloudflare Turnstile', 'Image CAPTCHA'],
          pricing: {
            recaptchaV2: '$1-2.99/1000',
            recaptchaV3: '$1.45-2.99/1000',
            turnstile: '$1.45/1000',
            imageCaptcha: '$0.50-1.00/1000',
          },
          timestamp: new Date().toISOString(),
        });
      }

      // ── Full test flow ──
      case 'full': {
        const results: Record<string, unknown> = {};

        // Step 1: Create email
        const email = await createTempEmail();
        results.email = email.address;
        results.step1 = 'Email created';

        // Step 2: Check inbox (should be empty)
        const inbox = await listMessages(email.address);
        results.initialMessages = inbox.count;

        // Step 3: Wait and check for any messages
        results.step2 = 'Waiting 15s then checking inbox...';
        await new Promise(r => setTimeout(r, 15000));

        const inbox2 = await listMessages(email.address);
        results.afterWait = inbox2.count;
        results.messages = inbox2.messages;

        // Step 4: Check captcha
        results.captcha = {
          configured: is2CaptchaConfigured(),
        };

        return NextResponse.json({
          action: 'full',
          success: true,
          ...results,
          timestamp: new Date().toISOString(),
        });
      }

      // ── Status (default) ──
      default: {
        return NextResponse.json({
          action: 'status',
          emailProvider: 'CatchMail.io',
          emailProviderUrl: 'https://catchmail.io',
          captchaProvider: '2captcha',
          captchaConfigured: is2CaptchaConfigured(),
          endpoints: {
            create: '/api/test-email?action=create',
            check: '/api/test-email?action=check&email=YOUR_EMAIL',
            domains: '/api/test-email?action=domains',
            captcha: '/api/test-email?action=captcha',
            full: '/api/test-email?action=full',
          },
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch (error) {
    return NextResponse.json({
      error: (error as Error).message,
      stack: (error as Error).stack?.substring(0, 500),
    }, { status: 500 });
  }
}
