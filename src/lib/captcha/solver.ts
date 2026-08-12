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
 */
export async function solveRecaptcha(siteKey: string, pageUrl: string, proxyUrl?: string): Promise<RecaptchaSolveResult> {
  const errors: RecaptchaSolveResult['errors'] = [];

  if (!isCaptchaSolvConfigured()) {
    console.warn('[Captcha] CAPTCHASOLV_API_KEY not set — CAPTCHA solving disabled');
    errors.push({ phase: 'config', type: 'all', error: 'CAPTCHASOLV_API_KEY not set' });
    return { token: null, errors };
  }

  const proxyLabel = proxyUrl ? `via proxy (${proxyUrl.substring(0, 30)}...)` : 'proxyless';
  console.log(`[Captcha] Solving reCAPTCHA for ${pageUrl.substring(0, 60)}... (provider: captchasolv, parallel strategy, ${proxyLabel})`);

  try {
    // ★ Phase 1: Try v2 Enterprise + v2 Standard IN PARALLEL
    let v2Token: string | null = null;

    const v2EntPromise = solveRecaptchaV2Enterprise(siteKey, pageUrl, false, proxyUrl);
    const v2StdPromise = solveRecaptchaV2(siteKey, pageUrl, false, proxyUrl);

    const v2RaceResult = await Promise.race([
      v2EntPromise.then(r => ({ source: 'ent' as const, result: r })),
      v2StdPromise.then(r => ({ source: 'std' as const, result: r })),
    ]);

    if (v2RaceResult.result.success) {
      const token = v2RaceResult.result.solution?.token || v2RaceResult.result.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] ${v2RaceResult.source === 'ent' ? 'Enterprise' : 'Standard'} v2 solved (race winner)${v2RaceResult.result.solveTime ? ` in ${v2RaceResult.result.solveTime.toFixed(1)}s` : ''}${v2RaceResult.result.cost ? ` (cost: ${v2RaceResult.result.cost})` : ''}`);
        v2Token = token;
      }
    } else {
      errors.push({ phase: 'v2', type: v2RaceResult.source === 'ent' ? 'Enterprise' : 'Standard', error: v2RaceResult.result.error || 'Unknown error', errorCode: v2RaceResult.result.errorCode });
    }

    // If race winner failed, check the other one
    if (!v2Token) {
      const otherSource = v2RaceResult.source === 'ent' ? 'std' : 'ent';
      const otherPromise = v2RaceResult.source === 'ent' ? v2StdPromise : v2EntPromise;
      try {
        const otherResult = await otherPromise;
        if (otherResult.success) {
          const token = otherResult.solution?.token || otherResult.solution?.gRecaptchaResponse;
          if (token) {
            console.log(`[Captcha] ${otherSource === 'ent' ? 'Enterprise' : 'Standard'} v2 solved (fallback)${otherResult.solveTime ? ` in ${otherResult.solveTime.toFixed(1)}s` : ''}`);
            v2Token = token;
          }
        } else {
          errors.push({ phase: 'v2', type: otherSource === 'ent' ? 'Enterprise' : 'Standard', error: otherResult.error || 'Unknown error', errorCode: otherResult.errorCode });
        }
      } catch (e) {
        errors.push({ phase: 'v2', type: otherSource === 'ent' ? 'Enterprise' : 'Standard', error: `Exception: ${(e as Error).message}` });
      }
    }

    if (v2Token) return { token: v2Token, errors };

    console.warn(`[Captcha] v2 parallel failed`, errors.filter(e => e.phase === 'v2').map(e => `${e.type}: ${e.error}`).join('; '));

    // ★ Phase 2: Try v3 variants in parallel
    let v3Token: string | null = null;

    const v3EntPromise = solveRecaptchaV3Enterprise(siteKey, pageUrl, 0.3, 'register', proxyUrl);
    const v3StdPromise = solveRecaptchaV3(siteKey, pageUrl, 0.3, 'register', proxyUrl);

    const v3RaceResult = await Promise.race([
      v3EntPromise.then(r => ({ source: 'ent' as const, result: r })),
      v3StdPromise.then(r => ({ source: 'std' as const, result: r })),
    ]);

    if (v3RaceResult.result.success) {
      const token = v3RaceResult.result.solution?.token || v3RaceResult.result.solution?.gRecaptchaResponse;
      if (token) {
        console.log(`[Captcha] ${v3RaceResult.source === 'ent' ? 'Enterprise' : 'Standard'} v3 solved (race winner)${v3RaceResult.result.solveTime ? ` in ${v3RaceResult.result.solveTime.toFixed(1)}s` : ''}`);
        v3Token = token;
      }
    } else {
      errors.push({ phase: 'v3', type: v3RaceResult.source === 'ent' ? 'Enterprise' : 'Standard', error: v3RaceResult.result.error || 'Unknown error', errorCode: v3RaceResult.result.errorCode });
    }

    if (!v3Token) {
      const otherSource = v3RaceResult.source === 'ent' ? 'std' : 'ent';
      const otherPromise = v3RaceResult.source === 'ent' ? v3StdPromise : v3EntPromise;
      try {
        const otherResult = await otherPromise;
        if (otherResult.success) {
          const token = otherResult.solution?.token || otherResult.solution?.gRecaptchaResponse;
          if (token) {
            console.log(`[Captcha] ${otherSource === 'ent' ? 'Enterprise' : 'Standard'} v3 solved (fallback)${otherResult.solveTime ? ` in ${otherResult.solveTime.toFixed(1)}s` : ''}`);
            v3Token = token;
          }
        } else {
          errors.push({ phase: 'v3', type: otherSource === 'ent' ? 'Enterprise' : 'Standard', error: otherResult.error || 'Unknown error', errorCode: otherResult.errorCode });
        }
      } catch (e) {
        errors.push({ phase: 'v3', type: otherSource === 'ent' ? 'Enterprise' : 'Standard', error: `Exception: ${(e as Error).message}` });
      }
    }

    if (v3Token) return { token: v3Token, errors };

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
