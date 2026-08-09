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
  // Only run on the server (not in edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Server starting — initializing keep-alive system...');

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

    // Also initialize the engine in background
    try {
      const { initializeEngine } = await import('@/lib/automation/engine');
      initializeEngine().catch(err => {
        console.warn('[Instrumentation] Engine init failed:', (err as Error).message);
      });
    } catch (err) {
      console.warn('[Instrumentation] Engine module not available:', (err as Error).message);
    }

    console.log('[Instrumentation] Server ready — 24/7 self-sustaining mode active');
  }
}
