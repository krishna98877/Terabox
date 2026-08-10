/**
 * CAPTCHA Solver Module — CaptchaSolv (primary & only provider).
 *
 * ═══════════════════════════════════════════════════════════════════
 * CaptchaSolv: Fast & reliable, 100 FREE solves/day
 * ═══════════════════════════════════════════════════════════════════
 *
 * - 2captcha-compatible API format
 * - Sync endpoint: POST /solve (handles polling internally)
 * - 10+ captcha types, average solve time < 15s
 * - reCAPTCHA v2 (7-40s), v3 (3-5s), Turnstile (4-7s), hCaptcha, GeeTest v4
 * - Get API key via Telegram bot or Discord /panel command
 * - Set CAPTCHASOLV_API_KEY env var
 *
 * Docs: https://docs.captchasolv.com/
 * Base URL: https://v1.captchasolv.com
 */

import {
  solveRecaptchaV2 as captchasolvSolveV2,
  solveRecaptchaV3 as captchasolvSolveV3,
  solveTurnstile as captchasolvSolveTurnstile,
  solveHCaptcha as captchasolvSolveHCaptcha,
  solveGeeTestV4 as captchasolvSolveGeeTestV4,
  solveCustom as captchasolvSolveCustom,
  isConfigured as isCaptchaSolvConfigured,
  getBalance as captchasolvGetBalance,
  healthCheck as captchasolvHealthCheck,
  getSupportedTypes as captchasolvGetTypes,
  TASK_TYPES,
} from './captchasolv';

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
  provider?: string;
}

// ─── Provider Detection ───

export function isCaptchaConfigured(): boolean {
  return isCaptchaSolvConfigured();
}

export function getActiveProvider(): 'captchasolv' | null {
  return isCaptchaSolvConfigured() ? 'captchasolv' : null;
}

// ─── reCAPTCHA v2 ───

export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveV2(siteKey, pageUrl, invisible);
}

// ─── reCAPTCHA v3 ───

export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = ''
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveV3(siteKey, pageUrl, minScore, action);
}

// ─── Cloudflare Turnstile ───

export async function solveTurnstile(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveTurnstile(siteKey, pageUrl);
}

// ─── hCaptcha ───

export async function solveHCaptcha(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveHCaptcha(siteKey, pageUrl);
}

// ─── Image CAPTCHA (not supported by CaptchaSolv) ───

export async function solveImageCaptcha(
  _imageBase64: string,
  _options?: { phrase?: boolean; caseSensitive?: boolean; numeric?: number; minLength?: number; maxLength?: number; comment?: string }
): Promise<SolveResult> {
  return { success: false, error: 'Image CAPTCHA not supported by CaptchaSolv' };
}

// ─── Balance / Status ───

export async function getBalance(): Promise<{ balance: number; error?: string; provider?: string }> {
  const result = await captchasolvGetBalance();
  return { ...result, provider: 'captchasolv' };
}

export async function getHealth() {
  return captchasolvHealthCheck();
}

export async function getSupportedTypes() {
  return captchasolvGetTypes();
}

// ─── Convenience: solve reCAPTCHA (tries v2 then v3) ───

export async function solveRecaptcha(siteKey: string, pageUrl: string): Promise<string | null> {
  if (!isCaptchaSolvConfigured()) {
    console.warn('[Captcha] CAPTCHASOLV_API_KEY not set — CAPTCHA solving disabled');
    return null;
  }

  console.log(`[Captcha] Solving reCAPTCHA for ${pageUrl.substring(0, 60)}... (provider: captchasolv)`);

  try {
    // Try v2 first (most common for TeraBox)
    const v2 = await solveRecaptchaV2(siteKey, pageUrl);
    if (v2.success && v2.solution?.token) {
      console.log(`[Captcha] v2 solved${v2.solveTime ? ` in ${v2.solveTime.toFixed(1)}s` : ''}${v2.cost ? ` (cost: ${v2.cost})` : ''}`);
      return v2.solution.token;
    }
    if (v2.success && v2.solution?.gRecaptchaResponse) {
      console.log(`[Captcha] v2 solved${v2.solveTime ? ` in ${v2.solveTime.toFixed(1)}s` : ''}`);
      return v2.solution.gRecaptchaResponse;
    }

    // Try v3 fallback
    const v3 = await solveRecaptchaV3(siteKey, pageUrl, 0.3, 'register');
    if (v3.success && v3.solution?.token) {
      console.log(`[Captcha] v3 solved${v3.solveTime ? ` in ${v3.solveTime.toFixed(1)}s` : ''}`);
      return v3.solution.token;
    }
    if (v3.success && v3.solution?.gRecaptchaResponse) {
      console.log(`[Captcha] v3 solved${v3.solveTime ? ` in ${v3.solveTime.toFixed(1)}s` : ''}`);
      return v3.solution.gRecaptchaResponse;
    }

    console.error(`[Captcha] Both v2 and v3 failed. v2: ${v2.error}, v3: ${v3.error}`);
    return null;
  } catch (err) {
    console.error(`[Captcha] Fatal error: ${(err as Error).message}`);
    return null;
  }
}

// ─── Backwards compat ───
export const is2CaptchaConfigured = isCaptchaConfigured;
export { TASK_TYPES };
