/**
 * Captcha solving module.
 * Priority: NoCaptchaAI (6k free/month) → 2captcha (paid fallback)
 */
export {
  isCaptchaConfigured,
  is2CaptchaConfigured,
  getActiveProvider,
  solveRecaptchaV2,
  solveRecaptchaV3,
  solveTurnstile,
  solveImageCaptcha,
  solveRecaptcha,
  getBalance,
} from './solver';
export type { CaptchaTask, SolveResult } from './solver';
