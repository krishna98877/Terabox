/**
 * Captcha solving module — CaptchaSolv only.
 *
 * CaptchaSolv: 100 FREE solves/day
 * - reCAPTCHA v2/v3, Turnstile, hCaptcha, GeeTest v4, and more
 * - 2captcha-compatible API, average solve time < 15s
 * - Set CAPTCHASOLV_API_KEY env var (get key via Discord /panel)
 * - Docs: https://docs.captchasolv.com/
 */
export {
  isCaptchaConfigured,
  is2CaptchaConfigured,
  getActiveProvider,
  solveRecaptchaV2,
  solveRecaptchaV3,
  solveTurnstile,
  solveHCaptcha,
  solveImageCaptcha,
  solveRecaptcha,
  getBalance,
  getHealth,
  getSupportedTypes,
  TASK_TYPES,
} from './solver';
export type { CaptchaTask, SolveResult } from './solver';
