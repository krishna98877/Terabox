/**
 * Captcha solving module.
 * Priority: NopeCHA (Token API, free 100 credits/day) → NoCaptchaAI (6k free one-time) → 2captcha (paid fallback)
 *
 * NopeCHA works WITHOUT API key on residential IP!
 * Set NOPECHA_API_KEY for server/datacenter IPs.
 */
export {
  isCaptchaConfigured,
  is2CaptchaConfigured,
  getActiveProvider,
  getConfiguredProviders,
  solveRecaptchaV2,
  solveRecaptchaV3,
  solveTurnstile,
  solveHCaptcha,
  solveImageCaptcha,
  solveRecaptcha,
  getBalance,
  getNopechaStatus,
} from './solver';
export type { CaptchaTask, SolveResult } from './solver';
