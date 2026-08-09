/**
 * Mail.tm API Client — Free temporary email API (8 QPS, no key required).
 * Docs: https://docs.mail.tm/
 * Base URL: https://api.mail.tm
 *
 * The API returns collections in JSON-LD format with "hydra:member" wrapper
 * when Accept: application/ld+json, or as plain arrays when Accept: application/json.
 * We handle both formats.
 */

const BASE_URL = 'https://api.mail.tm';
const TIMEOUT = 15000;

interface MailTmDomain {
  id: string;
  domain: string;
}

interface MailTmAccount {
  id: string;
  address: string;
}

interface MailTmToken {
  token: string;
  id: string;
}

interface MailTmMessageSummary {
  id: string;
  from: { address: string; name: string };
  to: { address: string; name: string }[];
  subject: string;
  intro: string;
  hasAttachments: boolean;
  size: number;
  createdAt: string;
  updatedAt: string;
}

interface MailTmMessageDetail extends MailTmMessageSummary {
  text: string;
  html: string[];
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    disposition: string;
    size: number;
    downloadUrl: string;
  }[];
}

/**
 * Extract collection items from either hydra:member or plain array response.
 */
function extractCollection<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    // Try hydra:member first
    if (Array.isArray(obj['hydra:member'])) return obj['hydra:member'] as T[];
    // Try member
    if (Array.isArray(obj['member'])) return obj['member'] as T[];
  }
  return [];
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      // Prevent Next.js caching
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Mail.tm API error ${res.status}: ${errText}`);
    }

    // Handle 204 No Content
    if (res.status === 204) return undefined as T;

    return (await res.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// ─── Rate Limiter (8 QPS) ───

let lastRequestTimes: number[] = [];
const QPS_LIMIT = 8;

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  lastRequestTimes = lastRequestTimes.filter((t) => now - t < 1000);

  if (lastRequestTimes.length >= QPS_LIMIT) {
    const oldest = lastRequestTimes[0];
    const waitMs = 1000 - (now - oldest) + 50; // 50ms buffer
    if (waitMs > 0) {
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  lastRequestTimes.push(Date.now());
}

async function rateLimitedRequest<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {}
): Promise<T> {
  await enforceRateLimit();
  return request<T>(method, path, options);
}

// ─── Public API ───

/**
 * Get available domains from mail.tm
 */
export async function getDomains(): Promise<MailTmDomain[]> {
  const res = await rateLimitedRequest<unknown>('GET', '/domains');
  return extractCollection<MailTmDomain>(res);
}

/**
 * Create a temporary email account.
 * Returns the account info. You'll need to call getToken() separately.
 */
export async function createAccount(
  address: string,
  password: string
): Promise<MailTmAccount> {
  return rateLimitedRequest<MailTmAccount>('POST', '/accounts', {
    body: { address, password },
  });
}

/**
 * Get auth token for an account.
 */
export async function getToken(
  address: string,
  password: string
): Promise<MailTmToken> {
  return rateLimitedRequest<MailTmToken>('POST', '/token', {
    body: { address, password },
  });
}

/**
 * Get all messages for the authenticated account.
 */
export async function getMessages(
  token: string
): Promise<MailTmMessageSummary[]> {
  const res = await rateLimitedRequest<unknown>('GET', '/messages', {
    token,
  });
  return extractCollection<MailTmMessageSummary>(res);
}

/**
 * Get a specific message by ID (full content).
 */
export async function getMessage(
  messageId: string,
  token: string
): Promise<MailTmMessageDetail> {
  return rateLimitedRequest<MailTmMessageDetail>(
    'GET',
    `/messages/${messageId}`,
    { token }
  );
}

/**
 * Delete a message.
 */
export async function deleteMessage(
  messageId: string,
  token: string
): Promise<void> {
  await rateLimitedRequest('DELETE', `/messages/${messageId}`, { token });
}

/**
 * Delete an account.
 */
export async function deleteAccount(
  accountId: string,
  token: string
): Promise<void> {
  await rateLimitedRequest('DELETE', `/accounts/${accountId}`, { token });
}

/**
 * Full workflow: create a temporary email with a random address.
 */
export async function createTempEmail(): Promise<{
  address: string;
  password: string;
  accountId: string;
  token: string;
}> {
  // Get available domains
  const domains = await getDomains();
  if (domains.length === 0) {
    throw new Error('No available domains from mail.tm');
  }

  // Pick a random domain
  const domain = domains[Math.floor(Math.random() * domains.length)];

  // Generate random username (12 chars)
  const username = Array.from({ length: 12 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]
  ).join('');

  const address = `${username}@${domain.domain}`;
  const password = Array.from({ length: 16 }, () =>
    'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%'[
      Math.floor(Math.random() * 62)
    ]
  ).join('');

  // Create account
  const account = await createAccount(address, password);

  // Get token
  const tokenData = await getToken(address, password);

  return {
    address,
    password,
    accountId: account.id,
    token: tokenData.token,
  };
}

// ─── Types ───

export type {
  MailTmDomain,
  MailTmAccount,
  MailTmMessageSummary,
  MailTmMessageDetail,
};
