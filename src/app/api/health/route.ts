import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { isPoolActive, getWorkerStates, getMaxWorkers } from '@/lib/automation/scheduler';
import { isBrowserAvailable, getBrowserStatus } from '@/lib/browser';
import { getProxyStatus } from '@/lib/proxy';

/**
 * Health check endpoint — reports system status, pool state, browser, proxy.
 */
export async function GET() {
  try {
    const config = await db.referralConfig.findFirst();
    const totalSignups = await db.signupRecord.count();
    const poolActive = isPoolActive();
    const browserAvail = await isBrowserAvailable().catch(() => false);
    const browserStatus = getBrowserStatus();
    const proxyStatus = getProxyStatus();

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      engine: {
        type: 'continuous-parallel-loop',
        workers: getMaxWorkers(),
        running: poolActive,
        workerStates: getWorkerStates().map(w => ({
          id: w.id,
          status: w.status,
          step: w.currentStep,
          proxy: w.currentProxy,
          successes: w.successes,
          failures: w.failures,
        })),
      },
      browser: {
        available: browserAvail,
        connected: browserStatus.connected,
        proxy: browserStatus.proxy,
        strategy: browserStatus.strategy,
      },
      proxy: {
        poolSize: proxyStatus.poolSize,
        lastRefresh: proxyStatus.lastRefresh,
        isRefreshing: proxyStatus.isRefreshing,
      },
      config: {
        masterLink: config?.masterLink ? 'configured' : 'not set',
        isActive: config?.isActive ?? false,
        autoSignup: config?.autoSignup ?? false,
        maxSignupsPerDay: config?.maxSignupsPerDay ?? 50,
      },
      stats: {
        totalSignups,
      },
    });
  } catch (error) {
    return NextResponse.json({
      status: 'error',
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}
