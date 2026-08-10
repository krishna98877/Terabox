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
const DEFAULT_DOMAINS = ['catchmail.io', 'mailistry.com', 'zeppost.com'];
const TIMEOUT = 25000;

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
  security?: {
    verified: boolean;
    verification_level: string;
    dkim: { status: string | null; has_signature: boolean };
    spf: { status: string | null };
    dmarc: { status: string | null };
  };
  security_badge?: {
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

// ─── Rate Limiter (1 QPS for safety — catchmail.io limits 1/s per IP) ───

let lastRequestTime = 0;

async function enforceRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await new Promise(r => setTimeout(r, 1100 - elapsed));
  }
  lastRequestTime = Date.now();
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
  password: string;  // not used but kept for engine.ts compatibility
}> {
  // Generate random username (14 chars for uniqueness)
  const username = Array.from({ length: 14 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]
  ).join('');

  // Rotate through available domains to avoid blocking
  const customDomain = process.env.CATCHMAIL_CUSTOM_DOMAIN;
  const allDomains = customDomain
    ? [customDomain, ...DEFAULT_DOMAINS]
    : DEFAULT_DOMAINS;
  const domain = allDomains[Math.floor(Math.random() * allDomains.length)];

  const address = `${username}@${domain}`;

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
  const customDomain = process.env.CATCHMAIL_CUSTOM_DOMAIN;
  if (customDomain) {
    return [customDomain, ...DEFAULT_DOMAINS];
  }
  return DEFAULT_DOMAINS;
}

/**
 * Check if a message looks like a TeraBox verification email.
 */
function isTeraBoxVerificationMessage(msg: CatchMailMessageSummary): boolean {
  const subject = (msg.subject || '').toLowerCase();
  const from = (msg.from || '').toLowerCase();

  // TeraBox verification patterns
  if (subject.includes('verification') || subject.includes('verify')) return true;
  if (subject.includes('code') && (from.includes('terabox') || from.includes('1024terabox'))) return true;
  if (from.includes('terabox') || from.includes('1024terabox') || from.includes('terabox.com')) return true;
  if (subject.includes('confirm') || subject.includes('activate')) return true;

  return false;
}

/**
 * Poll a mailbox for new messages.
 * Returns the first new message found, or null if timeout.
 *
 * IMPROVEMENTS over original:
 * - Proper 1 QPS rate limiting (catchmail.io enforces this)
 * - TeraBox-specific message detection (prioritize verification emails)
 * - Faster initial polls (1.5s for first 10 attempts)
 * - More detailed logging
 * - Better error recovery
 *
 * @param address - The full email address to poll
 * @param maxAttempts - Maximum number of poll attempts (default 60)
 * @param intervalMs - Base interval between polls (ms, default 3000)
 * @param sinceDate - Only return messages newer than this date
 */
export async function pollForMessages(
  address: string,
  maxAttempts = 60,
  intervalMs = 3000,
  sinceDate?: Date
): Promise<CatchMailMessageDetail | null> {
  const cutoff = sinceDate || new Date(Date.now() - 120000); // default: 2 min ago
  const startTime = Date.now();

  console.log(`[CatchMail] Polling ${address} for messages (max ${maxAttempts} attempts, cutoff ${cutoff.toISOString()})`);

  let consecutiveErrors = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Adaptive polling: fast initially, then slow down
    // First 10 attempts: 1.5s (respecting 1 QPS API limit)
    // Next 20: 3s
    // After that: intervalMs
    let waitMs: number;
    if (attempt < 10) {
      waitMs = 1500;
    } else if (attempt < 30) {
      waitMs = 3000;
    } else {
      waitMs = intervalMs;
    }
    await new Promise(r => setTimeout(r, waitMs));

    try {
      const inbox = await listMessages(address);
      consecutiveErrors = 0; // reset on success

      if (inbox.messages.length > 0) {
        // Filter for messages newer than our cutoff
        const recentMessages = inbox.messages.filter(m => {
          try {
            return new Date(m.date) >= cutoff;
          } catch {
            return true; // include if date parse fails
          }
        });

        if (recentMessages.length > 0) {
          // Prioritize TeraBox verification emails
          const teraboxMessages = recentMessages.filter(isTeraBoxVerificationMessage);
          const targetMessages = teraboxMessages.length > 0 ? teraboxMessages : recentMessages;

          // Sort by date descending (newest first)
          targetMessages.sort((a, b) => {
            try {
              return new Date(b.date).getTime() - new Date(a.date).getTime();
            } catch {
              return 0;
            }
          });

          const latest = targetMessages[0];
          const detail = await getMessage(latest.id, address);

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`[CatchMail] Message received on attempt ${attempt + 1} (${elapsed}s): "${detail.subject}" from ${detail.from}`);
          console.log(`[CatchMail] Body text preview: ${(detail.body?.text || '').substring(0, 200)}`);
          return detail;
        }
      }

      // Log progress
      const attemptNum = attempt + 1;
      if (attemptNum <= 5 || attemptNum % 5 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[CatchMail] Attempt ${attemptNum}/${maxAttempts} (${elapsed}s) — no new messages for ${address} (${inbox.count} total in inbox)`);
      }
    } catch (error) {
      consecutiveErrors++;
      const errMsg = (error as Error).message;
      console.error(`[CatchMail] Poll attempt ${attempt + 1} failed (consecutive: ${consecutiveErrors}): ${errMsg}`);

      // If rate limited (429), wait longer
      if (errMsg.includes('429') || errMsg.includes('rate')) {
        console.log('[CatchMail] Rate limited — waiting 5s before retry');
        await new Promise(r => setTimeout(r, 5000));
      }

      // If too many consecutive errors, abort
      if (consecutiveErrors >= 10) {
        console.error(`[CatchMail] Too many consecutive errors (${consecutiveErrors}) — aborting poll`);
        return null;
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[CatchMail] Polling timed out after ${maxAttempts} attempts (${elapsed}s) for ${address}`);
  return null;
}
