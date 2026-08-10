/**
 * NopeCHA Solver — Free, fast, AI-based CAPTCHA solving.
 * https://nopecha.com/
 *
 * ═══════════════════════════════════════════════════════
 * FREE TIER: 100 credits/day (daily reset, never runs out!)
 * ═══════════════════════════════════════════════════════
 *
 * Two APIs with different credit costs:
 *
 * 1. TOKEN API (best for server-side automation):
 *    - POST /v1/token/recaptcha_v2 → GET /v1/token/recaptcha_v2
 *    - You send sitekey + URL → get a valid CAPTCHA token back
 *    - Cost: 20 credits per solve = 5 solves/day on free tier
 *    - No browser needed! Perfect for headless Puppeteer on Render
 *
 * 2. RECOGNITION API (best for image-based solving):
 *    - POST /v1/recognition/recaptcha → GET /v1/recognition/recaptcha
 *    - You send CAPTCHA images → get click coordinates/text back
 *    - Cost: 1 credit per solve = 100 solves/day on free tier
 *    - Requires extracting CAPTCHA images from the page first
 *
 * AUTHENTICATION:
 * - Residential IP: NO API key needed! Your IP IS your key.
 * - Server/datacenter IP: Set NOPECHA_API_KEY env var (get from https://nopecha.com/manage)
 * - You can also whitelist server IPs via NopeCHA Discord
 *
 * STATUS: GET /v1/status?key=API_KEY (or no key for IP-based)
 * Returns: { plan, status, credit, quota, duration, ttl, ... }
 *
 * Set NOPECHA_API_KEY env var to enable (or leave empty for IP-based free tier).
 */

const API_BASE = 'https://api.nopecha.com';
const POLL_INTERVAL = 3000; // 3 seconds (Token API takes ~60s)
const MAX_POLL = 40; // 40 * 3s = 120s max wait (Token API can be slow)
const RECOGNITION_POLL_INTERVAL = 2000; // 2 seconds (Recognition API is faster)
const RECOGNITION_MAX_POLL = 30; // 30 * 2s = 60s max wait
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
  apiUsed?: 'token' | 'recognition';
  creditsUsed?: number;
}

export interface NopechaStatus {
  plan: string;
  status: string;
  credit: number;
  quota: number;
  duration: number; // seconds in cycle (~82800 = 23h)
  lastreset: number; // unix timestamp
  ttl: number; // seconds until next reset
  subscribed: number;
  current_period_start: number;
  current_period_end: number;
}

// ─── Core API ───

async function apiRequest(
  method: string,
  endpoint: string,
  body?: unknown,
  timeout = REQUEST_TIMEOUT
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

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

// ─── Error Handling ───

const NOPECHA_ERRORS: Record<string, string> = {
  'Free Tier Ineligible': 'FREE_TIER_INELIGIBLE',
  'Out of Credit': 'OUT_OF_CREDIT',
  'Rate Limited': 'RATE_LIMITED',
  'Incomplete Job': 'INCOMPLETE_JOB',
  'Invalid API Key': 'INVALID_API_KEY',
  'Invalid Request': 'INVALID_REQUEST',
  'Update Required': 'UPDATE_REQUIRED',
  'Unavailable Feature': 'UNAVAILABLE_FEATURE',
  'Internal Server Error': 'INTERNAL_ERROR',
};

function classifyError(error: string): string {
  return NOPECHA_ERRORS[error] || error;
}

// ─── Token API (20 credits/solve = 5/day free) ───
// This is the PRIMARY API for our use case.
// Just send sitekey + URL → get a valid reCAPTCHA token back.
// No browser rendering needed!

/**
 * Solve reCAPTCHA v2 using Token API.
 * Cost: 20 credits per solve.
 * Free tier: 5 solves/day.
 *
 * Endpoint: POST /v1/token/recaptcha_v2
 * Body: { key?, type: "recaptcha_v2", sitekey, url, invisible? }
 * Returns: { data: "task_id" }
 *
 * Then poll: GET /v1/token/recaptcha_v2?key=KEY&id=TASK_ID
 * Returns: { data: "token_string" } when solved
 */
async function solveTokenRecaptchaV2(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  const startTime = Date.now();
  let taskId: string;

  try {
    // Submit token job
    const submitBody: Record<string, unknown> = {
      type: 'recaptcha_v2',
      sitekey: siteKey,
      url: pageUrl,
    };
    if (apiKey) submitBody.key = apiKey;
    if (invisible) submitBody.invisible = true;

    const submitRes = await apiRequest('POST', '/v1/token/recaptcha_v2', submitBody);

    if (submitRes.error) {
      const errorCode = classifyError(submitRes.error);
      console.error(`[NopeCHA Token] Submit failed: ${submitRes.error} (${errorCode})`);
      return { success: false, error: `NopeCHA Token submit: ${submitRes.error}`, errorCode, apiUsed: 'token' };
    }

    taskId = submitRes.data || submitRes;
    console.log(`[NopeCHA Token] reCAPTCHA v2 task submitted: ${taskId}`);
  } catch (error) {
    return { success: false, error: (error as Error).message, apiUsed: 'token' };
  }

  // Wait before first poll (Token API takes ~60s)
  await new Promise(r => setTimeout(r, POLL_INTERVAL));

  // Poll for result
  for (let attempt = 0; attempt < MAX_POLL; attempt++) {
    try {
      const pollUrl = apiKey
        ? `/v1/token/recaptcha_v2?key=${apiKey}&id=${taskId}`
        : `/v1/token/recaptcha_v2?id=${taskId}`;

      const res = await apiRequest('GET', pollUrl);

      // Solved!
      if (res.data) {
        const solveTime = (Date.now() - startTime) / 1000;
        console.log(`[NopeCHA Token] reCAPTCHA v2 SOLVED! Time: ${solveTime.toFixed(1)}s`);
        return {
          success: true,
          solution: { token: res.data, gRecaptchaResponse: res.data },
          solveTime,
          taskId,
          provider: 'nopecha',
          apiUsed: 'token',
          creditsUsed: 20,
        };
      }

      // Error
      if (res.error) {
        const errorCode = classifyError(res.error);
        if (errorCode === 'INCOMPLETE_JOB') {
          // Still processing — keep polling
          if (attempt < MAX_POLL - 1) {
            await new Promise(r => setTimeout(r, POLL_INTERVAL));
          }
          continue;
        }
        console.error(`[NopeCHA Token] Poll error: ${res.error} (${errorCode})`);
        return { success: false, error: res.error, errorCode, taskId, apiUsed: 'token' };
      }

      // Still processing
      if (attempt < MAX_POLL - 1) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    } catch (error) {
      console.error(`[NopeCHA Token] Poll exception (attempt ${attempt + 1}): ${(error as Error).message}`);
      if (attempt < MAX_POLL - 1) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
      }
    }
  }

  return {
    success: false,
    error: `Timeout after ${MAX_POLL * POLL_INTERVAL / 1000}s`,
    taskId,
    apiUsed: 'token',
  };
}

/**
 * Solve reCAPTCHA v3 using Token API.
 * Cost: 20 credits per solve.
 * Free tier: 5 solves/day.
 *
 * Endpoint: POST /v1/token/recaptcha_v3
 */
async function solveTokenRecaptchaV3(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = ''
): Promise<SolveResult> {
  const startTime = Date.now();
  let taskId: string;

  try {
    const submitBody: Record<string, unknown> = {
      type: 'recaptcha_v3',
      sitekey: siteKey,
      url: pageUrl,
      min_score: minScore,
    };
    if (apiKey) submitBody.key = apiKey;
    if (action) submitBody.action = action;

    const submitRes = await apiRequest('POST', '/v1/token/recaptcha_v3', submitBody);

    if (submitRes.error) {
      const errorCode = classifyError(submitRes.error);
      return { success: false, error: `NopeCHA Token v3 submit: ${submitRes.error}`, errorCode, apiUsed: 'token' };
    }

    taskId = submitRes.data || submitRes;
    console.log(`[NopeCHA Token] reCAPTCHA v3 task submitted: ${taskId}`);
  } catch (error) {
    return { success: false, error: (error as Error).message, apiUsed: 'token' };
  }

  await new Promise(r => setTimeout(r, POLL_INTERVAL));

  for (let attempt = 0; attempt < MAX_POLL; attempt++) {
    try {
      const pollUrl = apiKey
        ? `/v1/token/recaptcha_v3?key=${apiKey}&id=${taskId}`
        : `/v1/token/recaptcha_v3?id=${taskId}`;

      const res = await apiRequest('GET', pollUrl);

      if (res.data) {
        const solveTime = (Date.now() - startTime) / 1000;
        console.log(`[NopeCHA Token] reCAPTCHA v3 SOLVED! Time: ${solveTime.toFixed(1)}s`);
        return {
          success: true,
          solution: { token: res.data, gRecaptchaResponse: res.data },
          solveTime,
          taskId,
          provider: 'nopecha',
          apiUsed: 'token',
          creditsUsed: 20,
        };
      }

      if (res.error) {
        const errorCode = classifyError(res.error);
        if (errorCode === 'INCOMPLETE_JOB') {
          if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
          continue;
        }
        return { success: false, error: res.error, errorCode, taskId, apiUsed: 'token' };
      }

      if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
    } catch (error) {
      if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }

  return { success: false, error: `Timeout after ${MAX_POLL * POLL_INTERVAL / 1000}s`, taskId, apiUsed: 'token' };
}

// ─── Recognition API (1 credit/solve = 100/day free) ───
// Alternative: send CAPTCHA images → get click coordinates back.
// More credits-efficient but requires extracting images from page.

/**
 * Solve reCAPTCHA using Recognition API (image-based).
 * Cost: 1 credit per solve. Free tier: 100 solves/day.
 *
 * Endpoint: POST /v1/recognition/recaptcha
 * Body: { key?, type: "recaptcha", task, grid, image_data: [base64...] }
 *
 * This requires the actual CAPTCHA images extracted from the page.
 * Use this when you have images but need click coordinates.
 */
async function solveRecognitionRecaptcha(
  apiKey: string,
  task: string,
  grid: string | null,
  imageData: string[]
): Promise<SolveResult> {
  const startTime = Date.now();
  let taskId: string;

  try {
    const submitBody: Record<string, unknown> = {
      type: 'recaptcha',
      task,
      grid,
      image_data: imageData,
    };
    if (apiKey) submitBody.key = apiKey;

    const submitRes = await apiRequest('POST', '/v1/recognition/recaptcha', submitBody);

    if (submitRes.error) {
      const errorCode = classifyError(submitRes.error);
      return { success: false, error: `NopeCHA Recognition submit: ${submitRes.error}`, errorCode, apiUsed: 'recognition' };
    }

    taskId = submitRes.data || submitRes;
    console.log(`[NopeCHA Recognition] reCAPTCHA task submitted: ${taskId}`);
  } catch (error) {
    return { success: false, error: (error as Error).message, apiUsed: 'recognition' };
  }

  await new Promise(r => setTimeout(r, RECOGNITION_POLL_INTERVAL));

  for (let attempt = 0; attempt < RECOGNITION_MAX_POLL; attempt++) {
    try {
      const pollUrl = apiKey
        ? `/v1/recognition/recaptcha?key=${apiKey}&id=${taskId}`
        : `/v1/recognition/recaptcha?id=${taskId}`;

      const res = await apiRequest('GET', pollUrl);

      if (res.data) {
        const solveTime = (Date.now() - startTime) / 1000;
        console.log(`[NopeCHA Recognition] SOLVED! Time: ${solveTime.toFixed(1)}s`);
        return {
          success: true,
          solution: { clicks: JSON.stringify(res.data), token: res.data },
          solveTime,
          taskId,
          provider: 'nopecha',
          apiUsed: 'recognition',
          creditsUsed: 1,
        };
      }

      if (res.error) {
        const errorCode = classifyError(res.error);
        if (errorCode === 'INCOMPLETE_JOB') {
          if (attempt < RECOGNITION_MAX_POLL - 1) await new Promise(r => setTimeout(r, RECOGNITION_POLL_INTERVAL));
          continue;
        }
        return { success: false, error: res.error, errorCode, taskId, apiUsed: 'recognition' };
      }

      if (attempt < RECOGNITION_MAX_POLL - 1) await new Promise(r => setTimeout(r, RECOGNITION_POLL_INTERVAL));
    } catch (error) {
      if (attempt < RECOGNITION_MAX_POLL - 1) await new Promise(r => setTimeout(r, RECOGNITION_POLL_INTERVAL));
    }
  }

  return { success: false, error: `Timeout after ${RECOGNITION_MAX_POLL * RECOGNITION_POLL_INTERVAL / 1000}s`, taskId, apiUsed: 'recognition' };
}

// ─── hCaptcha Token API ───

/**
 * Solve hCaptcha using Token API.
 * Cost: 10 credits per solve. Free tier: 10 solves/day.
 */
async function solveTokenHCaptcha(
  apiKey: string,
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const startTime = Date.now();
  let taskId: string;

  try {
    const submitBody: Record<string, unknown> = {
      type: 'hcaptcha',
      sitekey: siteKey,
      url: pageUrl,
    };
    if (apiKey) submitBody.key = apiKey;

    const submitRes = await apiRequest('POST', '/v1/token/hcaptcha', submitBody);

    if (submitRes.error) {
      const errorCode = classifyError(submitRes.error);
      return { success: false, error: `NopeCHA hCaptcha submit: ${submitRes.error}`, errorCode, apiUsed: 'token' };
    }

    taskId = submitRes.data || submitRes;
    console.log(`[NopeCHA Token] hCaptcha task submitted: ${taskId}`);
  } catch (error) {
    return { success: false, error: (error as Error).message, apiUsed: 'token' };
  }

  await new Promise(r => setTimeout(r, POLL_INTERVAL));

  for (let attempt = 0; attempt < MAX_POLL; attempt++) {
    try {
      const pollUrl = apiKey
        ? `/v1/token/hcaptcha?key=${apiKey}&id=${taskId}`
        : `/v1/token/hcaptcha?id=${taskId}`;

      const res = await apiRequest('GET', pollUrl);

      if (res.data) {
        const solveTime = (Date.now() - startTime) / 1000;
        return {
          success: true,
          solution: { token: res.data },
          solveTime,
          taskId,
          provider: 'nopecha',
          apiUsed: 'token',
          creditsUsed: 10,
        };
      }

      if (res.error) {
        const errorCode = classifyError(res.error);
        if (errorCode === 'INCOMPLETE_JOB') {
          if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
          continue;
        }
        return { success: false, error: res.error, errorCode, taskId, apiUsed: 'token' };
      }

      if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
    } catch (error) {
      if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }

  return { success: false, error: 'Timeout', taskId, apiUsed: 'token' };
}

// ─── Turnstile Token API ───

/**
 * Solve Cloudflare Turnstile using Token API.
 * Cost: 1 credit per solve. Free tier: 100 solves/day.
 */
async function solveTokenTurnstile(
  apiKey: string,
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const startTime = Date.now();
  let taskId: string;

  try {
    const submitBody: Record<string, unknown> = {
      type: 'turnstile',
      sitekey: siteKey,
      url: pageUrl,
    };
    if (apiKey) submitBody.key = apiKey;

    const submitRes = await apiRequest('POST', '/v1/token/turnstile', submitBody);

    if (submitRes.error) {
      const errorCode = classifyError(submitRes.error);
      return { success: false, error: `NopeCHA Turnstile submit: ${submitRes.error}`, errorCode, apiUsed: 'token' };
    }

    taskId = submitRes.data || submitRes;
    console.log(`[NopeCHA Token] Turnstile task submitted: ${taskId}`);
  } catch (error) {
    return { success: false, error: (error as Error).message, apiUsed: 'token' };
  }

  await new Promise(r => setTimeout(r, POLL_INTERVAL));

  for (let attempt = 0; attempt < MAX_POLL; attempt++) {
    try {
      const pollUrl = apiKey
        ? `/v1/token/turnstile?key=${apiKey}&id=${taskId}`
        : `/v1/token/turnstile?id=${taskId}`;

      const res = await apiRequest('GET', pollUrl);

      if (res.data) {
        const solveTime = (Date.now() - startTime) / 1000;
        return {
          success: true,
          solution: { token: res.data },
          solveTime,
          taskId,
          provider: 'nopecha',
          apiUsed: 'token',
          creditsUsed: 1,
        };
      }

      if (res.error) {
        const errorCode = classifyError(res.error);
        if (errorCode === 'INCOMPLETE_JOB') {
          if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
          continue;
        }
        return { success: false, error: res.error, errorCode, taskId, apiUsed: 'token' };
      }

      if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
    } catch (error) {
      if (attempt < MAX_POLL - 1) await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
  }

  return { success: false, error: 'Timeout', taskId, apiUsed: 'token' };
}

// ─── Public API ───

const API_KEY = () => process.env.NOPECHA_API_KEY || '';

/**
 * Check if NopeCHA is configured.
 * Returns true if API key is set OR if we want to try IP-based free tier.
 *
 * IMPORTANT: On residential IP, NopeCHA works WITHOUT an API key!
 * So we always return true and let the API tell us if it's blocked.
 */
export function isConfigured(): boolean {
  // Always try — NopeCHA works on residential IP without API key
  // If it fails (server IP blocked), the solver will fall back to next provider
  return true;
}

/**
 * Check if an explicit API key is set (for server/datacenter IPs).
 */
export function hasApiKey(): boolean {
  return !!API_KEY();
}

/**
 * Solve reCAPTCHA v2 via NopeCHA.
 * Uses Token API: 20 credits/solve = 5 solves/day on free tier.
 * Falls back to Recognition API if OUT_OF_CREDIT on Token API.
 */
export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  const key = API_KEY();

  // Try Token API first (simplest, no browser needed)
  console.log(`[NopeCHA] Solving reCAPTCHA v2 for ${pageUrl.substring(0, 60)}... (key: ${key ? 'explicit' : 'IP-based'})`);
  const tokenResult = await solveTokenRecaptchaV2(key, siteKey, pageUrl, invisible);

  if (tokenResult.success) return tokenResult;

  // If Token API ran out of credits, try Recognition API
  if (tokenResult.errorCode === 'OUT_OF_CREDIT') {
    console.warn('[NopeCHA] Token API out of credits — Recognition API needs images (skipping)');
    // Recognition API requires images — we can't use it without a browser
    // Return the original error
  }

  // If free tier ineligible (server IP), return the error so solver can try next provider
  if (tokenResult.errorCode === 'FREE_TIER_INELIGIBLE') {
    console.warn('[NopeCHA] Free tier blocked (non-residential IP). Set NOPECHA_API_KEY or whitelist IP on NopeCHA Discord.');
  }

  return tokenResult;
}

/**
 * Solve reCAPTCHA v3 via NopeCHA.
 * Uses Token API: 20 credits/solve.
 */
export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = ''
): Promise<SolveResult> {
  const key = API_KEY();
  console.log(`[NopeCHA] Solving reCAPTCHA v3 for ${pageUrl.substring(0, 60)}...`);
  return solveTokenRecaptchaV3(key, siteKey, pageUrl, minScore, action);
}

/**
 * Solve hCaptcha via NopeCHA.
 * Uses Token API: 10 credits/solve.
 */
export async function solveHCaptcha(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  console.log(`[NopeCHA] Solving hCaptcha for ${pageUrl.substring(0, 60)}...`);
  return solveTokenHCaptcha(key, siteKey, pageUrl);
}

/**
 * Solve Cloudflare Turnstile via NopeCHA.
 * Uses Token API: 1 credit/solve = 100/day on free tier!
 */
export async function solveTurnstile(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  const key = API_KEY();
  console.log(`[NopeCHA] Solving Turnstile for ${pageUrl.substring(0, 60)}...`);
  return solveTokenTurnstile(key, siteKey, pageUrl);
}

/**
 * Solve reCAPTCHA using Recognition API (image-based).
 * Cost: 1 credit/solve = 100/day on free tier!
 * Requires actual CAPTCHA images (base64 encoded).
 *
 * @param task - Description of what to click (e.g., "Select all images with traffic lights")
 * @param grid - Grid size: "3x3" for 9 tiles, "4x4" for 16 tiles, null if unknown
 * @param imageData - Array of base64-encoded CAPTCHA images
 */
export async function solveRecognitionRecaptchaV2(
  task: string,
  grid: string | null,
  imageData: string[]
): Promise<SolveResult> {
  const key = API_KEY();
  return solveRecognitionRecaptcha(key, task, grid, imageData);
}

/**
 * Get NopeCHA account status.
 * WITHOUT API key: Returns status for your IP (free tier).
 * WITH API key: Returns status for that key's account.
 *
 * GET /v1/status?key=API_KEY
 * Returns: { plan, status, credit, quota, duration, ttl, subscribed, ... }
 */
export async function getStatus(): Promise<NopechaStatus & { error?: string }> {
  try {
    const key = API_KEY();
    const url = key
      ? `${API_BASE}/v1/status?key=${key}`
      : `${API_BASE}/v1/status`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });
    const data = await res.json();

    if (data.error) {
      return {
        plan: 'Unknown',
        status: 'Error',
        credit: 0,
        quota: 0,
        duration: 0,
        lastreset: 0,
        ttl: 0,
        subscribed: 0,
        current_period_start: 0,
        current_period_end: 0,
        error: data.error,
      };
    }

    return {
      plan: data.plan || 'Free',
      status: data.status || 'Unknown',
      credit: data.credit ?? 0,
      quota: data.quota ?? 0,
      duration: data.duration ?? 0,
      lastreset: data.lastreset ?? 0,
      ttl: data.ttl ?? 0,
      subscribed: data.subscribed ?? 0,
      current_period_start: data.current_period_start ?? 0,
      current_period_end: data.current_period_end ?? 0,
    };
  } catch (error) {
    return {
      plan: 'Unknown',
      status: 'Error',
      credit: 0,
      quota: 0,
      duration: 0,
      lastreset: 0,
      ttl: 0,
      subscribed: 0,
      current_period_start: 0,
      current_period_end: 0,
      error: (error as Error).message,
    };
  }
}

/**
 * Get remaining credits (backwards compat with solver.ts).
 */
export async function getBalance(): Promise<{ balance: number; error?: string }> {
  const status = await getStatus();
  return { balance: status.credit, error: status.error };
}
