/**
 * Link extractor — find verification/confirmation/reset links in email messages.
 */

import { MessageDetail, ExtractedLink } from '../api/types';
import { TempMailClient } from '../api/tempMailClient';
import { getMessageText, getMessageHtml } from './messageParser';
import { logger } from '../utils/logging';

/**
 * Classify a URL based on its path/query keywords.
 */
function classifyLink(url: string): ExtractedLink['type'] {
  const lower = url.toLowerCase();

  if (/verify|confirm|activate|validate/i.test(lower)) return 'verification';
  if (/reset|recover|change-password|forgot/i.test(lower)) return 'reset';
  if (/unsubscribe|opt-out|remove/i.test(lower)) return 'unsubscribe';
  if (/confirm|accept|invite|join/i.test(lower)) return 'confirmation';

  return 'other';
}

/**
 * Check if a URL is likely a verification/action link (not just a navigation link).
 */
function isActionLink(url: string): boolean {
  const actionPatterns = [
    /verify/i, /confirm/i, /activate/i, /validate/i,
    /reset/i, /recover/i, /token=/i, /code=/i,
    /invite/i, /accept/i, /join/i, /subscribe/i, /unsubscribe/i,
    /action=/i, /click/i, /follow/i,
  ];
  return actionPatterns.some((p) => p.test(url));
}

/**
 * Extract links from plain text using URL regex.
 */
function extractLinksFromText(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const matches = text.match(urlRegex) || [];
  // Clean trailing punctuation
  return matches.map((url) => url.replace(/[.,;:!?\)\]]+$/, ''));
}

/**
 * Extract href links from HTML.
 */
function extractLinksFromHtml(html: string): string[] {
  const hrefRegex = /href=["'](https?:\/\/[^"']+)["']/gi;
  const links: string[] = [];
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    links.push(match[1]);
  }

  return links;
}

/**
 * Extract verification/action links from a single message.
 */
export function extractLinksFromMessage(message: MessageDetail): ExtractedLink[] {
  const html = getMessageHtml(message);
  const text = getMessageText(message);

  // Combine links from both HTML and text, dedup
  const htmlLinks = extractLinksFromHtml(html);
  const textLinks = extractLinksFromText(text);
  const allUrls = [...new Set([...htmlLinks, ...textLinks])];

  // Filter to action/verification links
  const actionLinks = allUrls.filter(isActionLink);

  // Classify and return
  return actionLinks.map((url) => ({
    url,
    source: message.id,
    subject: message.subject,
    type: classifyLink(url),
  }));
}

/**
 * Extract ALL links from a message (including non-action ones).
 */
export function extractAllLinksFromMessage(message: MessageDetail): ExtractedLink[] {
  const html = getMessageHtml(message);
  const text = getMessageText(message);

  const htmlLinks = extractLinksFromHtml(html);
  const textLinks = extractLinksFromText(text);
  const allUrls = [...new Set([...htmlLinks, ...textLinks])];

  return allUrls.map((url) => ({
    url,
    source: message.id,
    subject: message.subject,
    type: classifyLink(url),
  }));
}

/**
 * Extract verification links from recent messages in an inbox.
 */
export async function extractLinksFromInbox(
  client: TempMailClient,
  email: string,
  options: { limit?: number; all?: boolean } = {}
): Promise<ExtractedLink[]> {
  const limit = options.limit || 10;
  const messagesResp = await client.getMessages(email);
  const messages = (messagesResp.messages || []).slice(0, limit);

  const allLinks: ExtractedLink[] = [];

  for (const msg of messages) {
    try {
      const detail = await client.getMessage(msg.id);
      const links = options.all
        ? extractAllLinksFromMessage(detail)
        : extractLinksFromMessage(detail);
      allLinks.push(...links);
    } catch (error) {
      logger.warn(`Failed to fetch message ${msg.id} for link extraction: ${(error as Error).message}`);
    }
  }

  logger.info(`Extracted ${allLinks.length} link(s) from ${email}`);
  return allLinks;
}

/**
 * Extract the most likely verification link from a single message.
 * Prefers "verification" type, then "confirmation", then any action link.
 */
export function extractSingleVerificationLink(message: MessageDetail): string | null {
  const links = extractLinksFromMessage(message);

  const preference: ExtractedLink['type'][] = ['verification', 'confirmation', 'reset'];
  for (const type of preference) {
    const found = links.find((l) => l.type === type);
    if (found) return found.url;
  }

  return links.length > 0 ? links[0].url : null;
}
