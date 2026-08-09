/**
 * Code extractor — find OTP/verification codes in email messages.
 */

import { MessageDetail, ExtractedCode } from '../api/types';
import { TempMailClient } from '../api/tempMailClient';
import { getMessageText } from './messageParser';
import { logger } from '../utils/logging';

/**
 * Regex patterns for common verification/OTP code formats.
 * Ordered from most specific to least specific.
 */
const CODE_PATTERNS: { name: string; regex: RegExp }[] = [
  // 6-digit numeric OTP (most common)
  { name: '6-digit-otp', regex: /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{6})/i },
  // 4-digit numeric OTP
  { name: '4-digit-otp', regex: /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{4})/i },
  // 8-digit numeric code
  { name: '8-digit-code', regex: /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{8})/i },
  // Alphanumeric code (6-10 chars) with explicit label
  { name: 'alphanumeric-labeled', regex: /(?:verification|verify|code|token)[^\w]*([A-Z0-9]{6,10})/i },
  // Generic 6-digit number in its own line or after a colon
  { name: '6-digit-standalone', regex: /(?:[:\s])(\d{6})(?:[\s.,]|$)/ },
  // Code in quotes or brackets
  { name: 'code-in-brackets', regex: /[`"'\[\(](\d{4,8})[`"'\]\)]/ },
  // Generic alphanumeric code in quotes
  { name: 'alphanumeric-in-quotes', regex: /[`"'\[\(]([A-Z0-9]{6,12})[`"'\]\)]/i },
];

/**
 * Extract verification codes from a single message.
 */
export function extractCodesFromMessage(message: MessageDetail): ExtractedCode[] {
  const text = getMessageText(message);
  const codes: ExtractedCode[] = [];
  const seen = new Set<string>();

  for (const { name, regex } of CODE_PATTERNS) {
    // Use global flag to find all matches
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let match;

    while ((match = globalRegex.exec(text)) !== null) {
      const code = match[1];
      if (code && !seen.has(code)) {
        seen.add(code);
        codes.push({
          code,
          source: message.id,
          subject: message.subject,
          pattern: name,
        });
      }
    }
  }

  return codes;
}

/**
 * Extract verification codes from recent messages in an inbox.
 * Fetches message details for each summary and scans for codes.
 */
export async function extractCodesFromInbox(
  client: TempMailClient,
  email: string,
  options: { limit?: number; minAge?: number } = {}
): Promise<ExtractedCode[]> {
  const limit = options.limit || 10;
  const messagesResp = await client.getMessages(email);
  const messages = (messagesResp.messages || []).slice(0, limit);

  const allCodes: ExtractedCode[] = [];

  for (const msg of messages) {
    try {
      const detail = await client.getMessage(msg.id);
      const codes = extractCodesFromMessage(detail);
      allCodes.push(...codes);
    } catch (error) {
      logger.warn(`Failed to fetch message ${msg.id} for code extraction: ${(error as Error).message}`);
    }
  }

  logger.info(`Extracted ${allCodes.length} verification code(s) from ${email}`);
  return allCodes;
}

/**
 * Extract the most likely verification code from a single message.
 * Returns the first code found (most specific pattern) or null.
 */
export function extractSingleCode(message: MessageDetail): string | null {
  const codes = extractCodesFromMessage(message);
  return codes.length > 0 ? codes[0].code : null;
}
