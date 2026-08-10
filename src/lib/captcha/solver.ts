/**
 * CAPTCHA Solver Module — NopeCHA (primary) + NoCaptchaAI + 2Captcha (fallback).
 *
 * ═══════════════════════════════════════════════════════════════════
 * NopeCHA: FREE! 100 credits/day (daily reset — never runs out!)
 *   Token API: 20 credits/solve = 5 reCAPTCHA tokens/day free
 *   Recognition API: 1 credit/solve = 100 image solves/day free
 *   Turnstile: 1 credit/solve = 100/day free
 *   hCaptcha: 10 credits/solve = 10/day free
 *   Works WITHOUT API key on residential IP!
 *   Set NOPECHA_API_KEY for server/datacenter IPs
 * ═══════════════════════════════════════════════════════════════════
 *
 * NoCaptchaAI: 6,000 FREE solves (one-time, no reset).
 *   - reCAPTCHA v2/v3, Turnstile, GeeTest, ImageToText
 *   - Set NOCAPTCHA_API_KEY env var
 *
 * 2Captcha: Paid fallback (~$1-3/1000 solves).
 *   - Set TWOCAPTCHA_API_KEY env var
 *
 * Priority: NopeCHA (Token API) → NoCaptchaAI → 2captcha → null
 */

import {
  solveRecaptchaV2 as nopechaSolveV2,
  solveRecaptchaV3 as nopechaSolveV3,
  solveTurnstile as nopechaSolveTurnstile,
  solveHCaptcha as nopechaSolveHCaptcha,
  isConfigured as isNopechaConfigured,
  hasApiKey as hasNopechaApiKey,
  getStatus as nopechaGetStatus,
  getBalance as nopechaGetBalance,
} from './nopecha';
import {
  solveRecaptchaV2 as noCaptchaSolveV2,
  solveRecaptchaV3 as noCaptchaSolveV3,
  solveTurnstile as noCaptchaSolveTurnstile,
  solveImageCaptcha as noCaptchaSolveImage,
  isConfigured as isNoCaptchaConfigured,
  getBalance as noCaptchaGetBalance,
} from './nocaptchaai';
import {
  solveRecaptchaV2 as twoCaptchaSolveV2,
  solveRecaptchaV3 as twoCaptchaSolveV3,
  solveTurnstile as twoCaptchaSolveTurnstile,
  solveImageCaptcha as twoCaptchaSolveImage,
  isConfigured as is2CaptchaInternalConfigured,
  getBalance as twoCaptchaGetBalance,
} from './twocaptcha';

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
  apiUsed?: 'token' | 'recognition';
  creditsUsed?: number;
}

// ─── Provider Detection ───

/**
 * Check if any CAPTCHA solver is available.
 * NopeCHA always returns true (works on residential IP without API key).
 * If NopeCHA fails (server IP), we fall back to NoCaptchaAI or 2Captcha.
 */
export function isCaptchaConfigured(): boolean {
  return isNopechaConfigured() || isNoCaptchaConfigured() || is2CaptchaInternalConfigured();
}

export function getActiveProvider(): 'nopecha' | 'nocaptchaai' | '2captcha' | null {
  // NopeCHA always tries first (free, fast)
  if (isNopechaConfigured()) return 'nopecha';
  if (isNoCaptchaConfigured()) return 'nocaptchaai';
  if (is2CaptchaInternalConfigured()) return '2captcha';
  return null;
}

/**
 * Get all configured providers (for status display).
 */
export function getConfiguredProviders(): { name: string; configured: boolean; hasKey: boolean }[] {
  return [
    { name: 'nopecha', configured: isNopechaConfigured(), hasKey: hasNopechaApiKey() },
    { name: 'nocaptchaai', configured: isNoCaptchaConfigured(), hasKey: isNoCaptchaConfigured() },
    { name: '2captcha', configured: is2CaptchaInternalConfigured(), hasKey: is2CaptchaInternalConfigured() },
  ];
}

// ─── reCAPTCHA v2 ───

export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  // Try NopeCHA first (Token API: 5/day free, or 100/day with Recognition)
  if (isNopechaConfigured()) {
    try {
      const result = await nopechaSolveV2(siteKey, pageUrl, invisible);
      if (result.success) return { ...result, provider: 'nopecha' };
      // Don't log FREE_TIER_INELIGIBLE as a warning — it just means server IP
      if (result.errorCode !== 'FREE_TIER_INELIGIBLE') {
        console.warn(`[Captcha] NopeCHA v2 failed: ${result.error} (${result.errorCode}) — trying next provider`);
      } else {
        console.info(`[Captcha] NopeCHA free tier blocked (server IP) — trying next provider`);
      }
    } catch (err) {
      console.warn(`[Captcha] NopeCHA v2 exception: ${(err as Error).message}`);
    }
  }

  // Try NoCaptchaAI (6k free one-time)
  if (isNoCaptchaConfigured()) {
    const result = await noCaptchaSolveV2(siteKey, pageUrl, invisible);
    if (result.success) return { ...result, provider: 'nocaptchaai' };
    console.warn(`[Captcha] NoCaptchaAI v2 failed: ${result.error} — trying 2captcha`);
  }

  // Fallback to 2captcha
  if (is2CaptchaInternalConfigured()) {
    const result = await twoCaptchaSolveV2(siteKey, pageUrl, invisible);
    if (result.success) return { ...result, provider: '2captcha' };
  }

  return { success: false, error: 'No captcha solver available or all failed', provider: getActiveProvider() || 'none' };
}

// ─── reCAPTCHA v3 ───

export async function solveRecaptchaV3(
  siteKey: string,
  pageUrl: string,
  minScore = 0.3,
  action = ''
): Promise<SolveResult> {
  if (isNopechaConfigured()) {
    try {
      const result = await nopechaSolveV3(siteKey, pageUrl, minScore, action);
      if (result.success) return { ...result, provider: 'nopecha' };
      if (result.errorCode !== 'FREE_TIER_INELIGIBLE') {
        console.warn(`[Captcha] NopeCHA v3 failed: ${result.error} — trying next provider`);
      }
    } catch (err) {
      console.warn(`[Captcha] NopeCHA v3 exception: ${(err as Error).message}`);
    }
  }

  if (isNoCaptchaConfigured()) {
    const result = await noCaptchaSolveV3(siteKey, pageUrl, minScore, action);
    if (result.success) return { ...result, provider: 'nocaptchaai' };
    console.warn(`[Captcha] NoCaptchaAI v3 failed: ${result.error} — trying 2captcha`);
  }

  if (is2CaptchaInternalConfigured()) {
    const result = await twoCaptchaSolveV3(siteKey, pageUrl, minScore, action);
    if (result.success) return { ...result, provider: '2captcha' };
  }

  return { success: false, error: 'No captcha solver available or all failed', provider: getActiveProvider() || 'none' };
}

// ─── Cloudflare Turnstile ───

export async function solveTurnstile(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  // NopeCHA Turnstile: 1 credit/solve = 100/day free! Best deal.
  if (isNopechaConfigured()) {
    try {
      const result = await nopechaSolveTurnstile(siteKey, pageUrl);
      if (result.success) return { ...result, provider: 'nopecha' };
      if (result.errorCode !== 'FREE_TIER_INELIGIBLE') {
        console.warn(`[Captcha] NopeCHA Turnstile failed: ${result.error}`);
      }
    } catch (err) {
      console.warn(`[Captcha] NopeCHA Turnstile exception: ${(err as Error).message}`);
    }
  }

  if (isNoCaptchaConfigured()) {
    const result = await noCaptchaSolveTurnstile(siteKey, pageUrl);
    if (result.success) return { ...result, provider: 'nocaptchaai' };
  }

  if (is2CaptchaInternalConfigured()) {
    const result = await twoCaptchaSolveTurnstile(siteKey, pageUrl);
    if (result.success) return { ...result, provider: '2captcha' };
  }

  return { success: false, error: 'No captcha solver available or all failed' };
}

// ─── hCaptcha ───

export async function solveHCaptcha(
  siteKey: string,
  pageUrl: string
): Promise<SolveResult> {
  // NopeCHA hCaptcha: 10 credits/solve = 10/day free
  if (isNopechaConfigured()) {
    try {
      const result = await nopechaSolveHCaptcha(siteKey, pageUrl);
      if (result.success) return { ...result, provider: 'nopecha' };
    } catch (err) {
      console.warn(`[Captcha] NopeCHA hCaptcha exception: ${(err as Error).message}`);
    }
  }

  // NoCaptchaAI and 2captcha don't have hCaptcha in current impl
  return { success: false, error: 'No hCaptcha solver available' };
}

// ─── Image CAPTCHA ───

export async function solveImageCaptcha(
  imageBase64: string,
  options?: { phrase?: boolean; caseSensitive?: boolean; numeric?: number; minLength?: number; maxLength?: number; comment?: string }
): Promise<SolveResult> {
  if (isNoCaptchaConfigured()) {
    const result = await noCaptchaSolveImage(imageBase64, options);
    if (result.success) return { ...result, provider: 'nocaptchaai' };
  }

  if (is2CaptchaInternalConfigured()) {
    const result = await twoCaptchaSolveImage(imageBase64, options);
    if (result.success) return { ...result, provider: '2captcha' };
  }

  return { success: false, error: 'No captcha solver available or all failed' };
}

// ─── Balance / Status Check ───

export async function getBalance(): Promise<{ balance: number; error?: string; provider?: string }> {
  const provider = getActiveProvider();
  if (provider === 'nopecha') {
    const result = await nopechaGetBalance();
    return { ...result, provider: 'nopecha' };
  }
  if (provider === 'nocaptchaai') {
    const result = await noCaptchaGetBalance();
    return { ...result, provider: 'nocaptchaai' };
  }
  if (provider === '2captcha') {
    const result = await twoCaptchaGetBalance();
    return { ...result, provider: '2captcha' };
  }
  return { balance: 0, error: 'No captcha provider configured' };
}

/**
 * Get NopeCHA status with full details (credits, TTL, plan, etc).
 */
export async function getNopechaStatus() {
  return nopechaGetStatus();
}

// ─── Convenience: solve reCAPTCHA (tries v2 then v3) ───

export async function solveRecaptcha(siteKey: string, pageUrl: string): Promise<string | null> {
  if (!isCaptchaConfigured()) {
    console.warn('[Captcha] No provider configured (set NOPECHA_API_KEY, NOCAPTCHA_API_KEY, or TWOCAPTCHA_API_KEY)');
    return null;
  }

  const provider = getActiveProvider();
  console.log(`[Captcha] Solving reCAPTCHA for ${pageUrl.substring(0, 60)}... (provider: ${provider})`);

  try {
    // Try v2 first (most common for TeraBox)
    const v2 = await solveRecaptchaV2(siteKey, pageUrl);
    if (v2.success && v2.solution?.token) {
      console.log(`[Captcha] v2 solved by ${v2.provider}${v2.solveTime ? ` in ${v2.solveTime.toFixed(1)}s` : ''}${v2.creditsUsed ? ` (${v2.creditsUsed} credits)` : ''}`);
      return v2.solution.token;
    }
    if (v2.success && v2.solution?.gRecaptchaResponse) {
      console.log(`[Captcha] v2 solved by ${v2.provider}${v2.solveTime ? ` in ${v2.solveTime.toFixed(1)}s` : ''}`);
      return v2.solution.gRecaptchaResponse;
    }

    // Try v3 fallback
    const v3 = await solveRecaptchaV3(siteKey, pageUrl, 0.3, 'register');
    if (v3.success && v3.solution?.token) {
      console.log(`[Captcha] v3 solved by ${v3.provider}${v3.solveTime ? ` in ${v3.solveTime.toFixed(1)}s` : ''}`);
      return v3.solution.token;
    }
    if (v3.success && v3.solution?.gRecaptchaResponse) {
      console.log(`[Captcha] v3 solved by ${v3.provider}${v2.solveTime ? ` in ${v3.solveTime.toFixed(1)}s` : ''}`);
      return v3.solution.gRecaptchaResponse;
    }

    console.error(`[Captcha] Both v2 and v3 failed. v2: ${v2.error}, v3: ${v3.error}`);
    return null;
  } catch (err) {
    console.error(`[Captcha] Fatal error: ${(err as Error).message}`);
    return null;
  }
}

// Backwards compat
export const is2CaptchaConfigured = isCaptchaConfigured;
