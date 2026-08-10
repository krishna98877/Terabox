/**
 * CaptchaSolv — Fast & reliable CAPTCHA solving API.
 * https://docs.captchasolv.com/
 *
 * ═══════════════════════════════════════════════════════════════════
 * FREE: 100 solves/day (get API key via Discord /panel)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Features:
 * - 2captcha-compatible API format
 * - Sync endpoint: POST /solve (recommended — handles polling internally)
 * - Async: POST /createTask → POST /getTaskResult (for advanced use)
 * - 10+ captcha types, average solve time < 15s
 * - Supports reCAPTCHA v2/v3, Turnstile, hCaptcha, GeeTest v4, and more
 *
 * API Key: Get via Telegram bot or Discord /panel command
 * Set CAPTCHASOLV_API_KEY env var
 *
 * Base URL: https://v1.captchasolv.com
 */

const API_BASE = 'https://v1.captchasolv.com';
const SYNC_TIMEOUT = 130_000; // 130s (API timeout is 120s, add buffer)
const ASYNC_POLL_INTERVAL = 3000; // 3 seconds
const ASYNC_MAX_POLL = 40; // 40 * 3s = 120s max
const MAX_RETRIES = 3; // Retry on ERROR_CAPTCHA_UNSOLVABLE

// ─── Types ───

export interface SolveResult {
  success: boolean;
  solution?: Record<string, string>;
  cost?: string;
  solveTime?: number;
  taskId?: string;
  error?: string;
  errorCode?: string;
  provider?: string;
}

export interface CaptchaSolvBalance {
  balance: number;
  error?: string;
}

// ─── Task Types ───

export const TASK_TYPES = {
  // reCAPTCHA v2
  RECAPTCHA_V2: 'RecaptchaV2TaskProxyless',
  RECAPTCHA_V2_PROXY: 'RecaptchaV2Task',
  RECAPTCHA_V2_INVISIBLE: 'RecaptchaV2InvisibleTaskProxyless',
  RECAPTCHA_V2_INVISIBLE_PROXY: 'RecaptchaV2InvisibleTask',
  // reCAPTCHA v2 Enterprise
  RECAPTCHA_V2_ENTERPRISE: 'RecaptchaV2EnterpriseTaskProxyless',
  RECAPTCHA_V2_ENTERPRISE_PROXY: 'RecaptchaV2EnterpriseTask',
  RECAPTCHA_V2_ENTERPRISE_INVISIBLE: 'RecaptchaV2EnterpriseInvisibleTaskProxyless',
  RECAPTCHA_V2_ENTERPRISE_INVISIBLE_PROXY: 'RecaptchaV2EnterpriseInvisibleTask',
  // reCAPTCHA v3
  RECAPTCHA_V3: 'RecaptchaV3TaskProxyless',
  RECAPTCHA_V3_PROXY: 'RecaptchaV3Task',
  // Cloudflare Turnstile
  TURNSTILE: 'TurnstileTaskProxyless',
  TURNSTILE_PROXY: 'TurnstileTask',
  // hCaptcha
  HCAPTCHA: 'HCaptchaTaskProxyless',
  HCAPTCHA_PROXY: 'HCaptchaTask',
  // GeeTest v4
  GEETEST_V4: 'GeeTestV4TaskProxyless',
  GEETEST_V4_PROXY: 'GeeTestV4Task',
} as const;

// ─── Error Codes ───

const RETRYABLE_ERRORS = new Set([
  'ERROR_CAPTCHA_UNSOLVABLE',
]);

const FATAL_ERRORS: Record<string, string> = {
  'ERROR_INVALID_REQUEST': 'Invalid request format',
  'ERROR_KEY_DOES_NOT_EXIST': 'Invalid API key',
  'ERROR_UNSUPPORTED_CAPTCHA_TYPE': 'Unknown task type',
  'ERROR_LIMIT_EXCEEDED': 'Rate limit or balance exceeded',
  'ERROR_PROXY_BLOCKED': 'Proxy/IP hard blocked by target',
  'ERROR_NO_SUCH_CAPCHA_ID': 'Task ID not found or expired',
};

// ─── Core API ───

async function apiPost(
  endpoint: string,
  body: unknown,
  timeout = SYNC_TIMEOUT
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

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
      throw new Error(`CaptchaSolv API ${res.status}: ${errText}`);
    }

    return await res.json();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// ─── Sync Solve (Recommended) ───

/**
 * Solve CAPTCHA synchronously — POST /solve
 * This is the recommended endpoint. It handles polling internally
 * and returns the result directly (up to 120s timeout).
 *
 * Request body is same as /createTask.
 * Set HTTP client timeout to at least 130s.
 */
async function solveSync(
  apiKey: string,
  task: Record<string, unknown>,
  waitForSlot = true
): Promise<SolveResult> {
  const startTime = Date.now();

  const body: Record<string, unknown> = {
    clientKey: apiKey,
    task,
  };
  if (waitForSlot) {
    body.waitForSlot = true;
  }

  try {
    const res = await apiPost('/solve', body);

    // Success
    if (res.errorId === 0 && res.solution) {
      const solveTime = (Date.now() - startTime) / 1000;
      const solution: Record<string, string> = {};

      // Extract solution fields
      if (res.solution.token) solution.token = res.solution.token;
      if (res.solution.gRecaptchaResponse) solution.gRecaptchaResponse = res.solution.gRecaptchaResponse;
      if (res.solution.userAgent) solution.userAgent = res.solution.userAgent;
      if (res.solution.cookie) solution.cookie = res.solution.cookie;
      if (res.solution.sensor) solution.sensor = res.solution.sensor;

      console.log(`[CaptchaSolv] Solved! Time: ${solveTime.toFixed(1)}s, cost: ${res.cost || 'N/A'}`);
      return {
        success: true,
        solution,
        cost: res.cost,
        solveTime,
        provider: 'captchasolv',
      };
    }

    // Error
    if (res.errorId > 0) {
      const errorCode = res.errorCode || `ERROR_${res.errorId}`;
      const errorDesc = res.errorDescription || errorCode;

      if (RETRYABLE_ERRORS.has(errorCode)) {
        return {
          success: false,
          error: errorDesc,
          errorCode,
          provider: 'captchasolv',
        };
      }

      // Fatal error
      return {
        success: false,
        error: errorDesc,
        errorCode,
        provider: 'captchasolv',
      };
    }

    // Unexpected response
    return {
      success: false,
      error: `Unexpected response: ${JSON.stringify(res).substring(0, 200)}`,
      provider: 'captchasolv',
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      provider: 'captchasolv',
    };
  }
}

// ─── Async Solve (Advanced) ───

/**
 * Create async task — POST /createTask
 * Returns taskId for polling with getTaskResult.
 */
async function createTask(
  apiKey: string,
  task: Record<string, unknown>
): Promise<{ taskId?: string; error?: string; errorCode?: string }> {
  try {
    const res = await apiPost('/createTask', { clientKey: apiKey, task }, 15000);

    if (res.errorId === 0 && res.taskId) {
      return { taskId: res.taskId };
    }

    return {
      error: res.errorDescription || res.errorCode || `Error ${res.errorId}`,
      errorCode: res.errorCode,
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/**
 * Get task result — POST /getTaskResult
 * Poll until status is "ready" or error.
 */
async function getTaskResult(
  apiKey: string,
  taskId: string
): Promise<{ ready: boolean; solution?: Record<string, string>; cost?: string; error?: string; errorCode?: string }> {
  try {
    const res = await apiPost('/getTaskResult', { clientKey: apiKey, taskId }, 15000);

    if (res.errorId > 0) {
      return {
        ready: false,
        error: res.errorDescription || res.errorCode,
        errorCode: res.errorCode,
      };
    }

    if (res.status === 'ready' && res.solution) {
      const solution: Record<string, string> = {};
      if (res.solution.token) solution.token = res.solution.token;
      if (res.solution.gRecaptchaResponse) solution.gRecaptchaResponse = res.solution.gRecaptchaResponse;
      if (res.solution.userAgent) solution.userAgent = res.solution.userAgent;
      if (res.solution.cookie) solution.cookie = res.solution.cookie;

      return { ready: true, solution, cost: res.cost };
    }

    // Still processing
    return { ready: false };
  } catch (error) {
    return { ready: false, error: (error as Error).message };
  }
}

/**
 * Solve with async polling (createTask → getTaskResult loop).
 * Use this when you need more control over the polling process.
 */
async function solveAsync(
  apiKey: string,
  task: Record<string, unknown>
): Promise<SolveResult> {
  const startTime = Date.now();

  // Create task
  const createRes = await createTask(apiKey, task);
  if (!createRes.taskId) {
    return {
      success: false,
      error: createRes.error || 'Failed to create task',
      errorCode: createRes.errorCode,
      provider: 'captchasolv',
    };
  }

  const taskId = createRes.taskId;
  console.log(`[CaptchaSolv] Task created: ${taskId} (type: ${task.type})`);

  // Wait before first poll
  await new Promise(r => setTimeout(r, ASYNC_POLL_INTERVAL));

  // Poll for result
  for (let attempt = 0; attempt < ASYNC_MAX_POLL; attempt++) {
    const result = await getTaskResult(apiKey, taskId);

    if (result.ready && result.solution) {
      const solveTime = (Date.now() - startTime) / 1000;
      console.log(`[CaptchaSolv] Solved! Task ${taskId}, time: ${solveTime.toFixed(1)}s`);
      return {
        success: true,
        solution: result.solution,
        cost: result.cost,
        solveTime,
        taskId,
        provider: 'captchasolv',
      };
    }

    if (result.error && !RETRYABLE_ERRORS.has(result.errorCode || '')) {
      return {
        success: false,
        error: result.error,
        errorCode: result.errorCode,
        taskId,
        provider: 'captchasolv',
      };
    }

    // Still processing — wait and retry
    if (attempt < ASYNC_MAX_POLL - 1) {
      await new Promise(r => setTimeout(r, ASYNC_POLL_INTERVAL));
    }
  }

  return {
    success: false,
    error: `Timeout after ${ASYNC_MAX_POLL * ASYNC_POLL_INTERVAL / 1000}s`,
    taskId,
    provider: 'captchasolv',
  };
}

// ─── Public API ───

const API_KEY = () => process.env.CAPTCHASOLV_API_KEY || '';

export function isConfigured(): boolean {
  return !!API_KEY();
}

/**
 * Solve reCAPTCHA v2 via CaptchaSolv.
 * Free: 100 solves/day.
 *
 * Task types:
 * - RecaptchaV2TaskProxyless (no proxy)
 * - RecaptchaV2InvisibleTaskProxyless (invisible, no proxy)
 */
export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  const taskType = invisible
    ? TASK_TYPES.RECAPTCHA_V2_INVISIBLE
    : TASK_TYPES.RECAPTCHA_V2;

  const task = {
    type: taskType,
    websiteURL: pageUrl,
    websiteKey: siteKey,
  };

  console.log(`[CaptchaSolv] Solving reCAPTCHA v2${invisible ? ' (invisible)' : ''} for ${pageUrl.substring(0, 60)}...`);

  // Retry on ERROR_CAPTCHA_UNSOLVABLE
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await solveSync(key, task);
    if (result.success) return result;

    if (!RETRYABLE_ERRORS.has(result.errorCode || '')) {
      return result; // Fatal error, don't retry
    }

    console.warn(`[CaptchaSolv] reCAPTCHA v2 unsolvable (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
    }
  }

  return { success: false, error: 'Max retries exceeded for reCAPTCHA v2', provider: 'captchasolv' };
}

/**
 * Solve reCAPTCHA v3 via CaptchaSolv.
 * Free: 100 solves/day.
 *
 * Task types:
 * - RecaptchaV3TaskProxyless (no proxy)
 */
export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = ''
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  const task: Record<string, unknown> = {
    type: TASK_TYPES.RECAPTCHA_V3,
    websiteURL: pageUrl,
    websiteKey: siteKey,
  };

  // CaptchaSolv uses "score" param for v3 score mode
  if (minScore >= 0.7) {
    task.score = 'high';
  } else {
    task.score = 'normal';
  }

  console.log(`[CaptchaSolv] Solving reCAPTCHA v3 for ${pageUrl.substring(0, 60)}... (score: ${task.score})`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await solveSync(key, task);
    if (result.success) return result;

    if (!RETRYABLE_ERRORS.has(result.errorCode || '')) {
      return result;
    }

    console.warn(`[CaptchaSolv] reCAPTCHA v3 unsolvable (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  return { success: false, error: 'Max retries exceeded for reCAPTCHA v3', provider: 'captchasolv' };
}

/**
 * Solve Cloudflare Turnstile via CaptchaSolv.
 * Free: 100 solves/day.
 */
export async function solveTurnstile(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  const task = {
    type: TASK_TYPES.TURNSTILE,
    websiteURL: pageUrl,
    websiteKey: siteKey,
  };

  console.log(`[CaptchaSolv] Solving Turnstile for ${pageUrl.substring(0, 60)}...`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await solveSync(key, task);
    if (result.success) return result;
    if (!RETRYABLE_ERRORS.has(result.errorCode || '')) return result;

    console.warn(`[CaptchaSolv] Turnstile unsolvable (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
    if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 2000));
  }

  return { success: false, error: 'Max retries exceeded for Turnstile', provider: 'captchasolv' };
}

/**
 * Solve hCaptcha via CaptchaSolv.
 * Free: 100 solves/day.
 */
export async function solveHCaptcha(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  const task = {
    type: TASK_TYPES.HCAPTCHA,
    websiteURL: pageUrl,
    websiteKey: siteKey,
  };

  console.log(`[CaptchaSolv] Solving hCaptcha for ${pageUrl.substring(0, 60)}...`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await solveSync(key, task);
    if (result.success) return result;
    if (!RETRYABLE_ERRORS.has(result.errorCode || '')) return result;

    console.warn(`[CaptchaSolv] hCaptcha unsolvable (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
    if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 2000));
  }

  return { success: false, error: 'Max retries exceeded for hCaptcha', provider: 'captchasolv' };
}

/**
 * Solve GeeTest v4 via CaptchaSolv.
 * Free: 100 solves/day.
 */
export async function solveGeeTestV4(
  websiteURL: string,
  websiteKey: string,
  captchaJs: string,
  apiServers?: string,
  staticServers?: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  const task: Record<string, unknown> = {
    type: TASK_TYPES.GEETEST_V4,
    websiteURL,
    websiteKey,
    captchaJs,
  };
  if (apiServers) task.apiServers = apiServers;
  if (staticServers) task.staticServers = staticServers;

  console.log(`[CaptchaSolv] Solving GeeTest v4 for ${websiteURL.substring(0, 60)}...`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await solveSync(key, task);
    if (result.success) return result;
    if (!RETRYABLE_ERRORS.has(result.errorCode || '')) return result;

    if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 2000));
  }

  return { success: false, error: 'Max retries exceeded for GeeTest v4', provider: 'captchasolv' };
}

/**
 * Solve with custom task (for any supported CaptchaSolv type).
 * Use this for types not covered by the specific functions above.
 */
export async function solveCustom(
  task: Record<string, unknown>,
  useAsync = false
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  if (useAsync) {
    return solveAsync(key, task);
  }
  return solveSync(key, task);
}

// ─── Balance / Status ───

/**
 * Get account balance.
 * POST /getBalance
 */
export async function getBalance(): Promise<CaptchaSolvBalance> {
  const key = API_KEY();
  if (!key) return { balance: 0, error: 'CAPTCHASOLV_API_KEY not set' };

  try {
    const res = await apiPost('/getBalance', { clientKey: key }, 10000);

    if (res.errorId === 0) {
      return { balance: res.balance ?? 0 };
    }

    return { balance: 0, error: res.errorDescription || res.errorCode || 'Unknown error' };
  } catch (error) {
    return { balance: 0, error: (error as Error).message };
  }
}

/**
 * Check API health (no auth required).
 * GET /health
 */
export async function healthCheck(): Promise<{ ok: boolean; service?: string; time?: number; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const data = await res.json();
    return { ok: data.status === 'ok', service: data.service, time: data.time };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * Get supported task types (no auth required).
 * GET /supportedTypes
 */
export async function getSupportedTypes(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE}/supportedTypes`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const data = await res.json();
    return data.types || [];
  } catch {
    return [];
  }
}
