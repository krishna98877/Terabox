/**
 * Verification code and link extraction utilities.
 * Enhanced for TeraBox OTP emails specifically.
 *
 * TeraBox OTP email patterns (observed):
 * - Subject: "TeraBox Verification Code" or "Your verification code"
 * - Body: "Your verification code is 123456" or just a standalone 6-digit code
 * - May also include verification links
 */

/**
 * Extract verification codes (OTP, PIN, numeric codes) from text.
 * Tries multiple patterns from most specific to most generic.
 */
export function extractVerificationCode(text: string): string | null {
  // Pattern priority: most specific first
  const patterns = [
    // "verification code is 123456" or "code: 123456"
    /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{6})/i,
    /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{4})/i,
    /(?:verification|verify|OTP|code|PIN|passcode)[^\d]*(\d{8})/i,

    // TeraBox-specific: "Your code is 123456"
    /(?:your\s+code\s+(?:is\s+)?)\s*(\d{4,8})/i,

    // "enter 123456" or "use 123456"
    /(?:enter|use|input|type)\s+(?:code\s+)?(\d{4,8})/i,

    // Standalone 6-digit code (most common for OTP)
    /(?:[:\s])(\d{6})(?:[\s.,]|$)/,

    // Code in brackets/quotes
    /[`"'\[\(](\d{4,8})[`"'\]\)]/,

    // TeraBox pattern: code appears alone on a line
    /(?:^|\n)\s*(\d{6})\s*(?:\n|$)/m,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }

  return null;
}

/**
 * Extract OTP from HTML body.
 * TeraBox emails often put the code in a styled div/span.
 */
export function extractOtpFromHtml(html: string): string | null {
  // Look for code in bold/styled elements
  const htmlPatterns = [
    // <b>123456</b> or <strong>123456</strong>
    /<(?:b|strong|span|div|p)[^>]*>\s*(\d{6})\s*<\/(?:b|strong|span|div|p)>/i,
    // font-size large (codes are often displayed large)
    /<[^>]*font-size:\s*(?:2[0-9]|3[0-9])[^>]*>\s*(\d{4,8})\s*<\/[^>]+>/i,
    // class containing "code" or "otp"
    /<[^>]*class="[^"]*(?:code|otp|verify)[^"]*"[^>]*>\s*(\d{4,8})\s*<\/[^>]+>/i,
  ];

  for (const pattern of htmlPatterns) {
    const match = html.match(pattern);
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
  links.push(...textLinks.map(url => url.replace(/[.,;:!?\)\]]+$/, '')));

  // Filter for verification/action links
  const actionPatterns = [
    /verify/i, /confirm/i, /activate/i, /validate/i,
    /reset/i, /token=/i, /code=/i, /invite/i, /accept/i,
    /register/i, /signup/i, /sign-up/i,
  ];

  for (const link of links) {
    if (actionPatterns.some(p => p.test(link))) {
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
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
