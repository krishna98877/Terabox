/**
 * Self-Ping Keep-Alive System
 *
 * Prevents Render free tier from sleeping by pinging own /api/health every 4 minutes.
 * Once bootstrapped by an external ping (UptimeRobot), the server self-sustains indefinitely.
 *
 * Architecture:
 * - Server boots → instrumentation.ts → startKeepAlive()
 * - setInterval every 4 min → fetch own /api/health + /api/init
 * - If engine not running, /api/init auto-starts it
 * - Tracks ping history, success rate, last ping time
 * - Unref'd interval so it doesn't block process exit
 */

const DEFAULT_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes (Render sleeps after 15 min)
const HEALTH_CHECK_PATH = '/api/health';
const INIT_PATH = '/api/init';
const PING_HISTORY_SIZE = 50;

// ─── State ───

let pingInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;
let baseUrl = '';
let lastPingAt: string | null = null;
let lastPingStatus: 'success' | 'failure' | null = null;
let consecutiveFailures = 0;
let totalPings = 0;
let successfulPings = 0;
let startedAt: string | null = null;

interface PingRecord {
  timestamp: string;
  success: boolean;
  latencyMs: number;
  statusCode?: number;
  error?: string;
}

const pingHistory: PingRecord[] = [];

// ─── Detect Base URL ───

function detectBaseUrl(): string {
  // Priority: RENDER_EXTERNAL_URL env > NEXT_PUBLIC_BASE_URL env > hardcoded Render URL
  if (process.env.RENDER_EXTERNAL_URL) return process.env.RENDER_EXTERNAL_URL;
  if (process.env.NEXT_PUBLIC_BASE_URL) return process.env.NEXT_PUBLIC_BASE_URL;

  // Hardcoded known Render URL
  return 'https://terabox-detf.onrender.com';
}

// ─── Single Ping ───

async function performPing(path: string, _label: string): Promise<{ ok: boolean; latencyMs: number; statusCode?: number; error?: string }> {
  const url = `${baseUrl}${path}`;
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'TeraBox-KeepAlive/1.0',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000), // 15s timeout
      cache: 'no-store',
    });

    const latencyMs = Date.now() - start;

    if (response.ok) {
      return { ok: true, latencyMs, statusCode: response.status };
    } else {
      return { ok: false, latencyMs, statusCode: response.status, error: `HTTP ${response.status}` };
    }
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { ok: false, latencyMs, error: (err as Error).message };
  }
}

// ─── Ping Cycle ───

async function pingCycle(): Promise<void> {
  if (!baseUrl) baseUrl = detectBaseUrl();

  // 1. Health ping
  const healthResult = await performPing(HEALTH_CHECK_PATH, 'health');

  // 2. Init ping (ensures engine is running)
  const initResult = await performPing(INIT_PATH, 'init');

  // 3. Update state
  const success = healthResult.ok && initResult.ok;
  totalPings++;

  if (success) {
    successfulPings++;
    consecutiveFailures = 0;
    lastPingStatus = 'success';
  } else {
    consecutiveFailures++;
    lastPingStatus = 'failure';
  }

  lastPingAt = new Date().toISOString();

  // 4. Record in history
  const record: PingRecord = {
    timestamp: lastPingAt,
    success,
    latencyMs: Math.max(healthResult.latencyMs, initResult.latencyMs),
    statusCode: healthResult.statusCode,
    error: !success ? `health: ${healthResult.error || 'ok'}, init: ${initResult.error || 'ok'}` : undefined,
  };

  pingHistory.push(record);
  if (pingHistory.length > PING_HISTORY_SIZE) {
    pingHistory.shift();
  }

  // 5. Log (throttled — only log every 10th ping or on status change)
  if (totalPings % 10 === 0 || (!success && consecutiveFailures <= 3)) {
    console.log(
      `[KeepAlive] Ping #${totalPings}: ${success ? 'OK' : 'FAIL'} ` +
      `(${healthResult.latencyMs}ms health, ${initResult.latencyMs}ms init)` +
      (!success ? ` — failures: ${consecutiveFailures}` : '')
    );
  }
}

// ─── Start Keep-Alive ───

export function startKeepAlive(customIntervalMs?: number): { started: boolean; intervalMs: number; baseUrl: string; message: string } {
  if (isRunning) {
    return { started: false, intervalMs: 0, baseUrl, message: 'Keep-alive already running' };
  }

  baseUrl = detectBaseUrl();
  const intervalMs = customIntervalMs || DEFAULT_INTERVAL_MS;

  isRunning = true;
  startedAt = new Date().toISOString();
  totalPings = 0;
  successfulPings = 0;
  consecutiveFailures = 0;

  // Do first ping immediately (don't wait 4 min)
  pingCycle().catch(err => {
    console.warn('[KeepAlive] Initial ping failed:', (err as Error).message);
  });

  // Then set interval for continuous pings
  pingInterval = setInterval(() => {
    pingCycle().catch(err => {
      console.warn('[KeepAlive] Ping cycle error:', (err as Error).message);
    });
  }, intervalMs);

  // Don't let the interval prevent process exit
  if (pingInterval && typeof pingInterval === 'object' && 'unref' in pingInterval) {
    pingInterval.unref();
  }

  console.log(`[KeepAlive] Started — pinging ${baseUrl}/api/health every ${intervalMs / 1000}s`);

  return {
    started: true,
    intervalMs,
    baseUrl,
    message: `Self-ping keep-alive active — pinging every ${intervalMs / 1000}s`,
  };
}

// ─── Stop Keep-Alive ───

export function stopKeepAlive(): { stopped: boolean; message: string } {
  if (!isRunning) {
    return { stopped: false, message: 'Keep-alive not running' };
  }

  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }

  isRunning = false;
  console.log('[KeepAlive] Stopped');

  return { stopped: true, message: 'Keep-alive stopped' };
}

// ─── Get Status ───

export interface KeepAliveStatus {
  isRunning: boolean;
  baseUrl: string;
  startedAt: string | null;
  lastPingAt: string | null;
  lastPingStatus: 'success' | 'failure' | null;
  totalPings: number;
  successfulPings: number;
  failedPings: number;
  successRate: string;
  consecutiveFailures: number;
  uptime: string;
  recentPings: PingRecord[];
}

export function getKeepAliveStatus(): KeepAliveStatus {
  const failedPings = totalPings - successfulPings;
  const successRate = totalPings > 0 ? `${((successfulPings / totalPings) * 100).toFixed(1)}%` : 'N/A';

  let uptime = 'N/A';
  if (startedAt) {
    const ms = Date.now() - new Date(startedAt).getTime();
    const hours = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    uptime = `${hours}h ${mins}m`;
  }

  return {
    isRunning,
    baseUrl: baseUrl || detectBaseUrl(),
    startedAt,
    lastPingAt,
    lastPingStatus,
    totalPings,
    successfulPings,
    failedPings,
    successRate,
    consecutiveFailures,
    uptime,
    recentPings: [...pingHistory].reverse().slice(0, 10),
  };
}

// ─── Manual Ping (for API trigger) ───

export async function manualPing(): Promise<{ success: boolean; health: Awaited<ReturnType<typeof performPing>>; init: Awaited<ReturnType<typeof performPing>> }> {
  if (!baseUrl) baseUrl = detectBaseUrl();

  const health = await performPing(HEALTH_CHECK_PATH, 'health');
  const init = await performPing(INIT_PATH, 'init');

  return {
    success: health.ok && init.ok,
    health,
    init,
  };
}

// ─── Is Running ───

export function isKeepAliveRunning(): boolean {
  return isRunning;
}
