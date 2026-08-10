/**
 * CAPTCHA Solver Module — CaptchaSolv (primary & only provider).
 *
 * ═══════════════════════════════════════════════════════════════════
 * CaptchaSolv: Fast & reliable, 100 FREE solves/day
 * ═══════════════════════════════════════════════════════════════════
 *
 * Per official docs (https://docs.captchasolv.com/):
 * - 2captcha-compatible API format
 * - Sync endpoint: POST /solve (handles polling internally)
 * - 10+ captcha types, average solve time < 15s
 * - reCAPTCHA v2/v3, v2 Enterprise/v3 Enterprise, Turnstile, hCaptcha, GeeTest v4
 * - Get API key via Telegram bot or Discord /panel command
 * - Set CAPTCHASOLV_API_KEY env var
 * - waitForSlot: true queues instead of failing on rate limits
 * - Token expiry: ~2 min for reCAPTCHA — use immediately!
 *
 * Docs: https://docs.captchasolv.com/
 * Base URL: https://v1.captchasolv.com
 */

import {
  solveRecaptchaV2 as captchasolvSolveV2,
  solveRecaptchaV2Enterprise as captchasolvSolveV2Enterprise,
  solveRecaptchaV3 as captchasolvSolveV3,
  solveRecaptchaV3Enterprise as captchasolvSolveV3Enterprise,
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

// ─── reCAPTCHA v2 Enterprise ★ TeraBox uses this! ───

export async function solveRecaptchaV2Enterprise(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveV2Enterprise(siteKey, pageUrl, invisible);
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

// ─── reCAPTCHA v3 Enterprise ───

export async function solveRecaptchaV3Enterprise(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = ''
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveV3Enterprise(siteKey, pageUrl, minScore, action);
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

// ─── Convenience: solve reCAPTCHA with Enterprise-first strategy ───

/**
 * Solve reCAPTCHA for TeraBox signup.
 * ★ Strategy: Try Enterprise v2 first (TeraBox uses Enterprise!), then standard v2,
 *   then Enterprise v3, then standard v3 as last resort.
 *
 * TeraBox errno 460030 = Enterprise reCAPTCHA
 * TeraBox errno 400090 = standard reCAPTCHA
 *
 * Per CaptchaSolv docs: token expires in ~2 min — use immediately!
 */
export async function solveRecaptcha(siteKey: string, pageUrl: string): Promise<string | null> {
  if (!isCaptchaSolvConfigured()) {
    console.warn('[Captcha] CAPTCHASOLV_API_KEY not set — CAPTCHA solving disabled');
    return null;
  }

  console.log(`[Captcha] Solving reCAPTCHA for ${pageUrl.substring(0, 60)}... (provider: captchasolv)`);

  try {
    // Strategy 1: Enterprise v2 (TeraBox uses Enterprise — errno 460030)
    const v2Ent = await solveRecaptchaV2Enterprise(siteKey, pageUrl);
    if (v2Ent.success) {
      const token = v2Ent.solution?.token || v2Ent.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] Enterprise v2 solved${v2Ent.solveTime ? ` in ${v2Ent.solveTime.toFixed(1)}s` : ''}${v2Ent.cost ? ` (cost: ${v2Ent.cost})` : ''}`);
        return token;
      }
    }
    console.warn(`[Captcha] Enterprise v2 failed: ${v2Ent.error}`);

    // Strategy 2: Standard v2 (errno 400090)
    const v2 = await solveRecaptchaV2(siteKey, pageUrl);
    if (v2.success) {
      const token = v2.solution?.token || v2.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] Standard v2 solved${v2.solveTime ? ` in ${v2.solveTime.toFixed(1)}s` : ''}`);
        return token;
      }
    }
    console.warn(`[Captcha] Standard v2 failed: ${v2.error}`);

    // Strategy 3: Enterprise v3 (fast fallback, 3-5s)
    const v3Ent = await solveRecaptchaV3Enterprise(siteKey, pageUrl, 0.3, 'register');
    if (v3Ent.success) {
      const token = v3Ent.solution?.token || v3Ent.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] Enterprise v3 solved${v3Ent.solveTime ? ` in ${v3Ent.solveTime.toFixed(1)}s` : ''}`);
        return token;
      }
    }
    console.warn(`[Captcha] Enterprise v3 failed: ${v3Ent.error}`);

    // Strategy 4: Standard v3 (last resort)
    const v3 = await solveRecaptchaV3(siteKey, pageUrl, 0.3, 'register');
    if (v3.success) {
      const token = v3.solution?.token || v3.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] Standard v3 solved${v3.solveTime ? ` in ${v3.solveTime.toFixed(1)}s` : ''}`);
        return token;
      }
    }

    console.error(`[Captcha] All strategies failed. EntV2: ${v2Ent.error}, V2: ${v2.error}, EntV3: ${v3Ent.error}, V3: ${v3.error}`);
    return null;
  } catch (err) {
    console.error(`[Captcha] Fatal error: ${(err as Error).message}`);
    return null;
  }
}

// ─── Backwards compat ───
export const is2CaptchaConfigured = isCaptchaConfigured;
export { TASK_TYPES };
