import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Test email endpoint — verifies CatchMail.io works end-to-end.
 * GET /api/test-email — creates a temp email and checks inbox
 * POST /api/test-email — polls a specific address for messages
 */
import { createTempEmail, listMessages, getMessage, pollForMessages } from '@/lib/catchmail';

export async function GET() {
  try {
    // Step 1: Create a temp email
    const tempEmail = await createTempEmail();

    // Step 2: Check the inbox (should be empty for new address)
    const inbox = await listMessages(tempEmail.address);

    // Step 3: Test that we can reach the API
    const apiTest = await fetch('https://api.catchmail.io/api/v1/mailbox?address=test@catchmail.io', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });

    return NextResponse.json({
      success: true,
      provider: 'CatchMail.io',
      tempEmail: {
        address: tempEmail.address,
        accountId: tempEmail.accountId,
      },
      inbox: {
        address: inbox.address,
        messageCount: inbox.count,
        messages: inbox.messages.slice(0, 5),
      },
      apiConnectivity: {
        status: apiTest.status,
        ok: apiTest.ok,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const address = body.address as string;
    const maxAttempts = (body.maxAttempts as number) || 10;
    const sinceDate = body.sinceDate ? new Date(body.sinceDate as string) : new Date(Date.now() - 300000);

    if (!address) {
      return NextResponse.json({ error: 'address is required' }, { status: 400 });
    }

    // Poll for messages
    const message = await pollForMessages(address, maxAttempts, 3000, sinceDate);

    if (!message) {
      return NextResponse.json({
        success: false,
        address,
        message: 'No messages found within timeout',
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      address,
      message: {
        id: message.id,
        from: message.from,
        subject: message.subject,
        date: message.date,
        bodyPreview: (message.body?.text || '').substring(0, 500),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
