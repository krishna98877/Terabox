/**
 * Next.js Instrumentation Hook
 *
 * Runs ONCE on server startup (both `next start` and `next dev`).
 * This is the bootstrap point for the self-ping keep-alive system.
 *
 * Flow:
 * 1. Server boots → this file executes
 * 2. startKeepAlive() begins the 4-minute self-ping loop
 * 3. The first ping hits /api/health + /api/init
 * 4. /api/init ensures engine is running if configured
 * 5. Server stays awake forever via self-sustaining ping loop
 *
 * External bootstrap (UptimeRobot / cron-job.org) provides the initial wake-up
 * if the server has been cold for >15 min. After that, self-ping takes over.
 */

export async function register() {
  // Only run on the Node.js server runtime (not edge, not client)
  // Use flexible check — some environments may not set NEXT_RUNTIME
  const runtime = process.env.NEXT_RUNTIME;
  const isNodeServer = !runtime || runtime === 'nodejs';

  if (isNodeServer) {
    console.log('[Instrumentation] Server starting — initializing keep-alive + engine...');

    // Start keep-alive self-ping (prevents Render sleep)
    try {
      const { startKeepAlive } = await import('@/lib/keepalive');
      const result = startKeepAlive();

      if (result.started) {
        console.log(`[Instrumentation] ${result.message}`);
        console.log(`[Instrumentation] Self-ping target: ${result.baseUrl}`);
      } else {
        console.log(`[Instrumentation] Keep-alive: ${result.message}`);
      }
    } catch (err) {
      console.warn('[Instrumentation] Keep-alive setup failed:', (err as Error).message);
      console.warn('[Instrumentation] Server will work but may sleep after 15 min inactivity');
    }

    // Initialize proxy pool in background
    try {
      const { initializeEngine } = await import('@/lib/automation/engine');
      initializeEngine().catch(err => {
        console.warn('[Instrumentation] Engine init failed:', (err as Error).message);
      });
    } catch (err) {
      console.warn('[Instrumentation] Engine module not available:', (err as Error).message);
    }

    // Auto-start engine if config has autoSignup=true + masterLink
    try {
      const { db } = await import('@/lib/db');
      const { isPoolActive, startPool } = await import('@/lib/automation/scheduler');

      // Wait a moment for DB to be ready
      setTimeout(async () => {
        try {
          const config = await db.referralConfig.findFirst();
          if (config?.autoSignup && config.masterLink && !isPoolActive()) {
            console.log('[Instrumentation] Auto-starting engine (autoSignup=true)...');
            const result = await startPool();
            console.log(`[Instrumentation] Engine: ${result.message}`);
          }
        } catch (err) {
          console.warn('[Instrumentation] Auto-start check failed:', (err as Error).message);
        }
      }, 3000);
    } catch (err) {
      console.warn('[Instrumentation] Auto-start module not available:', (err as Error).message);
    }

    console.log('[Instrumentation] Server ready — 24/7 self-sustaining mode active');
  }
}
