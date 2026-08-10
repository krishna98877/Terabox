import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/test-email — Test email creation + polling with CatchMail.io
 * Body: { "action": "create" | "poll" | "send-and-poll", "address"?: string }
 *
 * "create": Creates a random temp email and returns the address
 * "poll": Polls the given address for messages (5 attempts, 3s interval)
 * "send-and-poll": Creates email, waits 10s for any incoming messages (useful for manual testing)
 */
import {
  createTempEmail,
  listMessages,
  getMessage,
  pollForMessages,
  getDomains,
  extractVerificationCode,
  extractOtpFromHtml,
  htmlToPlainText,
} from '@/lib/catchmail';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'create';

    if (action === 'create') {
      const email = await createTempEmail();
      const domains = await getDomains();
      return NextResponse.json({
        success: true,
        email: email.address,
        domains,
        note: 'Email created — any emails sent to this address will be catchable via the API',
      });
    }

    if (action === 'poll') {
      const address = body.address;
      if (!address) {
        return NextResponse.json({ error: 'address required for poll' }, { status: 400 });
      }

      // Quick check - list messages
      const inbox = await listMessages(address);
      const summaries = inbox.messages.map(m => ({
        id: m.id,
        from: m.from,
        subject: m.subject,
        date: m.date,
      }));

      // If messages found, get the latest one's details
      let latestDetail = null;
      let otpResult = null;
      if (inbox.messages.length > 0) {
        const latest = inbox.messages[inbox.messages.length - 1];
        latestDetail = await getMessage(latest.id, address);

        const text = latestDetail.body?.text || htmlToPlainText(latestDetail.body?.html || '');
        const html = latestDetail.body?.html || '';
        otpResult = {
          code: extractOtpFromHtml(html) || extractVerificationCode(text),
          from: latestDetail.from,
          subject: latestDetail.subject,
          textPreview: text.substring(0, 500),
        };
      }

      return NextResponse.json({
        success: true,
        address,
        totalMessages: inbox.count,
        messages: summaries,
        latest: latestDetail ? {
          subject: latestDetail.subject,
          from: latestDetail.from,
          date: latestDetail.date,
          textPreview: (latestDetail.body?.text || '').substring(0, 300),
          htmlPreview: (latestDetail.body?.html || '').substring(0, 300),
        } : null,
        otp: otpResult,
      });
    }

    if (action === 'send-and-poll') {
      const address = body.address;
      if (!address) {
        // Create a new email
        const email = await createTempEmail();
        return NextResponse.json({
          success: true,
          email: email.address,
          instruction: 'Send an email to this address, then call /api/test-email with action=poll&address=...',
        });
      }

      // Poll with full timeout (like the engine does)
      const pollStart = new Date();
      const message = await pollForMessages(address, 30, 3000, pollStart);

      if (!message) {
        return NextResponse.json({
          success: false,
          address,
          error: 'No messages received within timeout',
        });
      }

      const text = message.body?.text || htmlToPlainText(message.body?.html || '');
      const html = message.body?.html || '';
      const code = extractOtpFromHtml(html) || extractVerificationCode(text);

      return NextResponse.json({
        success: true,
        address,
        message: {
          id: message.id,
          from: message.from,
          subject: message.subject,
          date: message.date,
          textPreview: text.substring(0, 1000),
        },
        otp: code,
        rawBodyKeys: Object.keys(message),
      });
    }

    return NextResponse.json({ error: 'Unknown action. Use: create, poll, send-and-poll' }, { status: 400 });
  } catch (error) {
    console.error('[API /test-email] Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// GET for quick testing
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const address = url.searchParams.get('address');

    if (address) {
      // Quick poll
      const inbox = await listMessages(address);
      return NextResponse.json({
        address,
        count: inbox.count,
        messages: inbox.messages.map(m => ({
          id: m.id,
          from: m.from,
          subject: m.subject,
          date: m.date,
        })),
      });
    }

    // Default: create email
    const email = await createTempEmail();
    const domains = await getDomains();
    return NextResponse.json({
      email: email.address,
      domains,
      hint: 'Add ?address=test@catchmail.io to poll a specific inbox',
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
