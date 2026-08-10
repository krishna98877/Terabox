export {
  is2CaptchaConfigured,
  solveRecaptchaV2,
  solveRecaptchaV3,
  solveTurnstile,
  solveImageCaptcha,
  getBalance,
  reportCorrect,
  reportIncorrect,
} from './solver';
export type { CaptchaTask, SolveResult } from './solver';
