/**
 * NopeCHA Solver — Free, fast, AI-based CAPTCHA solving.
 * https://nopecha.com/
 *
 * FREE TIER: 100 solves/day (daily reset, never runs out!)
 * - reCAPTCHA v2/v3, hCaptcha, GeeTest, FunCAPTCHA, Text CAPTCHA
 * - API: POST /v1/recaptcha → GET /v1/recaptcha (simple submit/poll)
 * - Speed: 2-10 seconds typical
 * - Paid: $4.99/mo for 2000/day
 *
 * Set NOPECHA_API_KEY env var to enable.
 * Get your key at: https://nopecha.com/ (sign up → dashboard)
 */

const API_BASE = 'https://api.nopecha.com';
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLL = 30; // 30 * 2s = 60s max wait
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
  provider?: string;
}

// ─── Core API ───

async function apiRequest(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${API_BASE}${endpoint}`, opts);
    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`NopeCHA API ${res.status}: ${errText}`);
    }

    return await res.json();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// ─── Solve reCAPTCHA v2 ───

/**
 * Submit reCAPTCHA v2 task to NopeCHA.
 * Returns a task ID to poll for the result.
 */
async function submitRecaptchaV2(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<string> {
  const res = await apiRequest('POST', '/v1/recaptcha', {
    key: apiKey,
    type: 'recaptcha_v2',
    site_key: siteKey,
    url: pageUrl,
    ...(invisible && { invisible: true }),
  });

  // NopeCHA returns { data: "task_id" } on submit
  if (res.error) {
    throw new Error(`NopeCHA submit error: ${res.error}`);
  }

  return res.data || res;
}

/**
 * Retrieve solved reCAPTCHA v2 result.
 */
async function retrieveRecaptcha(
  apiKey: string,
  taskId: string
): Promise<{ solved: boolean; token?: string; error?: string }> {
  const res = await apiRequest('GET', `/v1/recaptcha?key=${apiKey}&id=${taskId}`);

  if (res.error) {
    // Check for specific NopeCHA errors
    if (res.error === 'Free Tier Ineligible') {
      return { solved: false, error: 'FREE_TIER_INELIGIBLE' };
    }
    if (res.error === 'Out of Credit') {
      return { solved: false, error: 'OUT_OF_CREDIT' };
    }
    if (res.error === 'Rate Limited') {
      return { solved: false, error: 'RATE_LIMITED' };
    }
    return { solved: false, error: res.error };
  }

  // Result ready: { data: "token_string" }
  if (res.data) {
    return { solved: true, token: res.data };
  }

  // Still processing
  return { solved: false };
}

// ─── Solve with Polling ───

async function solveWithPolling(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
  type: 'recaptcha_v2' | 'recaptcha_v3',
  extra?: Record<string, unknown>
): Promise<SolveResult> {
  let taskId: string;
  const startTime = Date.now();

  try {
    // Submit the task
    const submitRes = await apiRequest('POST', '/v1/recaptcha', {
      key: apiKey,
      type,
      site_key: siteKey,
      url: pageUrl,
      ...extra,
    });

    if (submitRes.error) {
      const errorCode = submitRes.error;
      return {
        success: false,
        error: `NopeCHA submit: ${errorCode}`,
        errorCode,
      };
    }

    taskId = submitRes.data || submitRes;
    console.log(`[NopeCHA] Task submitted: ${taskId} (type: ${type})`);
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  // Wait before first poll
  await new Promise(r => setTimeout(r, POLL_INTERVAL));

  // Poll for result
  for (let attempt = 0; attempt < MAX_POLL; attempt++) {
    try {
      const result = await retrieveRecaptcha(apiKey, taskId);

      if (result.solved && result.token) {
        const solveTime = (Date.now() - startTime) / 1000;
        console.log(`[NopeCHA] Solved! Task ${taskId}, time: ${solveTime.toFixed(1)}s`);
        return {
          success: true,
          solution: { token: result.token, gRecaptchaResponse: result.token },
          solveTime,
          taskId,
          provider: 'nopecha',
        };
      }

      if (result.error && result.error !== 'processing') {
        return {
          success: false,
          error: result.error,
          errorCode: result.error,
          taskId,
        };
      }

      // Still processing — wait and retry
      if (attempt < MAX_POLL - 1) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    } catch (error) {
      console.error(`[NopeCHA] Poll error (attempt ${attempt + 1}): ${(error as Error).message}`);
      if (attempt < MAX_POLL - 1) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    }
  }

  return {
    success: false,
    error: `Timeout after ${MAX_POLL * POLL_INTERVAL / 1000}s`,
    taskId,
  };
}

// ─── Public API ───

const API_KEY = () => process.env.NOPECHA_API_KEY || '';

export function isConfigured(): boolean {
  return !!API_KEY();
}

/**
 * Solve reCAPTCHA v2 via NopeCHA.
 * Free: 100 solves/day.
 */
export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'NOPECHA_API_KEY not set' };

  return solveWithPolling(key, siteKey, pageUrl, 'recaptcha_v2', {
    ...(invisible && { invisible: true }),
  });
}

/**
 * Solve reCAPTCHA v3 via NopeCHA.
 * Free: 100 solves/day.
 */
export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  _action = ''
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'NOPECHA_API_KEY not set' };

  return solveWithPolling(key, siteKey, pageUrl, 'recaptcha_v3', {
    min_score: minScore,
  });
}

/**
 * Solve hCaptcha via NopeCHA.
 * Free: 100 solves/day.
 */
export async function solveHCaptcha(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'NOPECHA_API_KEY not set' };

  const startTime = Date.now();
  try {
    const submitRes = await apiRequest('POST', '/v1/hcaptcha', {
      key,
      type: 'hcaptcha',
      site_key: siteKey,
      url: pageUrl,
    });

    if (submitRes.error) {
      return { success: false, error: `NopeCHA hCaptcha: ${submitRes.error}` };
    }

    const taskId = submitRes.data || submitRes;
    console.log(`[NopeCHA] hCaptcha task submitted: ${taskId}`);

    // Poll
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    for (let attempt = 0; attempt < MAX_POLL; attempt++) {
      const res = await apiRequest('GET', `/v1/hcaptcha?key=${key}&id=${taskId}`);
      if (res.data) {
        const solveTime = (Date.now() - startTime) / 1000;
        return {
          success: true,
          solution: { token: res.data },
          solveTime,
          taskId,
          provider: 'nopecha',
        };
      }
      if (res.error && res.error !== 'processing') {
        return { success: false, error: res.error, taskId };
      }
      if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    return { success: false, error: 'Timeout', taskId };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Solve normal image/text CAPTCHA via NopeCHA.
 */
export async function solveImageCaptcha(
  imageBase64: string
): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'NOPECHA_API_KEY not set' };

  try {
    const submitRes = await apiRequest('POST', '/v1/token', {
      key,
      type: 'text',
      image: imageBase64,
    });

    if (submitRes.error) {
      return { success: false, error: `NopeCHA text: ${submitRes.error}` };
    }

    const taskId = submitRes.data || submitRes;

    // Poll
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
    for (let attempt = 0; attempt < MAX_POLL; attempt++) {
      const res = await apiRequest('GET', `/v1/token?key=${key}&id=${taskId}`);
      if (res.data) {
        return {
          success: true,
          solution: { token: res.data },
          taskId,
          provider: 'nopecha',
        };
      }
      if (res.error && res.error !== 'processing') {
        return { success: false, error: res.error, taskId };
      }
      if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    return { success: false, error: 'Timeout', taskId };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Get account status (credits remaining, plan info).
 */
export async function getBalance(): Promise<{ balance: number; error?: string }> {
  const key = API_KEY();
  if (!key) return { balance: 0, error: 'NOPECHA_API_KEY not set' };

  try {
    const res = await fetch(`${API_BASE}/v1/status?key=${key}`, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const data = await res.json();

    if (data.error) {
      return { balance: 0, error: data.error };
    }

    return {
      balance: data.credit ?? 0,
    };
  } catch (error) {
    return { balance: 0, error: (error as Error).message };
  }
}
