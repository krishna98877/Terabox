import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { isPoolActive, startPool } from '@/lib/automation/scheduler';
import { initializeEngine } from '@/lib/automation/engine';

/**
 * Initialization endpoint — called on server start or by keep-alive cron.
 * Ensures default config exists. Auto-starts engine if configured.
 * Initializes proxy pool.
 */
export async function GET() {
  try {
    // Ensure default config exists
    let config = await db.referralConfig.findFirst();
    if (!config) {
      config = await db.referralConfig.create({
        data: {
          masterLink: '',
          isActive: true,
          autoSignup: false,
          signupInterval: 30,
          maxSignupsPerDay: 50,
        },
      });
    }

    // Initialize proxy pool in background
    initializeEngine().catch(err => {
      console.warn('[Init] Proxy pool init failed:', err.message);
    });

    // Auto-start engine if configured
    if (config.autoSignup && config.masterLink && !isPoolActive()) {
      // Don't await — let it start in background
      startPool().catch(err => {
        console.warn('[Init] Auto-start failed:', err.message);
      });
    }

    return NextResponse.json({
      initialized: true,
      engineRunning: isPoolActive(),
      config: {
        masterLink: config.masterLink ? 'configured' : 'not set',
        autoSignup: config.autoSignup,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST also triggers init (for cron calls)
export async function POST() {
  return GET();
}
