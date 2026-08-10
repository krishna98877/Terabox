/**
 * CAPTCHA Solver Module — NopeCHA (primary) + NoCaptchaAI + 2Captcha (fallback).
 *
 * NopeCHA: 100 FREE solves/DAY (daily reset — never runs out!)
 *   - reCAPTCHA v2/v3, hCaptcha, GeeTest, FunCAPTCHA, Text CAPTCHA
 *   - API: POST /v1/recaptcha → GET /v1/recaptcha (simple submit/poll)
 *   - Set NOPECHA_API_KEY env var
 *
 * NoCaptchaAI: 6,000 FREE solves (one-time, no reset).
 *   - reCAPTCHA v2/v3, Turnstile, GeeTest, ImageToText
 *   - Set NOCAPTCHA_API_KEY env var
 *
 * 2Captcha: Paid fallback (~$1-3/1000 solves).
 *   - Set TWOCAPTCHA_API_KEY env var
 *
 * Priority: NopeCHA → NoCaptchaAI → 2captcha → null
 */

import { solveRecaptchaV2 as nopechaSolveV2, solveRecaptchaV3 as nopechaSolveV3, isConfigured as isNopechaConfigured, getBalance as nopechaGetBalance } from './nopecha';
import { solveRecaptchaV2 as noCaptchaSolveV2, solveRecaptchaV3 as noCaptchaSolveV3, solveTurnstile as noCaptchaSolveTurnstile, solveImageCaptcha as noCaptchaSolveImage, isConfigured as isNoCaptchaConfigured, getBalance as noCaptchaGetBalance } from './nocaptchaai';
import { solveRecaptchaV2 as twoCaptchaSolveV2, solveRecaptchaV3 as twoCaptchaSolveV3, solveTurnstile as twoCaptchaSolveTurnstile, solveImageCaptcha as twoCaptchaSolveImage, isConfigured as is2CaptchaInternalConfigured, getBalance as twoCaptchaGetBalance } from './twocaptcha';

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
  return isNopechaConfigured() || isNoCaptchaConfigured() || is2CaptchaInternalConfigured();
}

export function getActiveProvider(): 'nopecha' | 'nocaptchaai' | '2captcha' | null {
  if (isNopechaConfigured()) return 'nopecha';
  if (isNoCaptchaConfigured()) return 'nocaptchaai';
  if (is2CaptchaInternalConfigured()) return '2captcha';
  return null;
}

// ─── reCAPTCHA v2 ───

export async function solveRecaptchaV2(
  siteKey: string,
  pageUrl: string,
  invisible = false
): Promise<SolveResult> {
  // Try NopeCHA first (100/day free, daily reset)
  if (isNopechaConfigured()) {
    const result = await nopechaSolveV2(siteKey, pageUrl, invisible);
    if (result.success) return { ...result, provider: 'nopecha' };
    console.warn(`[Captcha] NopeCHA v2 failed: ${result.error} — trying next provider`);
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
    const result = await nopechaSolveV3(siteKey, pageUrl, minScore, action);
    if (result.success) return { ...result, provider: 'nopecha' };
    console.warn(`[Captcha] NopeCHA v3 failed: ${result.error} — trying next provider`);
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
  // NopeCHA doesn't support Turnstile natively — skip to NoCaptchaAI
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

// ─── Balance Check ───

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
      console.log(`[Captcha] v2 solved by ${v2.provider}${v2.solveTime ? ` in ${v2.solveTime}s` : ''}`);
      return v2.solution.token;
    }
    if (v2.success && v2.solution?.gRecaptchaResponse) {
      console.log(`[Captcha] v2 solved by ${v2.provider}${v2.solveTime ? ` in ${v2.solveTime}s` : ''}`);
      return v2.solution.gRecaptchaResponse;
    }

    // Try v3 fallback
    const v3 = await solveRecaptchaV3(siteKey, pageUrl, 0.3, 'register');
    if (v3.success && v3.solution?.token) {
      console.log(`[Captcha] v3 solved by ${v3.provider}${v3.solveTime ? ` in ${v3.solveTime}s` : ''}`);
      return v3.solution.token;
    }
    if (v3.success && v3.solution?.gRecaptchaResponse) {
      console.log(`[Captcha] v3 solved by ${v3.provider}${v3.solveTime ? ` in ${v3.solveTime}s` : ''}`);
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
