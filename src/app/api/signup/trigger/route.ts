import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { executeSignup } from '@/lib/automation';
import { db } from '@/lib/db';

// POST /api/signup/trigger — Manually trigger a single signup attempt
// The engine creates its own record internally — no duplicate here.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const referralLink = body.referralLink as string | undefined;

    // Use provided link or fall back to master config
    let link = referralLink;
    if (!link) {
      const config = await db.referralConfig.findFirst();
      link = config?.masterLink;
    }

    if (!link) {
      return NextResponse.json(
        { error: 'No referral link provided and no master link configured' },
        { status: 400 }
      );
    }

    // Execute signup in background (fire-and-forget)
    // The engine creates the record internally — no duplicate
    executeSignup(link).catch(async (err) => {
      console.error('[Signup Trigger] Background error:', err.message);
    });

    return NextResponse.json({
      success: true,
      message: 'Signup started in background. Check the History tab for progress.',
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
