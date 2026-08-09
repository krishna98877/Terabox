/**
 * Rate-limit tracker — reads X-Ratelimit-* headers and enforces client-side throttling.
 */

import { logger } from './logging';
import { sleep } from './retry';

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  reset: number | null; // UTC epoch seconds
}

const DEFAULT_RATE_LIMIT_INFO: RateLimitInfo = {
  limit: null,
  remaining: null,
  used: null,
  reset: null,
};

/**
 * Parse rate-limit headers from a Fetch response.
 */
export function parseRateLimitHeaders(headers: Record<string, string | undefined>): RateLimitInfo {
  const getNum = (key: string): number | null => {
    const val = headers[key];
    if (val === undefined || val === null) return null;
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  };

  return {
    limit: getNum('x-ratelimit-limit'),
    remaining: getNum('x-ratelimit-remaining'),
    used: getNum('x-ratelimit-used'),
    reset: getNum('x-ratelimit-reset'),
  };
}

/**
 * Rate-limit gate — call before making API requests to self-throttle.
 */
export class RateLimitGate {
  private info: RateLimitInfo = { ...DEFAULT_RATE_LIMIT_INFO };
  private minRemaining: number;

  constructor(minRemaining: number = 2) {
    this.minRemaining = minRemaining;
  }

  /**
   * Update rate-limit info from the latest response headers.
   */
  update(headers: Record<string, string | undefined>): void {
    this.info = parseRateLimitHeaders(headers);
    logger.debug('Rate limit info updated', { ...this.info });
  }

  /**
   * Get the current rate-limit info.
   */
  getInfo(): RateLimitInfo {
    return { ...this.info };
  }

  /**
   * Wait if we are approaching the rate limit.
   * If `remaining` is at or below `minRemaining`, wait until `reset` time.
   */
  async throttle(): Promise<void> {
    const { remaining, reset } = this.info;

    if (remaining !== null && remaining <= this.minRemaining) {
      if (reset !== null) {
        const resetTime = reset * 1000; // epoch seconds → ms
        const now = Date.now();
        const waitMs = Math.max(resetTime - now + 500, 1000); // +500ms buffer

        logger.warn(`Approaching rate limit (${remaining} remaining). Waiting ${waitMs}ms until reset.`);
        await sleep(waitMs);
      } else {
        // No reset time available — wait a conservative 5 seconds
        logger.warn(`Approaching rate limit (${remaining} remaining). Waiting 5000ms (no reset time).`);
        await sleep(5000);
      }
    }
  }

  /**
   * Check if a 429 response was received and wait accordingly.
   */
  async handle429(resetHeader?: string): Promise<void> {
    if (resetHeader) {
      const reset = parseInt(resetHeader, 10);
      if (!isNaN(reset)) {
        const waitMs = Math.max(reset * 1000 - Date.now() + 1000, 2000);
        logger.warn(`Rate limited (429). Waiting ${waitMs}ms until rate limit resets.`);
        await sleep(waitMs);
        return;
      }
    }
    logger.warn('Rate limited (429). Waiting 10000ms (no reset header).');
    await sleep(10000);
  }
}
