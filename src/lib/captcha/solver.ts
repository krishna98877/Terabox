/**
 * CAPTCHA Solver Module — CaptchaSolv (primary & only provider).
 *
 * ═══════════════════════════════════════════════════════════════════
 * CaptchaSolv: Fast & reliable, 100 FREE solves/day
 * ═══════════════════════════════════════════════════════════════════
 *
 * ★★★ CRITICAL FIX: Proxy-bound captcha solving ★★★
 * Enterprise reCAPTCHA binds the token to the solver's IP address.
 * If you solve from CaptchaSolv's IP (Proxyless) but submit from your proxy IP,
 * TeraBox REJECTS the token → errno 400090 loop!
 *
 * FIX: Always pass proxyUrl when you have a proxy.
 * This uses *Task (with proxy) types → CaptchaSolv solves from SAME IP → token accepted!
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
  invisible = false,
  proxyUrl?: string
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveV2(siteKey, pageUrl, invisible, proxyUrl);
}

// ─── reCAPTCHA v2 Enterprise ★ TeraBox uses this! ───

export async function solveRecaptchaV2Enterprise(
  siteKey: string,
  pageUrl: string,
  invisible = false,
  proxyUrl?: string
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveV2Enterprise(siteKey, pageUrl, invisible, proxyUrl);
}

// ─── reCAPTCHA v3 ───

export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = '',
  proxyUrl?: string
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveV3(siteKey, pageUrl, minScore, action, proxyUrl);
}

// ─── reCAPTCHA v3 Enterprise ───

export async function solveRecaptchaV3Enterprise(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = '',
  proxyUrl?: string
): Promise<SolveResult> {
  if (!isCaptchaSolvConfigured()) {
    return { success: false, error: 'CAPTCHASOLV_API_KEY not set' };
  }
  return captchasolvSolveV3Enterprise(siteKey, pageUrl, minScore, action, proxyUrl);
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
 * ★★★ CRITICAL: proxyUrl must be passed!
 *   Enterprise reCAPTCHA binds token to solver IP.
 *   Without proxy, token is from CaptchaSolv IP ≠ your proxy IP → REJECTED.
 *   With proxy, CaptchaSolv solves from YOUR proxy IP → token accepted!
 *
 * TeraBox errno 460030 = Enterprise reCAPTCHA
 * TeraBox errno 400090 = standard reCAPTCHA
 *
 * Per CaptchaSolv docs: token expires in ~2 min — use immediately!
 */
export interface RecaptchaSolveResult {
  token: string | null;
  errors: Array<{ phase: string; type: string; error: string; errorCode?: string }>;
}

/**
 * Solve reCAPTCHA for TeraBox signup — returns token + detailed error info.
 * The errors array captures WHY each attempt failed, so the detail button
 * can show the full technical error for debugging/sharing.
 *
 * ★★★ STRATEGY (updated based on live testing 2024-08-13):
 * TeraBox errno 400090 with errmsg="need verify_v2" — wants v2 STANDARD reCAPTCHA!
 * v2 Enterprise tokens get REJECTED (errno 400090 "need verify_v2")
 * 1. WITH PROXY: Try v2 Standard FIRST (TeraBox explicitly wants verify_v2!)
 *    Then try v2 Enterprise as fallback (in case some sessions want Enterprise)
 * 2. WITHOUT PROXY: Both usually fail with UNSOLVABLE
 * 3. SEQUENTIAL (not parallel) to avoid CaptchaSolv's concurrent task limit
 * 4. v3 variants as last resort (lower success rate for TeraBox)
 */
export async function solveRecaptcha(siteKey: string, pageUrl: string, proxyUrl?: string): Promise<RecaptchaSolveResult> {
  const errors: RecaptchaSolveResult['errors'] = [];

  if (!isCaptchaSolvConfigured()) {
    console.warn('[Captcha] CAPTCHASOLV_API_KEY not set — CAPTCHA solving disabled');
    errors.push({ phase: 'config', type: 'all', error: 'CAPTCHASOLV_API_KEY not set' });
    return { token: null, errors };
  }

  const proxyLabel = proxyUrl ? `via proxy (${proxyUrl.substring(0, 30)}...)` : 'proxyless';
  console.log(`[Captcha] Solving reCAPTCHA for ${pageUrl.substring(0, 60)}... (provider: captchasolv, sequential strategy, ${proxyLabel})`);

  try {
    // ★ Phase 1: Try v2 Standard FIRST (TeraBox errmsg="need verify_v2" — wants v2!)
    console.log(`[Captcha] Phase 1: v2 Standard${proxyUrl ? ' (proxy-bound)' : ' (proxyless)'}...`);
    const v2StdResult = await solveRecaptchaV2(siteKey, pageUrl, false, proxyUrl);

    if (v2StdResult.success) {
      const token = v2StdResult.solution?.token || v2StdResult.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] v2 Standard solved!${v2StdResult.solveTime ? ` in ${v2StdResult.solveTime.toFixed(1)}s` : ''}${v2StdResult.cost ? ` (cost: ${v2StdResult.cost})` : ''}`);
        return { token, errors };
      }
    }
    errors.push({ phase: 'v2', type: 'Standard', error: v2StdResult.error || 'Unknown error', errorCode: v2StdResult.errorCode });
    console.warn(`[Captcha] v2 Standard failed: ${v2StdResult.error} (${v2StdResult.errorCode || 'no code'})`);

    // ★ Phase 2: Try v2 Enterprise as fallback (some sessions may want Enterprise)
    console.log(`[Captcha] Phase 2: v2 Enterprise${proxyUrl ? ' (proxy-bound)' : ' (proxyless)'}...`);
    const v2EntResult = await solveRecaptchaV2Enterprise(siteKey, pageUrl, false, proxyUrl);

    if (v2EntResult.success) {
      const token = v2EntResult.solution?.token || v2EntResult.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] v2 Enterprise solved (may be rejected by TeraBox — wants verify_v2)!${v2EntResult.solveTime ? ` in ${v2EntResult.solveTime.toFixed(1)}s` : ''}`);
        return { token, errors };
      }
    }
    errors.push({ phase: 'v2', type: 'Enterprise', error: v2EntResult.error || 'Unknown error', errorCode: v2EntResult.errorCode });

    // ★ Phase 3: Try v3 Enterprise (last resort)
    console.log(`[Captcha] Phase 3: v3 Enterprise${proxyUrl ? ' (proxy-bound)' : ' (proxyless)'}...`);
    const v3EntResult = await solveRecaptchaV3Enterprise(siteKey, pageUrl, 0.3, 'register', proxyUrl);

    if (v3EntResult.success) {
      const token = v3EntResult.solution?.token || v3EntResult.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] v3 Enterprise solved!${v3EntResult.solveTime ? ` in ${v3EntResult.solveTime.toFixed(1)}s` : ''}`);
        return { token, errors };
      }
    }
    errors.push({ phase: 'v3', type: 'Enterprise', error: v3EntResult.error || 'Unknown error', errorCode: v3EntResult.errorCode });

    console.error(`[Captcha] All strategies failed.`, errors);
    return { token: null, errors };
  } catch (err) {
    console.error(`[Captcha] Fatal error: ${(err as Error).message}`);
    errors.push({ phase: 'fatal', type: 'all', error: (err as Error).message });
    return { token: null, errors };
  }
}

// ─── Backwards compat ───
export const is2CaptchaConfigured = isCaptchaConfigured;
export { TASK_TYPES };
