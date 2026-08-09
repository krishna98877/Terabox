/**
 * Retry utility with exponential backoff, jitter, and rate-limit awareness.
 */

import { logger } from './logging';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  jitter?: boolean;
  retryOn?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitter: true,
  retryOn: () => true,
  onRetry: () => {},
};

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
export function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter: boolean
): number {
  const exponentialDelay = baseDelay * Math.pow(2, attempt);
  const capped = Math.min(exponentialDelay, maxDelay);
  if (jitter) {
    // Full jitter strategy: random between 0 and capped delay
    return Math.floor(Math.random() * capped);
  }
  return capped;
}

/**
 * Determine if an error is retryable.
 * Network errors, 429 (rate limit), and 5xx errors are retryable.
 */
export function isRetryableError(error: Error & { statusCode?: number }): boolean {
  // Rate limit — always retry (backoff will handle timing)
  if (error.statusCode === 429) return true;
  // Server errors
  if (error.statusCode && error.statusCode >= 500 && error.statusCode < 600) return true;
  // Network / timeout errors (no statusCode)
  if (!error.statusCode) return true;
  // 4xx other than 429 — not retryable
  return false;
}

/**
 * Execute an async function with retry logic and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry this error
      if (!opts.retryOn(lastError)) {
        throw lastError;
      }

      // Don't retry if this was the last attempt
      if (attempt === opts.maxAttempts - 1) {
        logger.error(`All ${opts.maxAttempts} retry attempts exhausted`, {
          lastError: lastError.message,
        });
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts.baseDelay, opts.maxDelay, opts.jitter);
      logger.warn(`Retry attempt ${attempt + 1}/${opts.maxAttempts} after ${delay}ms`, {
        error: lastError.message,
      });
      opts.onRetry(attempt + 1, lastError, delay);

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Simple sleep utility.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
