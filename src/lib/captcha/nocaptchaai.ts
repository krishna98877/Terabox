/**
 * NoCaptchaAI Solver — Direct API implementation.
 * https://nocaptchaai.com/
 *
 * 6,000 FREE solves/month. No credit card needed.
 * Same createTask/getTaskResult API format as 2captcha.
 *
 * Supported: reCAPTCHA v2/v3, Turnstile, GeeTest, ImageToText, and more
 * Pricing: $0.14-0.50/1000 solves (after free tier)
 * Avg solve time: 0.5-3 seconds
 *
 * Set NOCAPTCHA_API_KEY env var to enable.
 * Get your key at: https://nocaptchaai.com/ (sign up → dashboard)
 */

const API_BASE = 'https://api.nocaptchaai.com';
const POLL_INTERVAL = 2000; // 2 seconds (NoCaptchaAI is fast)
const MAX_POLL = 60; // 60 * 2s = 120s max wait
const REQUEST_TIMEOUT = 30000;

// ─── Types ───

export interface SolveResult {
  success: boolean;
  solution?: Record<string, string>;
  cost?: string;
  solveTime?: number;
  taskId?: string;
  error?: string;
  errorCode?: string;
}

// ─── Core API ───

async function apiPost(endpoint: string, body: unknown): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`NoCaptchaAI API ${res.status}: ${errText}`);
    }

    return await res.json();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// ─── Create Task ───

async function createTask(apiKey: string, task: Record<string, unknown>): Promise<string> {
  const res = await apiPost('/createTask', {
    clientKey: apiKey,
    task,
  });

  if (res.errorId && res.errorId !== 0) {
    throw new Error(`NoCaptchaAI createTask error ${res.errorId}: ${res.errorCode || ''} — ${res.errorDescription || ''}`);
  }

  return res.taskId;
}

// ─── Poll for Result ───

async function getTaskResult(apiKey: string, taskId: string): Promise<SolveResult> {
  const res = await apiPost('/getTaskResult', {
    clientKey: apiKey,
    taskId,
  });

  if (res.errorId && res.errorId !== 0) {
    return {
      success: false,
      error: res.errorDescription || res.errorCode,
      errorCode: res.errorCode,
      taskId,
    };
  }

  if (res.status === 'ready') {
    const solveTime = res.endTime && res.createTime
      ? res.endTime - res.createTime
      : undefined;

    return {
      success: true,
      solution: res.solution,
      cost: res.cost,
      solveTime,
      taskId,
    };
  }

  if (res.status === 'failed') {
    return {
      success: false,
      error: 'Task failed on server',
      errorCode: 'TASK_FAILED',
      taskId,
    };
  }

  // Still processing
  return { success: false, error: 'processing', taskId };
}

// ─── Solve with Polling ───

async function solveWithPolling(
  apiKey: string,
  task: Record<string, unknown>,
  maxAttempts = MAX_POLL,
  pollInterval = POLL_INTERVAL
): Promise<SolveResult> {
  let taskId: string;
  try {
    taskId = await createTask(apiKey, task);
    console.log(`[NoCaptchaAI] Task created: ${taskId} (type: ${task.type})`);
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  // Wait before first poll
  await new Promise(r => setTimeout(r, pollInterval));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await getTaskResult(apiKey, taskId);

      if (result.success) {
        console.log(`[NoCaptchaAI] Solved! Task ${taskId}, cost: ${result.cost}, time: ${result.solveTime}s`);
        return result;
      }

      if (result.error !== 'processing') {
        return result;
      }

      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, pollInterval));
      }
    } catch (error) {
      console.error(`[NoCaptchaAI] Poll error (attempt ${attempt + 1}): ${(error as Error).message}`);
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, pollInterval));
      }
    }
  }

  return { success: false, error: `Timeout after ${maxAttempts * pollInterval / 1000}s`, taskId };
}

// ─── Public API ───

const API_KEY = () => process.env.NOCAPTCHA_API_KEY || '';

export function isConfigured(): boolean {
  return !!API_KEY();
}

/**
 * Solve reCAPTCHA v2 via NoCaptchaAI.
 */
export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'NOCAPTCHA_API_KEY not set' };

  return solveWithPolling(key, {
    type: 'ReCaptchaV2TaskProxyLess',
    websiteURL: pageUrl,
    websiteKey: siteKey,
    ...(invisible && { isInvisible: true }),
  });
}

/**
 * Solve reCAPTCHA v3 via NoCaptchaAI.
 */
export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = ''
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'NOCAPTCHA_API_KEY not set' };

  const task: Record<string, unknown> = {
    type: 'ReCaptchaV3TaskProxyLess',
    websiteURL: pageUrl,
    websiteKey: siteKey,
    minScore,
  };
  if (action) task.pageAction = action;

  return solveWithPolling(key, task);
}

/**
 * Solve Cloudflare Turnstile via NoCaptchaAI.
 */
export async function solveTurnstile(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'NOCAPTCHA_API_KEY not set' };

  return solveWithPolling(key, {
    type: 'TurnstileTaskProxyLess',
    websiteURL: pageUrl,
    websiteKey: siteKey,
  });
}

/**
 * Solve normal image CAPTCHA via NoCaptchaAI.
 */
export async function solveImageCaptcha(
  imageBase64: string,
  options?: { phrase?: boolean; caseSensitive?: boolean; numeric?: number; minLength?: number; maxLength?: number; comment?: string }
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'NOCAPTCHA_API_KEY not set' };

  const task: Record<string, unknown> = {
    type: 'ImageToTextTask',
    body: imageBase64,
  };
  if (options?.caseSensitive) task.case = true;
  if (options?.numeric) task.numeric = options.numeric;
  if (options?.minLength) task.minLength = options.minLength;
  if (options?.maxLength) task.maxLength = options.maxLength;

  return solveWithPolling(key, task);
}

/**
 * Get account balance.
 */
export async function getBalance(): Promise<{ balance: number; error?: string }> {
  const key = API_KEY();
  if (!key) return { balance: 0, error: 'NOCAPTCHA_API_KEY not set' };

  try {
    const res = await fetch(`${API_BASE}/balance?apiKey=${key}`, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const data = await res.json();
    if (data.errorId && data.errorId !== 0) {
      return { balance: 0, error: data.errorCode };
    }
    return { balance: data.balance ?? data.credits ?? 0 };
  } catch (error) {
    return { balance: 0, error: (error as Error).message };
  }
}
