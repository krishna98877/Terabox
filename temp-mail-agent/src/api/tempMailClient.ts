/**
 * Temp Mail API HTTP client with retry, rate-limit, and error handling.
 */

import {
  CreateEmailResponse,
  MessagesListResponse,
  MessageDetail,
  DomainsResponse,
  ApiError,
} from './types';
import { logger } from '../utils/logging';
import { withRetry, isRetryableError, sleep } from '../utils/retry';
import { RateLimitGate } from '../utils/rateLimit';

export interface TempMailClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  retryBaseDelay?: number;
}

export class TempMailClient {
  private apiKey: string;
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;
  private retryBaseDelay: number;
  private rateLimitGate: RateLimitGate;

  constructor(config: TempMailClientConfig) {
    if (!config.apiKey) {
      throw new Error('TEMP_MAIL_API_KEY is required. Set it in your .env file or environment.');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.temp-mail.io';
    this.timeout = config.timeout || 10000;
    this.maxRetries = config.maxRetries || 3;
    this.retryBaseDelay = config.retryBaseDelay || 1000;
    this.rateLimitGate = new RateLimitGate(2);
  }

  /**
   * Get rate limit info from the last response.
   */
  getRateLimitInfo() {
    return this.rateLimitGate.getInfo();
  }

  /**
   * Core request method with retry, rate-limit handling, and timeout.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ data: T; headers: Record<string, string | undefined> }> {
    return withRetry(
      async () => {
        // Self-throttle before making the request
        await this.rateLimitGate.throttle();

        const url = `${this.baseUrl}${path}`;
        logger.debug(`${method} ${url}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
          const headers: Record<string, string> = {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          };

          const response = await fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          // Collect response headers for rate-limit tracking
          const respHeaders: Record<string, string | undefined> = {};
          response.headers.forEach((value, key) => {
            respHeaders[key.toLowerCase()] = value;
          });

          // Update rate-limit info from every response
          this.rateLimitGate.update(respHeaders);

          // Handle 429 specifically
          if (response.status === 429) {
            await this.rateLimitGate.handle429(respHeaders['x-ratelimit-reset']);
            // Throw to trigger retry
            const err = new Error('Rate limited — retrying after backoff') as Error & { statusCode?: number };
            err.statusCode = 429;
            throw err;
          }

          // Parse response body
          const text = await response.text();
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = text;
          }

          // Handle errors
          if (!response.ok) {
            const apiErr = parsed as ApiError;
            const detail = apiErr?.error?.detail || response.statusText || 'Unknown error';
            const err = new Error(
              `API error ${response.status}: ${detail} (type=${apiErr?.error?.type || 'unknown'}, code=${apiErr?.error?.code || 'unknown'})`
            ) as Error & { statusCode?: number };
            err.statusCode = response.status;
            throw err;
          }

          return { data: parsed as T, headers: respHeaders };
        } catch (error) {
          clearTimeout(timeoutId);

          if ((error as Error).name === 'AbortError') {
            const err = new Error(`Request timed out after ${this.timeout}ms: ${method} ${path}`) as Error & { statusCode?: number };
            err.statusCode = 408;
            throw err;
          }

          throw error;
        }
      },
      {
        maxAttempts: this.maxRetries,
        baseDelay: this.retryBaseDelay,
        retryOn: isRetryableError,
      }
    );
  }

  // ──────────────────────────────
  // Email endpoints
  // ──────────────────────────────

  /**
   * POST /v1/emails — Create a temporary email address.
   */
  async createEmail(options?: { domain?: string; ttl?: number }): Promise<CreateEmailResponse> {
    const body: Record<string, unknown> = {};
    if (options?.domain) body.domain = options.domain;
    if (options?.ttl) body.ttl = options.ttl;

    const { data } = await this.request<CreateEmailResponse>('POST', '/v1/emails', body);
    logger.info(`Created temporary email: ${data.email} (TTL: ${data.ttl}s)`);
    return data;
  }

  /**
   * GET /v1/emails/{email}/messages — Get all messages for an inbox.
   */
  async getMessages(email: string): Promise<MessagesListResponse> {
    const encodedEmail = encodeURIComponent(email);
    const { data } = await this.request<MessagesListResponse>(
      'GET',
      `/v1/emails/${encodedEmail}/messages`
    );
    logger.debug(`Retrieved ${data.messages?.length || 0} messages for ${email}`);
    return data;
  }

  /**
   * DELETE /v1/emails/{email} — Delete a temporary email and all its messages.
   */
  async deleteEmail(email: string): Promise<void> {
    const encodedEmail = encodeURIComponent(email);
    await this.request('DELETE', `/v1/emails/${encodedEmail}`);
    logger.info(`Deleted temporary email: ${email}`);
  }

  // ──────────────────────────────
  // Message endpoints
  // ──────────────────────────────

  /**
   * GET /v1/messages/{messageId} — Get a specific message.
   */
  async getMessage(messageId: string): Promise<MessageDetail> {
    const { data } = await this.request<MessageDetail>(
      'GET',
      `/v1/messages/${messageId}`
    );
    logger.debug(`Retrieved message: ${messageId}`);
    return data;
  }

  /**
   * GET /v1/messages/{messageId}/source — Get message source code.
   */
  async getMessageSource(messageId: string): Promise<string> {
    const { data } = await this.request<string>(
      'GET',
      `/v1/messages/${messageId}/source`
    );
    return data;
  }

  /**
   * GET /v1/messages/{messageId}/attachments/{attachmentId} — Download attachment.
   */
  async getAttachment(messageId: string, attachmentId: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/v1/messages/${messageId}/attachments/${attachmentId}`;

    await this.rateLimitGate.throttle();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-API-Key': this.apiKey,
          'Accept': '*/*',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Failed to download attachment: ${response.status} ${response.statusText}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * DELETE /v1/messages/{messageId} — Delete a specific message.
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.request('DELETE', `/v1/messages/${messageId}`);
    logger.info(`Deleted message: ${messageId}`);
  }

  // ──────────────────────────────
  // Domain endpoints
  // ──────────────────────────────

  /**
   * GET /v1/domains — List available domains.
   */
  async getDomains(): Promise<DomainsResponse> {
    const { data } = await this.request<DomainsResponse>('GET', '/v1/domains');
    logger.debug(`Available domains: ${data.domains?.join(', ')}`);
    return data;
  }
}
