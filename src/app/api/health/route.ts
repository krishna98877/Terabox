import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
import { db } from '@/lib/db';
import { isPoolActive, getWorkerStates, getMaxWorkers } from '@/lib/automation/scheduler';
import { isBrowserAvailable, getBrowserStatus } from '@/lib/browser';
import { getProxyStatus } from '@/lib/proxy';
import { getKeepAliveStatus } from '@/lib/keepalive';
import { isCaptchaConfigured, getBalance, getActiveProvider, getHealth, getSupportedTypes } from '@/lib/captcha';

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
    const captchaConfigured = isCaptchaConfigured();
    const captchaProvider = getActiveProvider();
    let captchaBalance: { balance: number; error?: string; provider?: string } | null = null;
    if (captchaConfigured) {
      captchaBalance = await getBalance().catch(() => ({ balance: 0, error: 'fetch failed' }));
    }

    // Check CaptchaSolv API health
    let captchaSolvHealth: { ok: boolean; service?: string; error?: string } | null = null;
    try {
      captchaSolvHealth = await getHealth();
    } catch {
      captchaSolvHealth = null;
    }

    // Get supported types
    let supportedCaptchaTypes: string[] = [];
    try {
      supportedCaptchaTypes = await getSupportedTypes();
    } catch {
      // ignore
    }

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
      captcha: {
        configured: captchaConfigured,
        activeProvider: captchaProvider,
        captchasolv: {
          configured: !!process.env.CAPTCHASOLV_API_KEY,
          freeSolvesPerDay: 100,
          apiHealth: captchaSolvHealth,
          baseUrl: 'https://v1.captchasolv.com',
          docs: 'https://docs.captchasolv.com/',
          supportedTypes: supportedCaptchaTypes.length > 0 ? supportedCaptchaTypes : [
            'RecaptchaV2TaskProxyless',
            'RecaptchaV2InvisibleTaskProxyless',
            'RecaptchaV3TaskProxyless',
            'TurnstileTaskProxyless',
            'HCaptchaTaskProxyless',
            'GeeTestV4TaskProxyless',
          ],
          solveTimes: {
            recaptchaV2: '7-40s',
            recaptchaV3: '3-5s',
            turnstile: '4-7s',
            hCaptcha: '5-10s',
            geeTest: '4-8s',
          },
        },
        balance: captchaBalance?.balance,
        balanceProvider: captchaBalance?.provider,
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
