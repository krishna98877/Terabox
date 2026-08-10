/**
 * CatchMail.io API Client — Free disposable email API.
 * https://catchmail.io/docs
 *
 * HOW IT WORKS:
 * - NO account creation needed
 * - NO auth/token needed
 * - Just pick ANY address @catchmail.io and start receiving
 * - Poll /api/v1/mailbox?address=... to list messages
 * - Get /api/v1/message/{id}?mailbox=... for full content
 *
 * This is FAR simpler and more reliable than Mail.tm which requires
 * account creation + token management and often gets blocked.
 */

const BASE_URL = 'https://api.catchmail.io';
const DEFAULT_DOMAIN = 'catchmail.io';
const TIMEOUT = 20000;

// ─── Types ───

export interface CatchMailMessageSummary {
  id: string;
  mailbox: string;
  from: string;
  subject: string;
  date: string;
  size: number;
}

export interface CatchMailMessageDetail extends CatchMailMessageSummary {
  to: string[];
  headers: Record<string, string | string[]>;
  body: {
    text: string;
    html: string;
  };
  attachments: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
  }>;
  security: {
    verified: boolean;
    verification_level: string;
    dkim: { status: string | null; has_signature: boolean };
    spf: { status: string | null };
    dmarc: { status: string | null };
  };
  security_badge: {
    label: string;
    color: string;
    icon: string;
  };
}

export interface CatchMailInbox {
  address: string;
  page: number;
  page_size: number;
  messages: CatchMailMessageSummary[];
  count: number;
}

// ─── Rate Limiter (10 QPS to be safe) ───

let lastRequestTimes: number[] = [];
const QPS_LIMIT = 10;

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  lastRequestTimes = lastRequestTimes.filter(t => now - t < 1000);
  if (lastRequestTimes.length >= QPS_LIMIT) {
    const oldest = lastRequestTimes[0];
    const waitMs = 1000 - (now - oldest) + 50;
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
  }
  lastRequestTimes.push(Date.now());
}

// ─── Core API Request ───

async function apiRequest<T>(
  method: string,
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  await enforceRateLimit();

  const qs = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${path}${qs ? '?' + qs : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'TeraBoxAgent/1.0',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`CatchMail API error ${res.status}: ${errText}`);
    }

    return (await res.json()) as T;
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
}

// ─── Public API ───

/**
 * List all messages in a mailbox.
 * Returns summary info (id, from, subject, date, size).
 */
export async function listMessages(
  address: string,
  page = 1,
  pageSize = 50
): Promise<CatchMailInbox> {
  return apiRequest<CatchMailInbox>('GET', '/api/v1/mailbox', {
    address,
    page: String(page),
    page_size: String(pageSize),
  });
}

/**
 * Get full message details including body text/html.
 */
export async function getMessage(
  messageId: string,
  mailbox: string
): Promise<CatchMailMessageDetail> {
  return apiRequest<CatchMailMessageDetail>(
    'GET',
    `/api/v1/message/${encodeURIComponent(messageId)}`,
    { mailbox }
  );
}

/**
 * Delete a message.
 */
export async function deleteMessage(
  messageId: string,
  mailbox: string
): Promise<void> {
  await apiRequest('DELETE', `/api/v1/message/${encodeURIComponent(messageId)}`, {
    mailbox,
  });
}

/**
 * Create a temporary email address.
 * With CatchMail, there's NO account creation — just pick a random address.
 * This function generates one and returns it immediately.
 *
 * The address is "created" implicitly when the first email arrives.
 */
export async function createTempEmail(): Promise<{
  address: string;
  accountId: string;
  token: string;  // not used but kept for engine.ts compatibility
  password: string;  // not used but kept" kept for engine.ts compatibility
}> {
  // Generate random username (14 chars for uniqueness)
  const username = Array.from({ length: 14 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]
  ).join('');

  const address = `${username}@${DEFAULT_DOMAIN}`;

  console.log(`[CatchMail] Created temp email: ${address} (no API call needed)`);

  return {
    address,
    accountId: address, // CatchMail uses the address as ID
    token: 'catchmail-no-token-needed', // no auth needed
    password: '', // no password needed
  };
}

/**
 * Get available domains. CatchMail uses catchmail.io by default.
 * Also supports custom domains if configured via MX records.
 */
export async function getDomains(): Promise<string[]> {
  // CatchMail.io always supports catchmail.io domain
  // Custom domains can be added via DNS MX records
  const customDomain = process.env.CATCHMAIL_CUSTOM_DOMAIN;
  if (customDomain) {
    return [DEFAULT_DOMAIN, customDomain];
  }
  return [DEFAULT_DOMAIN];
}

/**
 * Poll a mailbox for new messages.
 * Returns the first new message found, or null if timeout.
 *
 * @param address - The full email address to poll
 * @param maxAttempts - Maximum number of poll attempts
 * @param intervalMs - Base interval between polls (ms)
 * @param sinceDate - Only return messages newer than this date
 */
export async function pollForMessages(
  address: string,
  maxAttempts = 50,
  intervalMs = 4000,
  sinceDate?: Date
): Promise<CatchMailMessageDetail | null> {
  const cutoff = sinceDate || new Date(Date.now() - 60000); // default: 1 min ago

  console.log(`[CatchMail] Polling ${address} for messages (max ${maxAttempts} attempts, cutoff ${cutoff.toISOString()})`);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Faster polling initially (2s for first 15), then slow down
    const waitMs = attempt < 15 ? 2000 : intervalMs;
    await new Promise(r => setTimeout(r, waitMs));

    try {
      const inbox = await listMessages(address);

      if (inbox.messages.length > 0) {
        // Find the most recent message that's newer than our cutoff
        const recentMessages = inbox.messages.filter(m => {
          try {
            return new Date(m.date) >= cutoff;
          } catch {
            return true; // include if date parse fails
          }
        });

        if (recentMessages.length > 0) {
          // Get the latest message's full details
          const latest = recentMessages[recentMessages.length - 1];
          const detail = await getMessage(latest.id, address);

          console.log(`[CatchMail] Message received on attempt ${attempt + 1}: "${detail.subject}" from ${detail.from}`);
          return detail;
        }
      }

      // Log every 10th attempt
      if ((attempt + 1) % 10 === 0) {
        console.log(`[CatchMail] Attempt ${attempt + 1}/${maxAttempts} — no new messages for ${address} (${inbox.count} total)`);
      }
    } catch (error) {
      console.error(`[CatchMail] Poll attempt ${attempt + 1} failed: ${(error as Error).message}`);
      // Don't abort on poll failure — retry next attempt
      // But if it's a 404, the mailbox might not exist yet (shouldn't happen with CatchMail)
    }
  }

  console.log(`[CatchMail] Polling timed out after ${maxAttempts} attempts for ${address}`);
  return null;
}
