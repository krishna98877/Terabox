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
    const balance = await getBalance();
    const health = await getHealth();

    if (balance.error) {
      return NextResponse.json({
        configured: true,
        provider: 'captchasolv',
        keyValid: false,
        balance: 0,
        error: `API key invalid or expired: ${balance.error}`,
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
