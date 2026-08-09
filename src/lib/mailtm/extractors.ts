/**
 * Verification code and link extraction utilities.
 */

/**
 * Extract verification codes (OTP, PIN, numeric codes) from text.
 */
export function extractVerificationCode(text: string): string | null {
  const patterns = [
    /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{6})/i,
    /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{4})/i,
    /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{8})/i,
    /(?:[:\s])(\d{6})(?:[\s.,]|$)/,
    /[`"'\[\(](\d{4,8})[`"'\]\)]/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Extract verification/confirmation links from HTML or text.
 */
export function extractVerificationLink(html: string, text: string): string | null {
  // From HTML href attributes
  const hrefPatterns = /href=["'](https?:\/\/[^"']+)["']/gi;
  const links: string[] = [];
  let match;

  while ((match = hrefPatterns.exec(html)) !== null) {
    links.push(match[1]);
  }

  // From plain text URLs
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
  const textLinks = text.match(urlRegex) || [];
  links.push(...textLinks.map((url) => url.replace(/[.,;:!?\)\]]+$/, '')));

  // Filter for verification/action links
  const actionPatterns = [
    /verify/i, /confirm/i, /activate/i, /validate/i,
    /reset/i, /token=/i, /code=/i, /invite/i, /accept/i,
  ];

  for (const link of links) {
    if (actionPatterns.some((p) => p.test(link))) {
      return link;
    }
  }

  return null;
}

/**
 * Strip HTML tags to get plain text.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
