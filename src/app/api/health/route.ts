import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { isPoolActive, getWorkerStates, getMaxWorkers } from '@/lib/automation/scheduler';
import { isBrowserAvailable, getBrowserStatus } from '@/lib/browser';
import { getProxyStatus } from '@/lib/proxy';
import { getKeepAliveStatus } from '@/lib/keepalive';

/**
 * Health check endpoint — reports full system status.
 * Also pinged by the self-keep-alive system every 4 minutes.
 */
export async function GET() {
  try {
    const config = await db.referralConfig.findFirst();
    const totalSignups = await db.signupRecord.count();
    const poolActive = isPoolActive();
    const browserAvail = await isBrowserAvailable().catch(() => false);
    const browserStatus = getBrowserStatus();
    const proxyStatus = getProxyStatus();
    const keepAliveStatus = getKeepAliveStatus();

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
      keepAlive: {
        isRunning: keepAliveStatus.isRunning,
        lastPingAt: keepAliveStatus.lastPingAt,
        lastPingStatus: keepAliveStatus.lastPingStatus,
        totalPings: keepAliveStatus.totalPings,
        successRate: keepAliveStatus.successRate,
        uptime: keepAliveStatus.uptime,
        consecutiveFailures: keepAliveStatus.consecutiveFailures,
      },
      config: {
        masterLink: config?.masterLink ? 'configured' : 'not set',
        isActive: config?.isActive ?? false,
        autoSignup: config?.autoSignup ?? false,
        maxSignupsPerDay: config?.maxSignupsPerDay ?? 50,
      },
      email: {
        provider: 'CatchMail.io',
        domain: 'catchmail.io',
        requiresAuth: false,
        requiresAccountCreation: false,
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
