/**
 * CaptchaSolv — Fast & reliable CAPTCHA solving API.
 * https://docs.captchasolv.com/getting-started/
 *
 * ═══════════════════════════════════════════════════════════════════
 * FREE: 100 solves/day (claim via Discord /claim or Telegram bot)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Per official docs (https://docs.captchasolv.com/):
 * - 2captcha-compatible API format
 * - Sync endpoint: POST /solve (recommended — handles polling internally, 120s timeout)
 * - Async: POST /createTask → POST /getTaskResult (3-5s poll interval)
 * - 10+ captcha types, average solve time < 15s
 * - Supports reCAPTCHA v2/v3, v2 Enterprise, v3 Enterprise, Turnstile, hCaptcha, GeeTest v4
 * - waitForSlot: true queues instead of failing on ERROR_LIMIT_EXCEEDED (waits up to 300s)
 * - Token expiry: ~2 min for reCAPTCHA, ~5 min for Turnstile — use immediately!
 *
 * ★★★ CRITICAL: Proxy-bound captcha solving ★★★
 * Enterprise reCAPTCHA binds the token to the solver's IP address.
 * If you solve from CaptchaSolv's IP (Proxyless) but submit from your proxy IP,
 * TeraBox REJECTS the token → errno 400090 loop!
 *
 * FIX: Always use *Task (with proxy) types when you have a proxy.
 * This makes CaptchaSolv solve from the SAME IP → token matches → accepted!
 *
 * API Key: Get via Discord /panel command
 * Set CAPTCHASOLV_API_KEY env var
 *
 * Base URL: https://v1.captchasolv.com
 */

const API_BASE = 'https://v1.captchasolv.com';
const SYNC_TIMEOUT = 130_000; // 130s (docs: API timeout is 120s, set client >= 130s)
const ASYNC_POLL_INTERVAL = 5000; // 5 seconds (increased from 3s — CaptchaSolv needs more time for reCAPTCHA)
const ASYNC_MAX_POLL = 30; // 30 * 5s = 150s max (increased from 120s — some captchas take 60-90s)
const MAX_RETRIES = 3; // Retry on ERROR_CAPTCHA_UNSOLVABLE (per docs)

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

// ─── Task Types (per https://docs.captchasolv.com/captcha-types/) ───

export const TASK_TYPES = {
  // reCAPTCHA v2
  RECAPTCHA_V2: 'RecaptchaV2TaskProxyless',
  RECAPTCHA_V2_PROXY: 'RecaptchaV2Task',
  RECAPTCHA_V2_INVISIBLE: 'RecaptchaV2InvisibleTaskProxyless',
  RECAPTCHA_V2_INVISIBLE_PROXY: 'RecaptchaV2InvisibleTask',
  // reCAPTCHA v2 Enterprise (TeraBox uses this!)
  RECAPTCHA_V2_ENTERPRISE: 'RecaptchaV2EnterpriseTaskProxyless',
  RECAPTCHA_V2_ENTERPRISE_PROXY: 'RecaptchaV2EnterpriseTask',
  RECAPTCHA_V2_ENTERPRISE_INVISIBLE: 'RecaptchaV2EnterpriseInvisibleTaskProxyless',
  RECAPTCHA_V2_ENTERPRISE_INVISIBLE_PROXY: 'RecaptchaV2EnterpriseInvisibleTask',
  // reCAPTCHA v3
  RECAPTCHA_V3: 'RecaptchaV3TaskProxyless',
  RECAPTCHA_V3_PROXY: 'RecaptchaV3Task',
  // reCAPTCHA v3 Enterprise
  RECAPTCHA_V3_ENTERPRISE: 'RecaptchaV3EnterpriseTaskProxyless',
  RECAPTCHA_V3_ENTERPRISE_PROXY: 'RecaptchaV3EnterpriseTask',
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

// ─── Error Codes (per docs: errorId 0=success, 1=invalid, 2=bad key, 3=bad type, 10=limit, 12=unsolvable, 15=proxy, 16=not found) ───

const RETRYABLE_ERRORS = new Set([
  'ERROR_CAPTCHA_UNSOLVABLE', // errorId 12 — retry with different strategy
  'ERROR_LIMIT_EXCEEDED',     // errorId 10 — concurrent task limit, wait and retry
]);

const FATAL_ERRORS: Record<string, string> = {
  'ERROR_INVALID_REQUEST': 'Invalid request format (errorId 1)',
  'ERROR_KEY_DOES_NOT_EXIST': 'Invalid API key (errorId 2)',
  'ERROR_UNSUPPORTED_CAPTCHA_TYPE': 'Unknown task type (errorId 3)',
  'ERROR_PROXY_BLOCKED': 'Proxy/IP hard blocked by target (errorId 15)',
  'ERROR_NO_SUCH_CAPCHA_ID': 'Task ID not found or expired (errorId 16)',
};

// ─── Proxy Helper ───

/**
 * ★★★ Parse proxy URL into 2captcha-compatible format ★★★
 *
 * CaptchaSolv (2captcha-compatible API) requires proxy as SEPARATE fields:
 *   proxyType: "http" | "socks4" | "socks5"
 *   proxyAddress: "1.2.3.4"
 *   proxyPort: 8080
 *   proxyLogin: "user" (optional)
 *   proxyPassword: "pass" (optional)
 *
 * NOT a single URL string like task.proxy = "http://1.2.3.4:8080"!
 * That was THE BUG causing CaptchaSolv to silently ignore the proxy →
 * proxyless solving → token IP mismatch → TeraBox errno 400090 loop!
 */
function parseProxyForCaptcha(proxyUrl: string): Record<string, unknown> | null {
  try {
    const parsed = new URL(proxyUrl);
    const protocol = parsed.protocol.replace(':', '');

    // CaptchaSolv supports: http, https, socks4, socks5
    // Map https → http (CONNECT tunnel handles it)
    let proxyType: string;
    if (protocol === 'https') {
      proxyType = 'http';
    } else if (['http', 'socks4', 'socks5'].includes(protocol)) {
      proxyType = protocol;
    } else {
      console.warn(`[CaptchaSolv] Unsupported proxy protocol "${protocol}" — skipping proxy`);
      return null;
    }

    // ★ URL parser strips default ports (80 for http, 443 for https, 1080 for socks)
    // So we need to infer the port from the protocol if not explicitly in the URL
    const explicitPort = parsed.port ? parseInt(parsed.port, 10) : 0;
    const defaultPort = protocol === 'https' ? 443 : protocol === 'socks5' || protocol === 'socks4' ? 1080 : 80;
    const port = explicitPort || defaultPort;
    if (isNaN(port) || port <= 0 || port > 65535) {
      console.warn(`[CaptchaSolv] Invalid proxy port: "${parsed.port}" → ${port} — skipping proxy`);
      return null;
    }

    const proxyFields: Record<string, unknown> = {
      proxyType,
      proxyAddress: parsed.hostname,
      proxyPort: port,
    };

    // Auth if present
    if (parsed.username) proxyFields.proxyLogin = decodeURIComponent(parsed.username);
    if (parsed.password) proxyFields.proxyPassword = decodeURIComponent(parsed.password);

    console.log(
      `[CaptchaSolv] Proxy parsed: type=${proxyType}, address=${parsed.hostname}, port=${proxyFields.proxyPort}${parsed.username ? ', auth=yes' : ''}`
    );
    return proxyFields;
  } catch (err) {
    console.warn(`[CaptchaSolv] Failed to parse proxy URL "${proxyUrl}": ${(err as Error).message}`);
    return null;
  }
}

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

    // Check Content-Type to avoid parsing HTML as JSON
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      const text = await res.text().catch(() => '');
      throw new Error(`CaptchaSolv API returned non-JSON response (${contentType}): ${text.substring(0, 100)}`);
    }

    return await res.json();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// ─── Sync Solve (Recommended per docs) ───

/**
 * Solve CAPTCHA synchronously — POST /solve
 * Per docs: This is the recommended endpoint. It handles polling internally
 * and returns the result directly (up to 120s timeout).
 * Set HTTP client timeout to at least 130s.
 * Supports waitForSlot: true to queue instead of failing on rate limits.
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
    body.maxWaitTime = 120; // Wait up to 120s for a solver slot
  }

  try {
    // ★ Debug: Log what we're sending (mask sensitive parts)
    const taskDebug = { ...task };
    if (taskDebug.proxyAddress) {
      console.log(`[CaptchaSolv] /solve request: type=${task.type}, proxy=${taskDebug.proxyType}://${taskDebug.proxyAddress}:${taskDebug.proxyPort}, siteKey=${(task.websiteKey as string)?.substring(0, 10)}...`);
    } else {
      console.log(`[CaptchaSolv] /solve request: type=${task.type}, PROXYLESS, siteKey=${(task.websiteKey as string)?.substring(0, 10)}...`);
    }

    const res = await apiPost('/solve', body);

    // Success
    if (res.errorId === 0 && res.solution) {
      const solveTime = (Date.now() - startTime) / 1000;
      const solution: Record<string, string> = {};

      // Extract solution fields per docs
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
      console.warn(`[CaptchaSolv] API error: errorId=${res.errorId}, errorCode=${errorCode}, desc=${errorDesc}`);

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
 * Per docs: supports waitForSlot on createTask too.
 */
async function createTask(
  apiKey: string,
  task: Record<string, unknown>,
  waitForSlot = true
): Promise<{ taskId?: string; error?: string; errorCode?: string }> {
  try {
    const body: Record<string, unknown> = { clientKey: apiKey, task };
    if (waitForSlot) {
      body.waitForSlot = true;
      body.maxWaitTime = 120; // Wait up to 120s for a solver(免费键的槽位可能很忙)
    }
    const res = await apiPost('/createTask', body, 15000);

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
      if (res.solution.sensor) solution.sensor = res.solution.sensor;

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
    console.warn(`[CaptchaSolv] createTask failed: ${createRes.error} (type: ${task.type})`);
    return {
      success: false,
      error: createRes.error || 'Failed to create task',
      errorCode: createRes.errorCode,
      provider: 'captchasolv',
    };
  }

  const taskId = createRes.taskId;
  console.log(`[CaptchaSolv] Task created: ${taskId} (type: ${task.type})`);

  // Wait before first poll (docs: 3-5s)
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

// ─── Helper: retry loop for all solve functions ───

async function solveWithRetry(
  key: string,
  task: Record<string, unknown>,
  label: string
): Promise<SolveResult> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await solveSync(key, task);
    if (result.success) return result;

    if (!RETRYABLE_ERRORS.has(result.errorCode || '')) {
      return result; // Fatal error, don't retry
    }

    console.warn(`[CaptchaSolv] ${label} retryable error (attempt ${attempt + 1}/${MAX_RETRIES}): ${result.errorCode}, retrying...`);
    if (attempt < MAX_RETRIES - 1) {
      const delay = result.errorCode === 'ERROR_LIMIT_EXCEEDED' ? 10000 : 3000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { success: false, error: `Max retries exceeded for ${label}`, provider: 'captchasolv' };
}

/**
 * Retry loop using async polling (for long-running Enterprise tasks
 * where sync /solve may 504 via Cloudflare gateway).
 */
async function solveWithRetryAsync(
  key: string,
  task: Record<string, unknown>,
  label: string
): Promise<SolveResult> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await solveAsync(key, task);
    if (result.success) return result;

    if (!RETRYABLE_ERRORS.has(result.errorCode || '')) {
      return result; // Fatal error, don't retry
    }

    // Longer backoff for rate limits (concurrent task limit)
    const isLimitError = result.errorCode === 'ERROR_LIMIT_EXCEEDED';
    const delay = isLimitError ? 10000 : 3000; // 10s for limit, 3s for unsolvable
    console.warn(`[CaptchaSolv] ${label} ${isLimitError ? 'rate limited' : 'unsolvable'} (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay/1000}s...`);
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return { success: false, error: `Max retries exceeded for ${label}`, provider: 'captchasolv' };
}

// ─── Public API ───

const API_KEY = () => process.env.CAPTCHASOLV_API_KEY || '';

export function isConfigured(): boolean {
  return !!API_KEY();
}

/**
 * Solve reCAPTCHA v2 via CaptchaSolv.
 * Per docs: RecaptchaV2TaskProxyless / RecaptchaV2InvisibleTaskProxyless
 * Required: websiteURL, websiteKey
 *
 * ★ When proxy is provided, uses RecaptchaV2Task (with proxy) instead of Proxyless.
 *   This ensures the captcha token is bound to the proxy IP — critical for Enterprise!
 */
export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false,
  proxyUrl?: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  // ★ Use proxied task type when proxy is available — token will be IP-bound to proxy
  let taskType: string;
  if (proxyUrl) {
    taskType = invisible
      ? TASK_TYPES.RECAPTCHA_V2_INVISIBLE_PROXY
      : TASK_TYPES.RECAPTCHA_V2_PROXY;
  } else {
    taskType = invisible
      ? TASK_TYPES.RECAPTCHA_V2_INVISIBLE
      : TASK_TYPES.RECAPTCHA_V2;
  }

  const task: Record<string, unknown> = { type: taskType, websiteURL: pageUrl, websiteKey: siteKey };
  // ★★★ CRITICAL: Use 2captcha-compatible proxy fields, NOT task.proxy = url!
  // The old code did task.proxy = proxyUrl which CaptchaSolv silently ignores → proxyless → IP mismatch → token rejected!
  if (proxyUrl) {
    const proxyFields = parseProxyForCaptcha(proxyUrl);
    if (proxyFields) {
      Object.assign(task, proxyFields);
      console.log(`[CaptchaSolv] Using PROXIED task type (${taskType}) — token will be bound to proxy IP`);
    } else {
      // Proxy parsing failed — fall back to proxyless (risky but better than nothing)
      console.warn(`[CaptchaSolv] Proxy parsing failed — falling back to PROXYLESS (token may be rejected by TeraBox!)`);
      task.type = invisible ? TASK_TYPES.RECAPTCHA_V2_INVISIBLE : TASK_TYPES.RECAPTCHA_V2;
    }
  }

  console.log(`[CaptchaSolv] Solving reCAPTCHA v2${invisible ? ' (invisible)' : ''} for ${pageUrl.substring(0, 60)}... (task type: ${task.type})`);

  // Try sync first (fast when it works), fallback to async if sync fails with timeout/504
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await solveSync(key, task);
    if (result.success) return result;

    // If sync failed (timeout, 504, non-JSON response, parse error), retry with async
    if (result.error?.includes('504') || result.error?.includes('abort') || result.error?.includes('Timeout') ||
        result.error?.includes('non-JSON') || result.error?.includes('Unexpected token')) {
      console.warn(`[CaptchaSolv] Sync failed (${result.error?.substring(0, 50)}), switching to async mode...`);
      return solveWithRetryAsync(key, task, 'reCAPTCHA v2 (async fallback)');
    }

    if (!RETRYABLE_ERRORS.has(result.errorCode || '')) {
      return result; // Fatal error, don't retry
    }

    console.warn(`[CaptchaSolv] reCAPTCHA v2 unsolvable (attempt ${attempt + 1}/${MAX_RETRIES}), retrying...`);
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return { success: false, error: 'Max retries exceeded for reCAPTCHA v2', provider: 'captchasolv' };
}

/**
 * Solve reCAPTCHA v2 Enterprise via CaptchaSolv.
 * ★ TeraBox uses Enterprise reCAPTCHA (errno 460030) — this is the correct type!
 *
 * Per docs: RecaptchaV2EnterpriseTaskProxyless / RecaptchaV2EnterpriseInvisibleTaskProxyless
 * Required: websiteURL, websiteKey
 * Detection: script src uses enterprise.js instead of api.js
 *
 * ★ Uses ASYNC polling (createTask → getTaskResult) because Enterprise v2
 *   can take 40-75s and the sync /solve endpoint may 504 via Cloudflare.
 *   Async avoids the gateway timeout issue.
 *
 * ★★★ When proxy is provided, uses RecaptchaV2EnterpriseTask (with proxy).
 *   This is CRITICAL — Enterprise reCAPTCHA binds the token to the solver's IP.
 *   Solving from CaptchaSolv's IP but submitting from your proxy IP = REJECTED!
 */
export async function solveRecaptchaV2Enterprise(
  siteKey: string,
  pageUrl: string,
  invisible = false,
  proxyUrl?: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  // ★ Use proxied task type when proxy is available
  let taskType: string;
  if (proxyUrl) {
    taskType = invisible
      ? TASK_TYPES.RECAPTCHA_V2_ENTERPRISE_INVISIBLE_PROXY
      : TASK_TYPES.RECAPTCHA_V2_ENTERPRISE_PROXY;
  } else {
    taskType = invisible
      ? TASK_TYPES.RECAPTCHA_V2_ENTERPRISE_INVISIBLE
      : TASK_TYPES.RECAPTCHA_V2_ENTERPRISE;
  }

  const task: Record<string, unknown> = { type: taskType, websiteURL: pageUrl, websiteKey: siteKey };
  // ★★★ CRITICAL: Use 2captcha-compatible proxy fields, NOT task.proxy = url!
  if (proxyUrl) {
    const proxyFields = parseProxyForCaptcha(proxyUrl);
    if (proxyFields) {
      Object.assign(task, proxyFields);
      console.log(`[CaptchaSolv] Using PROXIED Enterprise task type (${taskType}) — token will be bound to proxy IP`);
    } else {
      console.warn(`[CaptchaSolv] Proxy parsing failed — falling back to PROXYLESS Enterprise (token may be rejected!)`);
      task.type = invisible ? TASK_TYPES.RECAPTCHA_V2_ENTERPRISE_INVISIBLE : TASK_TYPES.RECAPTCHA_V2_ENTERPRISE;
    }
  }

  console.log(`[CaptchaSolv] Solving reCAPTCHA v2 Enterprise${invisible ? ' (invisible)' : ''} for ${pageUrl.substring(0, 60)}... (task type: ${task.type}, async mode)`);
  return solveWithRetryAsync(key, task, 'reCAPTCHA v2 Enterprise');
}

/**
 * Solve reCAPTCHA v3 via CaptchaSolv.
 * Per docs: RecaptchaV3TaskProxyless
 * Required: websiteURL, websiteKey
 * Optional: pageAction (string, e.g. "login"), score ("normal" or "high")
 *
 * ★ When proxy is provided, uses RecaptchaV3Task (with proxy) for IP binding.
 */
export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = '',
  proxyUrl?: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  let taskType = proxyUrl ? TASK_TYPES.RECAPTCHA_V3_PROXY : TASK_TYPES.RECAPTCHA_V3;
  const task: Record<string, unknown> = {
    type: taskType,
    websiteURL: pageUrl,
    websiteKey: siteKey,
  };
  // ★★★ CRITICAL: Use 2captcha-compatible proxy fields
  if (proxyUrl) {
    const proxyFields = parseProxyForCaptcha(proxyUrl);
    if (proxyFields) {
      Object.assign(task, proxyFields);
    } else {
      task.type = TASK_TYPES.RECAPTCHA_V3;
    }
  }

  // Per docs: score is "normal" (default) or "high" (for sites requiring score >= 0.7)
  task.score = minScore >= 0.7 ? 'high' : 'normal';

  // Per docs: pageAction should match what the site expects (from grecaptcha.execute)
  if (action) {
    task.pageAction = action;
  }

  console.log(`[CaptchaSolv] Solving reCAPTCHA v3 for ${pageUrl.substring(0, 60)}... (score: ${task.score}, action: ${action || 'default'}, task type: ${task.type})`);
  return solveWithRetry(key, task, 'reCAPTCHA v3');
}

/**
 * Solve reCAPTCHA v3 Enterprise via CaptchaSolv.
 * Per docs: RecaptchaV3EnterpriseTaskProxyless
 * Same params as v3: websiteURL, websiteKey, pageAction, score
 * Detection: enterprise.js + grecaptcha.enterprise.execute()
 *
 * ★ When proxy is provided, uses RecaptchaV3EnterpriseTask (with proxy) for IP binding.
 */
export async function solveRecaptchaV3Enterprise(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = '',
  proxyUrl?: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  const task: Record<string, unknown> = {
    type: proxyUrl ? TASK_TYPES.RECAPTCHA_V3_ENTERPRISE_PROXY : TASK_TYPES.RECAPTCHA_V3_ENTERPRISE,
    websiteURL: pageUrl,
    websiteKey: siteKey,
  };
  // ★★★ CRITICAL: Use 2captcha-compatible proxy fields
  if (proxyUrl) {
    const proxyFields = parseProxyForCaptcha(proxyUrl);
    if (proxyFields) {
      Object.assign(task, proxyFields);
    } else {
      task.type = TASK_TYPES.RECAPTCHA_V3_ENTERPRISE;
    }
  }

  task.score = minScore >= 0.7 ? 'high' : 'normal';
  if (action) task.pageAction = action;

  console.log(`[CaptchaSolv] Solving reCAPTCHA v3 Enterprise for ${pageUrl.substring(0, 60)}... (score: ${task.score}, task type: ${task.type})`);
  return solveWithRetry(key, task, 'reCAPTCHA v3 Enterprise'); // v3 is fast (3-5s), sync is fine
}

/**
 * Solve Cloudflare Turnstile via CaptchaSolv.
 * Per docs: TurnstileTaskProxyless
 * Required: websiteURL, websiteKey
 */
export async function solveTurnstile(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  const task = { type: TASK_TYPES.TURNSTILE, websiteURL: pageUrl, websiteKey: siteKey };

  console.log(`[CaptchaSolv] Solving Turnstile for ${pageUrl.substring(0, 60)}...`);
  return solveWithRetry(key, task, 'Turnstile');
}

/**
 * Solve hCaptcha via CaptchaSolv.
 * Per docs: HCaptchaTaskProxyless
 * Required: websiteURL, websiteKey
 */
export async function solveHCaptcha(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };

  const task = { type: TASK_TYPES.HCAPTCHA, websiteURL: pageUrl, websiteKey: siteKey };

  console.log(`[CaptchaSolv] Solving hCaptcha for ${pageUrl.substring(0, 60)}...`);
  return solveWithRetry(key, task, 'hCaptcha');
}

/**
 * Solve GeeTest v4 via CaptchaSolv.
 * Per docs: GeeTestV4TaskProxyless
 * Required: websiteURL, websiteKey, captchaJs
 * Optional: apiServers, staticServers
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
  return solveWithRetry(key, task, 'GeeTest v4');
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
