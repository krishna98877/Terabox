/**
 * Tests for message parser, code extractor, and link extractor.
 */

import { htmlToPlainText, getMessageText, summarizeMessage } from '../src/email/messageParser';
import { extractCodesFromMessage } from '../src/email/codeExtractor';
import { extractLinksFromMessage, extractAllLinksFromMessage } from '../src/email/linkExtractor';
import { MessageDetail } from '../src/api/types';

// ─── Helper ───

function makeMessage(overrides: Partial<MessageDetail> = {}): MessageDetail {
  return {
    id: 'test-msg-001',
    from: '"TestService" <no-reply@test.com>',
    to: 'user@example.com',
    subject: 'Your verification code',
    body_text: '',
    body_html: '',
    created_at: '2025-01-01T00:00:00Z',
    attachments: [],
    ...overrides,
  };
}

// ─── Message Parser ───

describe('htmlToPlainText', () => {
  test('strips HTML tags', () => {
    expect(htmlToPlainText('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  test('converts <br> to newlines', () => {
    expect(htmlToPlainText('Line1<br>Line2')).toBe('Line1\nLine2');
  });

  test('decodes HTML entities', () => {
    expect(htmlToPlainText('a &amp; b &lt; c')).toBe('a & b < c');
  });

  test('removes script and style blocks', () => {
    const html = '<script>var x = 1;</script><style>.a{}</style>Hello';
    expect(htmlToPlainText(html)).toBe('Hello');
  });
});

describe('getMessageText', () => {
  test('prefers body_text when available', () => {
    const msg = makeMessage({ body_text: 'Plain text', body_html: '<p>HTML</p>' });
    expect(getMessageText(msg)).toBe('Plain text');
  });

  test('falls back to HTML parsing', () => {
    const msg = makeMessage({ body_text: '', body_html: '<p>HTML content</p>' });
    expect(getMessageText(msg)).toBe('HTML content');
  });

  test('falls back when body_text is whitespace only', () => {
    const msg = makeMessage({ body_text: '   ', body_html: '<p>HTML content</p>' });
    expect(getMessageText(msg)).toBe('HTML content');
  });
});

// ─── Code Extractor ───

describe('extractCodesFromMessage', () => {
  test('extracts 6-digit OTP from text', () => {
    const msg = makeMessage({
      subject: 'Your verification code',
      body_text: 'Your verification code is 123456. It expires in 5 minutes.',
    });
    const codes = extractCodesFromMessage(msg);
    expect(codes.length).toBeGreaterThanOrEqual(1);
    expect(codes[0].code).toBe('123456');
  });

  test('extracts 4-digit OTP from text', () => {
    const msg = makeMessage({
      subject: 'Your PIN',
      body_text: 'Your PIN is 4567.',
    });
    const codes = extractCodesFromMessage(msg);
    expect(codes.length).toBeGreaterThanOrEqual(1);
    expect(codes.some((c) => c.code === '4567')).toBe(true);
  });

  test('extracts code from HTML body', () => {
    const msg = makeMessage({
      subject: 'Verify your email',
      body_html: '<p>Your verification code is <strong>789012</strong></p>',
    });
    const codes = extractCodesFromMessage(msg);
    expect(codes.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty array when no codes found', () => {
    const msg = makeMessage({
      subject: 'Welcome!',
      body_text: 'Thanks for signing up. Enjoy the service!',
    });
    const codes = extractCodesFromMessage(msg);
    expect(codes).toEqual([]);
  });

  test('does not duplicate codes', () => {
    const msg = makeMessage({
      subject: 'Your code',
      body_text: 'verification code: 111111. Again: 111111',
    });
    const codes = extractCodesFromMessage(msg);
    const uniqueCodes = new Set(codes.map((c) => c.code));
    expect(uniqueCodes.size).toBe(codes.length);
  });
});

// ─── Link Extractor ───

describe('extractLinksFromMessage', () => {
  test('extracts verification links from HTML', () => {
    const msg = makeMessage({
      subject: 'Verify your email',
      body_html: '<a href="https://example.com/verify?token=abc123">Click here to verify</a>',
    });
    const links = extractLinksFromMessage(msg);
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].url).toContain('example.com/verify');
    expect(links[0].type).toBe('verification');
  });

  test('extracts reset links from text', () => {
    const msg = makeMessage({
      subject: 'Password reset',
      body_text: 'Reset your password: https://example.com/reset-password?token=xyz',
    });
    const links = extractLinksFromMessage(msg);
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0].type).toBe('reset');
  });

  test('extracts confirmation links', () => {
    const msg = makeMessage({
      subject: 'Confirm your subscription',
      body_html: '<a href="https://example.com/confirm?email=test">Confirm your email</a>',
    });
    const links = extractLinksFromMessage(msg);
    expect(links.length).toBeGreaterThanOrEqual(1);
    // 'confirm' in URL maps to 'verification' by the classifyLink function
    expect(['confirmation', 'verification']).toContain(links[0].type);
  });

  test('returns empty array for messages without links', () => {
    const msg = makeMessage({
      subject: 'Hello',
      body_text: 'Just a plain message with no links.',
    });
    const links = extractLinksFromMessage(msg);
    expect(links).toEqual([]);
  });

  test('extractAllLinksFromMessage includes non-action links', () => {
    const msg = makeMessage({
      subject: 'Newsletter',
      body_text: 'Visit us at https://example.com/blog and verify at https://example.com/verify?token=abc',
    });
    const allLinks = extractAllLinksFromMessage(msg);
    expect(allLinks.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Retry utility ───

import { calculateDelay, isRetryableError } from '../src/utils/retry';

describe('calculateDelay', () => {
  test('increases exponentially', () => {
    const d0 = calculateDelay(0, 1000, 30000, false);
    const d1 = calculateDelay(1, 1000, 30000, false);
    const d2 = calculateDelay(2, 1000, 30000, false);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  test('caps at maxDelay', () => {
    const delay = calculateDelay(100, 1000, 5000, false);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});

describe('isRetryableError', () => {
  test('retries on 429', () => {
    const err = new Error('rate limited') as Error & { statusCode?: number };
    err.statusCode = 429;
    expect(isRetryableError(err)).toBe(true);
  });

  test('retries on 500', () => {
    const err = new Error('server error') as Error & { statusCode?: number };
    err.statusCode = 500;
    expect(isRetryableError(err)).toBe(true);
  });

  test('does not retry on 404', () => {
    const err = new Error('not found') as Error & { statusCode?: number };
    err.statusCode = 404;
    expect(isRetryableError(err)).toBe(false);
  });

  test('retries on network errors (no statusCode)', () => {
    const err = new Error('ECONNREFUSED') as Error & { statusCode?: number };
    expect(isRetryableError(err)).toBe(true);
  });
});

// ─── Rate Limit ───

import { parseRateLimitHeaders } from '../src/utils/rateLimit';

describe('parseRateLimitHeaders', () => {
  test('parses valid headers', () => {
    const result = parseRateLimitHeaders({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '95',
      'x-ratelimit-used': '5',
      'x-ratelimit-reset': '1700000000',
    });
    expect(result.limit).toBe(100);
    expect(result.remaining).toBe(95);
    expect(result.used).toBe(5);
    expect(result.reset).toBe(1700000000);
  });

  test('returns nulls for missing headers', () => {
    const result = parseRateLimitHeaders({});
    expect(result.limit).toBeNull();
    expect(result.remaining).toBeNull();
    expect(result.used).toBeNull();
    expect(result.reset).toBeNull();
  });
});
