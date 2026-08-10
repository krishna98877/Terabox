/**
 * 2Captcha Solver — Direct API v2 implementation.
 * https://2captcha.com/api-docs
 *
 * No dependency on @2captcha/captcha-solver npm package.
 * Uses direct fetch() calls to 2captcha's createTask/getTaskResult API.
 *
 * Supported:
 * - reCAPTCHA v2 (RecaptchaV2TaskProxyless)
 * - reCAPTCHA v3 (RecaptchaV3TaskProxyless)
 * - Cloudflare Turnstile (TurnstileTaskProxyless)
 * - Normal image CAPTCHA (ImageToTextTask)
 *
 * Cost: ~$1-3/1000 solves. No free tier.
 * Set TWOCAPTCHA_API_KEY env var to enable.
 */

const API_BASE = 'https://api.2captcha.com';
const DEFAULT_POLL_INTERVAL = 5000; // 5 seconds
const DEFAULT_MAX_POLL = 24; // 24 * 5s = 120s max wait
const REQUEST_TIMEOUT = 30000;

// ─── Types ───

export interface CaptchaTask {
  type: string;
  [key: string]: unknown;
}

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
      throw new Error(`2Captcha API ${res.status}: ${errText}`);
    }

    return await res.json();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// ─── Create Task ───

async function createTask(apiKey: string, task: CaptchaTask): Promise<string> {
  const res = await apiPost('/createTask', {
    clientKey: apiKey,
    task,
    languagePool: 'en',
  });

  if (res.errorId && res.errorId !== 0) {
    throw new Error(`2Captcha createTask error ${res.errorId}: ${res.errorCode} — ${res.errorDescription || ''}`);
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

  // Still processing
  return { success: false, error: 'processing', taskId };
}

// ─── Solve with Polling ───

async function solveWithPolling(
  apiKey: string,
  task: CaptchaTask,
  maxAttempts = DEFAULT_MAX_POLL,
  pollInterval = DEFAULT_POLL_INTERVAL
): Promise<SolveResult> {
  // Step 1: Create task
  let taskId: string;
  try {
    taskId = await createTask(apiKey, task);
    console.log(`[2Captcha] Task created: ${taskId} (type: ${task.type})`);
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  // Step 2: Wait before first poll (2captcha recommends 5s)
  await new Promise(r => setTimeout(r, pollInterval));

  // Step 3: Poll for result
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await getTaskResult(apiKey, taskId);

      if (result.success) {
        console.log(`[2Captcha] Solved! Task ${taskId}, cost: ${result.cost}, time: ${result.solveTime}s`);
        return result;
      }

      if (result.error !== 'processing') {
        // Real error (not just "still processing")
        console.error(`[2Captcha] Error: ${result.errorCode} — ${result.error}`);
        return result;
      }

      // Still processing — wait and retry
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, pollInterval));
      }
    } catch (error) {
      console.error(`[2Captcha] Poll error (attempt ${attempt + 1}): ${(error as Error).message}`);
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, pollInterval));
      }
    }
  }

  return { success: false, error: `Timeout after ${maxAttempts * pollInterval / 1000}s`, taskId };
}

// ─── Public API ───

const API_KEY = () => process.env.TWOCAPTCHA_API_KEY || '';

/**
 * Check if 2captcha is configured.
 */
export function is2CaptchaConfigured(): boolean {
  return !!API_KEY();
}

/**
 * Solve reCAPTCHA v2.
 * @param siteKey - The data-sitekey attribute value
 * @param pageUrl - Full URL of the page with the captcha
 * @param invisible - True for invisible reCAPTCHA
 */
export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'TWOCAPTCHA_API_KEY not set' };

  return solveWithPolling(key, {
    type: 'RecaptchaV2TaskProxyless',
    websiteURL: pageUrl,
    websiteKey: siteKey,
    isInvisible: invisible,
  });
}

/**
 * Solve reCAPTCHA v3.
 * @param siteKey - The data-sitekey attribute value
 * @param pageUrl - Full URL of the page with the captcha
 * @param minScore - Required score (0.3, 0.7, or 0.9)
 * @param action - Action value from grecaptcha.execute()
 */
export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = ''
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'TWOCAPTCHA_API_KEY not set' };

  const task: CaptchaTask = {
    type: 'RecaptchaV3TaskProxyless',
    websiteURL: pageUrl,
    websiteKey: siteKey,
    minScore,
  };
  if (action) task.pageAction = action;

  return solveWithPolling(key, task);
}

/**
 * Solve Cloudflare Turnstile.
 * @param siteKey - The data-sitekey attribute value
 * @param pageUrl - Full URL of the page
 */
export async function solveTurnstile(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'TWOCAPTCHA_API_KEY not set' };

  return solveWithPolling(key, {
    type: 'TurnstileTaskProxyless',
    websiteURL: pageUrl,
    websiteKey: siteKey,
  });
}

/**
 * Solve normal image CAPTCHA.
 * @param imageBase64 - Base64-encoded image (without data: prefix)
 * @param options - Optional constraints
 */
export async function solveImageCaptcha(
  imageBase64: string,
  options?: {
    phrase?: boolean;
    caseSensitive?: boolean;
    numeric?: number;
    minLength?: number;
    maxLength?: number;
    comment?: string;
  }
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'TWOCAPTCHA_API_KEY not set' };

  const task: CaptchaTask = {
    type: 'ImageToTextTask',
    body: imageBase64,
  };
  if (options?.phrase) task.phrase = true;
  if (options?.caseSensitive) task.case = true;
  if (options?.numeric) task.numeric = options.numeric;
  if (options?.minLength) task.minLength = options.minLength;
  if (options?.maxLength) task.maxLength = options.maxLength;
  if (options?.comment) task.comment = options.comment;

  return solveWithPolling(key, task);
}

/**
 * Get account balance.
 */
export async function getBalance(): Promise<{ balance: number; error?: string }> {
  const key = API_KEY();
  if (!key) return { balance: 0, error: 'TWOCAPTCHA_API_KEY not set' };

  try {
    const res = await apiPost('/getBalance', { clientKey: key });
    if (res.errorId && res.errorId !== 0) {
      return { balance: 0, error: res.errorCode };
    }
    return { balance: res.balance };
  } catch (error) {
    return { balance: 0, error: (error as Error).message };
  }
}

/**
 * Report correct solve (for better training).
 */
export async function reportCorrect(taskId: string): Promise<void> {
  const key = API_KEY();
  if (!key) return;
  try {
    await apiPost('/reportCorrect', { clientKey: key, taskId });
  } catch {}
}

/**
 * Report incorrect solve (for refund).
 */
export async function reportIncorrect(taskId: string): Promise<void> {
  const key = API_KEY();
  if (!key) return;
  try {
    await apiPost('/reportIncorrect', { clientKey: key, taskId });
  } catch {}
}
