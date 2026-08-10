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

// ─── Convenience: solve reCAPTCHA with parallel strategy ───

/**
 * Solve reCAPTCHA for TeraBox signup.
 * ★ OPTIMIZED STRATEGY (fast-first, parallel solving):
 *   Phase 1: Enterprise v2 + Standard v2 IN PARALLEL
 *     - Cuts solve time by ~50% since the first success wins
 *     - Enterprise v2 (errno 460030) is TeraBox's primary type
 *     - Standard v2 (errno 400090) as backup in parallel
 *   Phase 2: Enterprise v3 + Standard v3 IN PARALLEL (fast 3-5s each)
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

  console.log(`[Captcha] Solving reCAPTCHA for ${pageUrl.substring(0, 60)}... (provider: captchasolv, parallel strategy)`);

  try {
    // ★ Phase 1: Try v2 Enterprise + v2 Standard IN PARALLEL
    // This cuts solve time by ~50% since the first success wins
    const [v2Ent, v2] = await Promise.allSettled([
      solveRecaptchaV2Enterprise(siteKey, pageUrl),
      solveRecaptchaV2(siteKey, pageUrl),
    ]);

    // Check Enterprise v2 result (TeraBox primarily uses Enterprise)
    const v2EntResult = v2Ent.status === 'fulfilled' ? v2Ent.value : null;
    if (v2EntResult?.success) {
      const token = v2EntResult.solution?.token || v2EntResult.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] Enterprise v2 solved${v2EntResult.solveTime ? ` in ${v2EntResult.solveTime.toFixed(1)}s` : ''}${v2EntResult.cost ? ` (cost: ${v2EntResult.cost})` : ''}`);
        return token;
      }
    }

    // Check Standard v2 result
    const v2Result = v2.status === 'fulfilled' ? v2.value : null;
    if (v2Result?.success) {
      const token = v2Result.solution?.token || v2Result.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] Standard v2 solved${v2Result.solveTime ? ` in ${v2Result.solveTime.toFixed(1)}s` : ''}`);
        return token;
      }
    }

    console.warn(`[Captcha] v2 parallel failed — EntV2: ${v2EntResult?.error || 'rejected'}, V2: ${v2Result?.error || 'rejected'}`);

    // ★ Phase 2: Try v3 variants in parallel (fast 3-5s each)
    const [v3Ent, v3] = await Promise.allSettled([
      solveRecaptchaV3Enterprise(siteKey, pageUrl, 0.3, 'register'),
      solveRecaptchaV3(siteKey, pageUrl, 0.3, 'register'),
    ]);

    const v3EntResult = v3Ent.status === 'fulfilled' ? v3Ent.value : null;
    if (v3EntResult?.success) {
      const token = v3EntResult.solution?.token || v3EntResult.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] Enterprise v3 solved${v3EntResult.solveTime ? ` in ${v3EntResult.solveTime.toFixed(1)}s` : ''}`);
        return token;
      }
    }

    const v3Result = v3.status === 'fulfilled' ? v3.value : null;
    if (v3Result?.success) {
      const token = v3Result.solution?.token || v3Result.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] Standard v3 solved${v3Result.solveTime ? ` in ${v3Result.solveTime.toFixed(1)}s` : ''}`);
        return token;
      }
    }

    console.error(`[Captcha] All strategies failed. EntV2: ${v2EntResult?.error}, V2: ${v2Result?.error}, EntV3: ${v3EntResult?.error}, V3: ${v3Result?.error}`);
    return null;
  } catch (err) {
    console.error(`[Captcha] Fatal error: ${(err as Error).message}`);
    return null;
  }
}

// ─── Backwards compat ───
export const is2CaptchaConfigured = isCaptchaConfigured;
export { TASK_TYPES };
