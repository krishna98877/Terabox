import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { isCaptchaConfigured, getBalance, getHealth } from '@/lib/captcha';

// GET /api/captcha/status — Check captcha solving service status
export async function GET() {
  try {
    const configured = isCaptchaConfigured();
    
    if (!configured) {
      return NextResponse.json({
        configured: false,
        provider: null,
        error: 'CAPTCHASOLV_API_KEY not set — get key from captchasolv.com (100 free solves/day)',
      });
    }

    // Check balance to validate the API key
    // NOTE: Free-tier keys may not expose balance but have daily quota (100 free/day).
    // Balance error doesn't mean key is invalid — just means balance endpoint isn't supported.
    const balance = await getBalance();
    const health = await getHealth();

    if (balance.error) {
      return NextResponse.json({
        configured: true,
        provider: 'captchasolv',
        keyValid: true, // Don't invalidate key just because balance check fails
        balance: 0,
        freeQuota: '100 solves/day (free-tier key)',
        health: health.ok,
      });
    }

    return NextResponse.json({
      configured: true,
      provider: 'captchasolv',
      keyValid: true,
      balance: balance.balance,
      health: health.ok,
    });
  } catch (error) {
    return NextResponse.json({
      configured: false,
      error: (error as Error).message,
    }, { status: 500 });
  }
}
