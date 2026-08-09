import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { getSmartSuggestions, isGroqConfigured } from '@/lib/groq';
import { db } from '@/lib/db';

// POST /api/ai/suggest — Get AI-powered optimization suggestions
export async function POST() {
  try {
    if (!isGroqConfigured()) {
      return NextResponse.json({ error: 'Groq API key not configured' }, { status: 400 });
    }

    const config = await db.referralConfig.findFirst();
    const totalSignups = await db.signupRecord.count();
    const verifiedSignups = await db.signupRecord.count({ where: { status: 'verified' } });
    const failedSignups = await db.signupRecord.count({ where: { status: 'failed' } });
    const todaySignups = await db.signupRecord.count({
      where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() } },
    });

    const suggestion = await getSmartSuggestions({
      totalSignups,
      verifiedSignups,
      failedSignups,
      todaySignups,
      interval: config?.signupInterval || 30,
      maxPerDay: config?.maxSignupsPerDay || 50,
    });

    return NextResponse.json({ suggestion });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
