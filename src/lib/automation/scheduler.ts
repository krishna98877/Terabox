/**
 * Continuous Parallel Loop — 5 concurrent signup workers that NEVER stop.
 *
 * Architecture:
 * - 5 workers start simultaneously when you press "Start Engine"
 * - Each worker runs an INFINITE LOOP:
 *   get proxy → create email → browser signup → poll verification → verify → cleanup → REPEAT
 * - When one worker finishes (success or failure), it immediately starts the NEXT signup
 * - No interval waiting — pure continuous loop as user requested
 * - Daily limit is checked before each new attempt (pause if reached, resume next day)
 * - Proxy rotates for each signup attempt (different IP)
 * - Each browser context is fully isolated (new cookies, new fingerprint)
 * - Workers are NOT internal scheduled tasks — they are persistent loops
 */

import { db } from '@/lib/db';
import { executeSignup, initializeEngine } from './engine';
import { closeBrowser } from '@/lib/browser';

const MAX_WORKERS = 5;

// ─── Worker State ───

export interface WorkerSlot {
  id: number;
  status: 'idle' | 'running' | 'paused' | 'stopping';
  currentEmail: string;
  currentStep: string;
  currentProxy: string;
  startedAt: string | null;
  attempts: number;
  successes: number;
  failures: number;
}

const workers: WorkerSlot[] = Array.from({ length: MAX_WORKERS }, (_, i) => ({
  id: i,
  status: 'idle',
  currentEmail: '',
  currentStep: '',
  currentProxy: '',
  startedAt: null,
  attempts: 0,
  successes: 0,
  failures: 0,
}));

let isPoolRunning = false;
let abortControllers: AbortController[] = [];

// ─── Get worker states (for UI) ───

export function getWorkerStates(): WorkerSlot[] {
  return workers.map(w => ({ ...w }));
}

export function isPoolActive(): boolean {
  return isPoolRunning;
}

export function getMaxWorkers(): number {
  return MAX_WORKERS;
}

// ─── Check daily limit ───

async function isDailyLimitReached(): Promise<boolean> {
  const config = await db.referralConfig.findFirst();
  if (!config) return true;

  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const todayCount = await db.signupRecord.count({
    where: { createdAt: { gte: todayStart } },
  });

  return todayCount >= config.maxSignupsPerDay;
}

// ─── Get master link ───

async function getMasterLink(): Promise<string | null> {
  const config = await db.referralConfig.findFirst();
  if (!config || !config.isActive || !config.masterLink) return null;
  return config.masterLink;
}

// ─── Single Worker Loop (INFINITE — never stops until abort) ───

async function workerLoop(workerIndex: number, abortSignal: AbortSignal): Promise<void> {
  const worker = workers[workerIndex];

  console.log(`[Worker ${workerIndex}] Started continuous loop`);

  while (!abortSignal.aborted) {
    try {
      // Check daily limit before each attempt
      if (await isDailyLimitReached()) {
        worker.status = 'paused';
        worker.currentStep = 'Daily limit reached — waiting until tomorrow...';
        // Wait 5 minutes and recheck
        await new Promise(r => setTimeout(r, 5 * 60 * 1000));
        continue;
      }

      // Get master link
      const link = await getMasterLink();
      if (!link) {
        worker.status = 'paused';
        worker.currentStep = 'No master link configured — waiting...';
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }

      // Start a signup attempt
      worker.status = 'running';
      worker.currentStep = 'Creating temp email...';
      worker.currentEmail = '';
      worker.currentProxy = '';
      worker.startedAt = new Date().toISOString();
      worker.attempts++;

      const result = await executeSignup(link);

      // Update worker state based on result
      worker.currentEmail = result.email;
      worker.currentProxy = result.proxyUsed || 'direct';

      if (result.success) {
        worker.successes++;
        worker.currentStep = `Verified: ${result.email} (${result.proxyUsed || 'direct'})`;
      } else {
        worker.failures++;
        worker.currentStep = `Failed: ${result.error || 'Unknown'} (${result.proxyUsed || 'direct'})`;
      }

      // Brief pause between attempts (3 seconds) — not an interval, just a cooldown
      if (!abortSignal.aborted) {
        worker.currentStep = result.success
          ? `Done — starting next signup...`
          : `Retry in 3s...`;
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (error) {
      worker.failures++;
      worker.currentStep = `Error: ${(error as Error).message}`;
      // Wait 10 seconds on unexpected errors
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  // Aborted
  worker.status = 'idle';
  worker.currentStep = 'Stopped';
  worker.currentEmail = '';
  worker.currentProxy = '';
  console.log(`[Worker ${workerIndex}] Stopped`);
}

// ─── Start the Continuous Loop Engine ───

export async function startPool(): Promise<{ started: boolean; workers: number; message: string }> {
  if (isPoolRunning) {
    return { started: false, workers: MAX_WORKERS, message: 'Engine already running' };
  }

  // Verify we have a master link
  const link = await getMasterLink();
  if (!link) {
    return { started: false, workers: 0, message: 'No master referral link configured' };
  }

  // Verify browser is available (HTTP fallback always works)
  const { isBrowserAvailable } = await import('@/lib/browser');
  const browserAvail = await isBrowserAvailable().catch(() => true);
  if (!browserAvail) {
    return { started: false, workers: 0, message: 'No automation method available' };
  }

  // Initialize proxy pool
  await initializeEngine();

  isPoolRunning = true;
  abortControllers = [];

  for (let i = 0; i < MAX_WORKERS; i++) {
    const controller = new AbortController();
    abortControllers.push(controller);

    workers[i].status = 'running';
    workers[i].currentStep = 'Starting...';
    workers[i].currentProxy = '';
    workers[i].startedAt = new Date().toISOString();
    workers[i].attempts = 0;
    workers[i].successes = 0;
    workers[i].failures = 0;

    // Fire and forget — each worker runs its own infinite loop
    workerLoop(i, controller.signal).catch(err => {
      console.error(`[Worker ${i}] Fatal error:`, err.message);
      workers[i].status = 'idle';
      workers[i].currentStep = `Fatal: ${err.message}`;
    });
  }

  console.log(`[Engine] Started ${MAX_WORKERS} continuous parallel workers`);
  return { started: true, workers: MAX_WORKERS, message: `${MAX_WORKERS} workers running in continuous loop` };
}

// ─── Stop the Engine ───

export async function stopPool(): Promise<{ stopped: boolean; message: string }> {
  if (!isPoolRunning) {
    return { stopped: false, message: 'Engine not running' };
  }

  // Abort all workers
  for (const controller of abortControllers) {
    controller.abort();
  }

  // Mark all workers as stopping
  for (const worker of workers) {
    worker.status = 'stopping';
    worker.currentStep = 'Stopping...';
  }

  // Wait up to 5 seconds for workers to finish
  await new Promise(r => setTimeout(r, 5000));

  // Force idle
  for (const worker of workers) {
    worker.status = 'idle';
    worker.currentStep = 'Stopped';
    worker.currentEmail = '';
    worker.currentProxy = '';
  }

  isPoolRunning = false;
  abortControllers = [];

  // Close shared browser
  await closeBrowser().catch(() => {});

  console.log('[Engine] All workers stopped');
  return { stopped: true, message: 'Engine stopped' };
}

// ─── Legacy compat (scheduler API expects these) ───

export function startAutoSignupScheduler(): void {
  startPool().then(r => console.log('[Engine]', r.message));
}

export function stopAutoSignupScheduler(): void {
  stopPool().then(r => console.log('[Engine]', r.message));
}

export function isSchedulerRunning(): boolean {
  return isPoolRunning;
}
