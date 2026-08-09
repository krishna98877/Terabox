/**
 * Message parser — extract plain text from HTML, clean up message bodies.
 */

import { MessageDetail } from '../api/types';

/**
 * Strip HTML tags and decode common entities to get plain text.
 */
export function htmlToPlainText(html: string): string {
  return html
    // Remove script/style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Convert <br> and block closures to newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Collapse whitespace but preserve intentional newlines
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .trim();
}

/**
 * Get the best available text body from a message.
 * Prefers body_text if available and non-empty, otherwise parses body_html.
 */
export function getMessageText(message: MessageDetail): string {
  if (message.body_text && message.body_text.trim().length > 0) {
    return message.body_text.trim();
  }
  return htmlToPlainText(message.body_html || '');
}

/**
 * Get the full HTML body of a message.
 */
export function getMessageHtml(message: MessageDetail): string {
  return message.body_html || '';
}

/**
 * Summarize a message for display.
 */
export function summarizeMessage(message: MessageDetail, maxLength: number = 200): {
  id: string;
  from: string;
  to: string;
  subject: string;
  textPreview: string;
  createdAt: string;
  attachmentCount: number;
} {
  const text = getMessageText(message);
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    subject: message.subject,
    textPreview: text.length > maxLength ? text.substring(0, maxLength) + '...' : text,
    createdAt: message.created_at,
    attachmentCount: message.attachments?.length || 0,
  };
}
