/**
 * 2Captcha Solver — Direct API v2 implementation (fallback provider).
 * https://2captcha.com/api-docs
 *
 * Paid service. ~$1-3/1000 solves. No free tier.
 * Set TWOCAPTCHA_API_KEY env var to enable.
 *
 * Used as fallback when NoCaptchaAI is not configured or fails.
 */

const API_BASE = 'https://api.2captcha.com';
const POLL_INTERVAL = 5000; // 5 seconds
const MAX_POLL = 24; // 24 * 5s = 120s
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
      throw new Error(`2Captcha API ${res.status}: ${errText}`);
    }
    return await res.json();
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

async function createTask(apiKey: string, task: Record<string, unknown>): Promise<string> {
  const res = await apiPost('/createTask', { clientKey: apiKey, task, languagePool: 'en' });
  if (res.errorId && res.errorId !== 0) {
    throw new Error(`2Captcha createTask error ${res.errorId}: ${res.errorCode}`);
  }
  return res.taskId;
}

async function getTaskResult(apiKey: string, taskId: string): Promise<SolveResult> {
  const res = await apiPost('/getTaskResult', { clientKey: apiKey, taskId });
  if (res.errorId && res.errorId !== 0) {
    return { success: false, error: res.errorDescription || res.errorCode, errorCode: res.errorCode, taskId };
  }
  if (res.status === 'ready') {
    return { success: true, solution: res.solution, cost: res.cost, solveTime: res.endTime && res.createTime ? res.endTime - res.createTime : undefined, taskId };
  }
  return { success: false, error: 'processing', taskId };
}

async function solveWithPolling(apiKey: string, task: Record<string, unknown>, maxAttempts = MAX_POLL, pollInterval = POLL_INTERVAL): Promise<SolveResult> {
  let taskId: string;
  try {
    taskId = await createTask(apiKey, task);
    console.log(`[2Captcha] Task created: ${taskId} (type: ${task.type})`);
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }

  await new Promise(r => setTimeout(r, pollInterval));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await getTaskResult(apiKey, taskId);
      if (result.success) return result;
      if (result.error !== 'processing') return result;
      if (attempt < maxAttempts - 1) await new Promise(r => setTimeout(r, pollInterval));
    } catch (error) {
      if (attempt < maxAttempts - 1) await new Promise(r => setTimeout(r, pollInterval));
    }
  }
  return { success: false, error: `Timeout after ${maxAttempts * pollInterval / 1000}s`, taskId };
}

// ─── Public API ───

const API_KEY = () => process.env.TWOCAPTCHA_API_KEY || '';

export function isConfigured(): boolean { return !!API_KEY(); }

export async function solveRecaptchaV2(siteKey: string, pageUrl: string, invisible = false): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'TWOCAPTCHA_API_KEY not set' };
  return solveWithPolling(key, { type: 'RecaptchaV2TaskProxyless', websiteURL: pageUrl, websiteKey: siteKey, isInvisible: invisible });
}

export async function solveRecaptchaV3(siteKey: string, pageUrl: string, minScore = 0.3, action = ''): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'TWOCAPTCHA_API_KEY not set' };
  const task: Record<string, unknown> = { type: 'RecaptchaV3TaskProxyless', websiteURL: pageUrl, websiteKey: siteKey, minScore };
  if (action) task.pageAction = action;
  return solveWithPolling(key, task);
}

export async function solveTurnstile(siteKey: string, pageUrl: string): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'TWOCAPTCHA_API_KEY not set' };
  return solveWithPolling(key, { type: 'TurnstileTaskProxyless', websiteURL: pageUrl, websiteKey: siteKey });
}

export async function solveImageCaptcha(imageBase64: string, options?: { phrase?: boolean; caseSensitive?: boolean; numeric?: number; minLength?: number; maxLength?: number; comment?: string }): Promise<SolveResult> {
  const key = API_KEY();
  if (!key) return { success: false, error: 'TWOCAPTCHA_API_KEY not set' };
  const task: Record<string, unknown> = { type: 'ImageToTextTask', body: imageBase64 };
  if (options?.phrase) task.phrase = true;
  if (options?.caseSensitive) task.case = true;
  if (options?.numeric) task.numeric = options.numeric;
  if (options?.minLength) task.minLength = options.minLength;
  if (options?.maxLength) task.maxLength = options.maxLength;
  return solveWithPolling(key, task);
}

export async function getBalance(): Promise<{ balance: number; error?: string }> {
  const key = API_KEY();
  if (!key) return { balance: 0, error: 'TWOCAPTCHA_API_KEY not set' };
  try {
    const res = await apiPost('/getBalance', { clientKey: key });
    if (res.errorId && res.errorId !== 0) return { balance: 0, error: res.errorCode };
    return { balance: res.balance };
  } catch (error) {
    return { balance: 0, error: (error as Error).message };
  }
}
