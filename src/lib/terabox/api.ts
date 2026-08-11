/**
 * TeraBox API Client — Passport signup + Share/Referral tracking.
 *
 * PASSPORT FLOW (signup):
 * 1. POST /passport/getpubkey → Get RSA public key for email encryption
 * 2. POST /passport/register_v4/sendcode → Send OTP to email (may require captcha)
 * 3. If captcha needed (errno 400090/460030): solve reCAPTCHA → retry with g_identity
 * 4. POST /passport/register_v4/verify → Verify OTP code
 * 5. POST /passport/register_v4/finish → Set password, complete registration
 *
 * SHARE/REFERRAL FLOW (the key to earning referral credit):
 * 1. GET  /api/shorturlinfo → Get share info (shareid, uk, sign, surl)
 * 2. POST /passport/login → Login with new account → get bdstoken
 * 3. POST /share/transfer → Save shared file to new account → REFERRAL CREDIT!
 * 4. POST /api/analytics → Track the view/download event
 *
 * The email is RSA-encrypted using the pubkey from step 1.
 *
 * ★ Proxy support: setProxyUrl() allows rotating proxies for API calls,
 *   reducing captcha triggers from IP-based rate limits.
 *
 * ★★★ Session support: Cookie jar maintained between requests.
 *   TeraBox uses cookies for session tracking, risk scoring, and referral attribution.
 *   Without cookies, every request looks like a fresh suspicious hit → captcha!
 */

import { proxiedFetch } from '@/lib/http/proxied-fetch';

// TeraBox has multiple domains — try them in order if one fails
const BASE_URLS = [
  'https://www.1024terabox.com',
  'https://www.terabox.com',
  'https://www.dubox.com',
];
let activeBaseUrl = BASE_URLS[0];
const APP_ID = '250528';
const PASS_VERSION_RECAPTCHA = '3.0'; // Updated: TeraBox now uses v3.0+ for reCAPTCHA Enterprise

// ─── Proxy Support ───
// Proxy URL for TeraBox API calls (set by engine.ts from the proxy pool)
let _proxyUrl: string | null = null;

/**
 * Set the proxy URL for TeraBox API requests.
 * This allows API-path signups to use rotating proxies,
 * avoiding IP-based rate limits and captcha triggers.
 */
export function setProxyUrl(url: string | null): void {
  _proxyUrl = url;
  if (url) {
    console.log(`[TeraBox API] Proxy set: ${url}`);
  }
}

// ─── Cookie Jar (session state) ───
// TeraBox sets cookies on share link visits, login, etc.
// We MUST persist and re-send these cookies to maintain session state.
// Without cookies → TeraBox treats each request as new → higher captcha risk.

let _cookieJar: Map<string, string> = new Map();

/**
 * Parse Set-Cookie headers and add to the jar.
 */
function storeCookies(setCookieHeaders: string[]): void {
  for (const header of setCookieHeaders) {
    // Parse "name=value; Path=/; Domain=.terabox.com; ..."
    const parts = header.split(';')[0]; // Just the name=value part
    const [name, ...valueParts] = parts.split('=');
    if (name && valueParts.length > 0) {
      _cookieJar.set(name.trim(), valueParts.join('=').trim());
    }
  }
}

/**
 * Get the Cookie header string from the jar.
 */
function getCookieString(): string {
  return Array.from(_cookieJar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/**
 * Clear the cookie jar (for fresh sessions).
 */
export function clearCookies(): void {
  _cookieJar = new Map();
}

/**
 * Get current cookies (for debugging).
 */
export function getCookieCount(): number {
  return _cookieJar.size;
}

// ─── Modern Chrome Headers ───
// TeraBox risk detection checks for modern browser headers.
// Missing sec-ch-ua, sec-fetch-* etc. flags the request as bot-like.

const CHROME_VERSION = '126';
const CHROME_FULL_VERSION = '126.0.0.0';

function getChromeHeaders(baseUrl: string, extraHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`,
    'Referer': `${baseUrl}/`,
    'Origin': baseUrl,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua': `"Not/A)Brand";v="8", "Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    ...extraHeaders,
  };
}

// ─── Types ───

export interface TeraBoxSignupResult {
  success: boolean;
  email: string;
  password?: string;
  token?: string;
  error?: string;
  steps: string[];
  needsCaptcha?: boolean;
  captchaSiteKey?: string;
}

// ─── Get Common Params ───

function getCommonParams(): Record<string, string | number> {
  return {
    app_id: APP_ID,
    web: 1,
    channel: 'dubox',
    clienttype: 0,
  };
}

// ─── API Request ───

async function passportPost(
  endpoint: string,
  bodyParams: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Promise<{ data: any; status: number }> {
  const qs = getCommonParams();
  const paramStr = new URLSearchParams(
    Object.entries(qs).map(([k, v]) => [k, String(v)])
  ).toString();
  // Try each TeraBox domain until one works
  let lastError: Error | null = null;

  for (const baseUrl of BASE_URLS) {
    const url = `${baseUrl}${endpoint}?${paramStr}`;

    // ★ Build headers with modern Chrome headers + cookies from session
    const headers = getChromeHeaders(baseUrl, extraHeaders);
    const cookieStr = getCookieString();
    if (cookieStr) {
      headers['Cookie'] = cookieStr;
    }

    const body = new URLSearchParams(
      Object.entries(bodyParams).map(([k, v]) => [k, String(v)])
    ).toString();

    try {
      const res = await proxiedFetch(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
        proxyUrl: _proxyUrl || undefined,
      });

      // ★ Store any Set-Cookie headers for session continuity
      const setCookies = (res as any).headers?.getSetCookie?.() || [];
      if (setCookies.length > 0) {
        storeCookies(setCookies);
      }

      const data = await res.json();
      // This domain worked — remember it for next time
      activeBaseUrl = baseUrl;
      return { data, status: res.status };
    } catch (error) {
      lastError = error as Error;
      console.warn(`[TeraBox API] ${baseUrl} failed: ${(error as Error).message} — trying next domain`);
      continue;
    }
  }

  // All domains failed
  return { data: { errno: -1, errmsg: lastError?.message || 'All TeraBox domains failed' }, status: 0 };
}

// ─── Public API ───

/**
 * Step 1: Get RSA public key for encryption.
 */
export async function getPubKey(): Promise<{ pp1: string; pp2: string; pp4: string; pubkey: string } | null> {
  const { data } = await passportPost('/passport/getpubkey', {});

  // TeraBox returns code: 0 on success (not errno)
  if (data.errno === 0 || data.code === 0) {
    const result = {
      pp1: data.data?.pp1 || data.pp1 || '',
      pp2: data.data?.pp2 || data.pp2 || '',
      pp4: data.data?.pp4 || data.pp4 || '',
      // TeraBox doesn't return a "pubkey" field — pp1 IS the RSA key (Base64 encoded)
      pubkey: data.data?.pubkey || data.pubkey || data.data?.pp1 || data.pp1 || '',
    };
    console.log(`[TeraBox API] getpubkey OK — pp1 length: ${result.pp1.length}, pp2: ${result.pp2}`);
    return result;
  }
  console.error('[TeraBox API] getpubkey failed:', data.errmsg || data.msg || data);
  return null;
}

/**
 * Step 2: Send verification code to email.
 * May return errno 400090 or 460030 requiring reCAPTCHA.
 */
export async function sendVerificationCode(
  email: string,
  gIdentity?: string,
  encrypted?: boolean
): Promise<{
  success: boolean;
  token?: string;
  canSkipCode?: boolean;
  retryPeriod?: number;
  needsCaptcha?: boolean;
  error?: string;
  errno?: number;
}> {
  const bodyParams: Record<string, unknown> = {
    email,
    op_type: 1,
    pass_version: PASS_VERSION_RECAPTCHA,
    reg_source: 'share',
    koltype: 0,
  };

  if (gIdentity) {
    bodyParams.g_identity = gIdentity;
  }

  const extraHeaders: Record<string, string> = {};
  if (encrypted) {
    extraHeaders['fs-ex-st'] = '1';
  }

  // ★ Debug: Log what we're sending to TeraBox
  console.log(`[TeraBox API] sendcode: email=${email.substring(0, 5)}***, g_identity=${gIdentity ? `${gIdentity.substring(0, 15)}... (${gIdentity.length} chars)` : 'none'}, encrypted=${encrypted}`);

  const { data } = await passportPost(
    '/passport/register_v4/sendcode',
    bodyParams,
    extraHeaders
  );

  const errno = data.errno ?? data.error_code ?? data.code;
  console.log(`[TeraBox API] sendcode response: errno=${errno}, data=${JSON.stringify(data).substring(0, 200)}`);

  // Success
  if (errno === 0) {
    console.log(`[TeraBox API] sendcode SUCCESS — OTP sent to email`);
    return {
      success: true,
      token: data.data?.token || data.token,
      canSkipCode: data.data?.can_skip_code || data.can_skip_code,
      retryPeriod: data.data?.retry_period || data.retry_period,
    };
  }

  // Need reCAPTCHA
  if (errno === 400090 || errno === 460030 || errno === 106) {
    console.warn(`[TeraBox API] sendcode needs captcha (errno ${errno}) — captcha token was ${gIdentity ? 'provided but rejected' : 'not provided'}`);
    return {
      success: false,
      needsCaptcha: true,
      errno,
      error: `Need reCAPTCHA verification (errno ${errno})`,
    };
  }

  // Other error
  console.error(`[TeraBox API] sendcode error: errno=${errno}, msg=${data.errmsg || data.msg}`);
  return {
    success: false,
    errno,
    error: data.errmsg || data.msg || `Error ${errno}`,
  };
}

/**
 * Step 3: Verify the OTP code.
 */
export async function verifyCode(
  token: string,
  code: string,
  gIdentity?: string
): Promise<{
  success: boolean;
  error?: string;
  errno?: number;
}> {
  const bodyParams: Record<string, unknown> = {
    token,
    code,
  };

  if (gIdentity) {
    bodyParams.g_identity = gIdentity;
  }

  const { data } = await passportPost(
    '/passport/register_v4/verify',
    bodyParams
  );

  const errno = data.errno ?? data.error_code ?? data.code;
  console.log(`[TeraBox API] verify response: errno=${errno}, g_identity=${gIdentity ? 'provided' : 'none'}`);

  if (errno === 0) {
    console.log(`[TeraBox API] verify SUCCESS — OTP verified`);
    return { success: true };
  }

  console.warn(`[TeraBox API] verify failed: errno=${errno}, msg=${data.errmsg || data.msg || ''}`);
  return {
    success: false,
    errno,
    error: data.errmsg || data.msg || `Verify error ${errno}`,
  };
}

/**
 * Step 4: Finish registration with password.
 */
export async function finishRegistration(
  token: string,
  encryptedPwd: string,
  gIdentity?: string
): Promise<{
  success: boolean;
  error?: string;
  errno?: number;
}> {
  const bodyParams: Record<string, unknown> = {
    token,
    pwd: encryptedPwd,
    membership_info: '1',
    reg_source: 'share',
  };

  if (gIdentity) {
    bodyParams.g_identity = gIdentity;
  }

  const { data } = await passportPost(
    '/passport/register_v4/finish',
    bodyParams
  );

  const errno = data.errno ?? data.error_code ?? data.code;
  console.log(`[TeraBox API] finish response: errno=${errno}, g_identity=${gIdentity ? 'provided' : 'none'}`);

  if (errno === 0) {
    console.log(`[TeraBox API] finish SUCCESS — registration complete`);
    return { success: true };
  }

  console.warn(`[TeraBox API] finish failed: errno=${errno}, msg=${data.errmsg || data.msg || ''}`);
  return {
    success: false,
    errno,
    error: data.errmsg || data.msg || `Finish error ${errno}`,
  };
}

/**
 * Get the reCAPTCHA site key.
 * Can be overridden via RECAPTCHA_SITE_KEY env var (in case TeraBox rotates it).
 * Default: TeraBox's known site key for passport/signup flow.
 */
export function getRecaptchaSiteKey(): string {
  return process.env.RECAPTCHA_SITE_KEY || '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';
}

/**
 * RSA encrypt data using TeraBox's public key.
 * TeraBox uses standard RSA with the pubkey from /passport/getpubkey.
 */
export function rsaEncrypt(data: string, pubkeyStr: string): string {
  try {
    const forge = require('node-forge');
    const pki = forge.pki;
    
    // Parse the public key
    const publicKey = pki.publicKeyFromPem(
      '-----BEGIN PUBLIC KEY-----\n' +
      pubkeyStr +
      '\n-----END PUBLIC KEY-----'
    );
    
    // Encrypt the data
    const encrypted = publicKey.encrypt(data, 'RSAES-PKCS1-V1_5');
    
    // Return base64 encoded
    return forge.util.encode64(encrypted);
  } catch (err) {
    console.error('[TeraBox API] RSA encryption failed:', (err as Error).message);
    // Fallback: return raw data (will likely fail but better than nothing)
    return data;
  }
}

/**
 * Simple password encoding for TeraBox.
 * TeraBox expects RSA-encrypted password using pubkey from getpubkey.
 */
export function encodePassword(password: string, pubkey?: string): string {
  if (!pubkey) return password;
  return rsaEncrypt(password, pubkey);
}

/**
 * Encrypt email for TeraBox API (with fs-ex-st header).
 */
export function encryptEmail(email: string, pubkey?: string): string {
  if (!pubkey) return email;
  return rsaEncrypt(email, pubkey);
}

// ─────────────────────────────────────────────────
// Share / Referral API (the missing piece!)
// ─────────────────────────────────────────────────

/**
 * Get share link info — returns shareid, uk, sign, file list, etc.
 * This is the FIRST call when visiting a /s/ share link.
 *
 * API: GET /api/shorturlinfo?shorturl=1_xxx&root=1&scene=
 */
export async function getShareInfo(shorturl: string): Promise<{
  success: boolean;
  shareid?: string;
  uk?: string;
  sign?: string;
  surl?: string;
  shorturl?: string;
  files?: any[];
  errno?: number;
  error?: string;
}> {
  // The shorturl in the API needs the "1_" prefix
  const fullShorturl = shorturl.startsWith('1_') ? shorturl : `1_${shorturl}`;

  const qs = new URLSearchParams({
    ...getCommonParams() as Record<string, string>,
    shorturl: fullShorturl,
    root: '1',
    scene: '',
  });

  for (const baseUrl of BASE_URLS) {
    try {
      const headers: Record<string, string> = {
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`,
        'Referer': `${baseUrl}/`,
        'Accept': 'application/json, text/plain, */*',
        'sec-ch-ua': `"Not/A)Brand";v="8", "Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}"`,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      };
      const cookieStr = getCookieString();
      if (cookieStr) headers['Cookie'] = cookieStr;

      const res = await proxiedFetch(`${baseUrl}/api/shorturlinfo?${qs}`, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
        proxyUrl: _proxyUrl || undefined,
      });

      // Store cookies
      const setCookies = (res as any).headers?.getSetCookie?.() || [];
      if (setCookies.length > 0) storeCookies(setCookies);

      const data = await res.json();
      const errno = data.errno ?? data.error_code ?? data.code;

      if (errno === 0) {
        activeBaseUrl = baseUrl;
        return {
          success: true,
          shareid: String(data.shareid || data.data?.shareid || ''),
          uk: String(data.uk_str || data.uk || data.data?.uk_str || ''),
          sign: String(data.sign || data.data?.sign || ''),
          surl: String(data.surl || data.data?.surl || ''),
          shorturl: String(data.shorturl || data.data?.shorturl || ''),
          files: data.list || data.data?.list || [],
        };
      }

      console.warn(`[TeraBox API] shorturlinfo errno ${errno}: ${data.errmsg || ''}`);
      return { success: false, errno, error: data.errmsg || `Error ${errno}` };
    } catch (err) {
      console.warn(`[TeraBox API] ${baseUrl} shorturlinfo failed: ${(err as Error).message}`);
    }
  }

  return { success: false, error: 'All TeraBox domains failed for shorturlinfo' };
}

/**
 * Login to TeraBox with email + password → get bdstoken (auth token).
 * Needed for authenticated calls like /share/transfer.
 *
 * API: POST /passport/login
 */
export async function loginToTerabox(
  email: string,
  password: string,
  pubkey?: string
): Promise<{
  success: boolean;
  bdstoken?: string;
  uk?: string;
  cookies?: string;
  error?: string;
  errno?: number;
}> {
  const encryptedEmail = pubkey ? encryptEmail(email, pubkey) : email;
  const encryptedPwd = pubkey ? encodePassword(password, pubkey) : password;
  const isEncrypted = !!pubkey;

  const extraHeaders: Record<string, string> = {};
  if (isEncrypted) {
    extraHeaders['fs-ex-st'] = '1';
  }

  const { data } = await passportPost('/passport/login', {
    username: encryptedEmail,
    pwd: encryptedPwd,
    pass_version: PASS_VERSION_RECAPTCHA,
    verifychannel: '',
    countrycode: '',
    clientfrom: 'web',
  }, extraHeaders);

  const errno = data.errno ?? data.error_code ?? data.code;

  if (errno === 0) {
    return {
      success: true,
      bdstoken: data.data?.bdstoken || data.bdstoken || '',
      uk: data.data?.uk || data.uk || '',
    };
  }

  return {
    success: false,
    errno,
    error: data.errmsg || data.msg || `Login error ${errno}`,
  };
}

/**
 * ★★★ THE KEY API — Transfer (save) a shared file to your own account ★★★
 *
 * THIS is what triggers the referral credit in TeraBox's backend.
 * When a new user saves a shared file, TeraBox creates a link between
 * the new user and the sharer → referral attribution → earnings.
 *
 * API: POST /share/transfer
 * Default params: ondup="newcopy", async=1, scene="purchased_list"
 * Additional params: shareid, from (uk), sekey, path, fs_id, bdstoken
 */
export async function shareTransfer(params: {
  shareid: string;
  from: string;        // sharer's uk
  bdstoken: string;   // auth token from login
  sekey?: string;     // sign + timestamp
  path?: string;      // file path to transfer
  fs_id?: string;     // file system ID
  dir?: string;       // destination directory
}): Promise<{
  success: boolean;
  taskid?: string;
  errno?: number;
  error?: string;
}> {
  const bodyParams: Record<string, unknown> = {
    ondup: 'newcopy',
    async: 1,
    scene: 'purchased_list',
    bdstoken: params.bdstoken,
    shareid: params.shareid,
    from: params.from,
    dir: params.dir || '/',
    list: JSON.stringify([{ path: params.path || '/', fs_id: params.fs_id || '' }]),
  };

  if (params.sekey) {
    bodyParams.sekey = params.sekey;
  }

  const { data } = await passportPost('/share/transfer', bodyParams);

  const errno = data.errno ?? data.error_code ?? data.code;

  if (errno === 0) {
    console.log(`[TeraBox API] share/transfer SUCCESS! File saved to account.`);
    return {
      success: true,
      taskid: data.taskid || data.data?.taskid || '',
    };
  }

  console.warn(`[TeraBox API] share/transfer errno ${errno}: ${data.errmsg || ''}`);
  return {
    success: false,
    errno,
    error: data.errmsg || data.msg || `Transfer error ${errno}`,
  };
}

/**
 * Track analytics event — used by TeraBox to count views/downloads.
 * This fires when a user visits a share link or downloads a file.
 *
 * API: POST /api/analytics
 */
export async function trackAnalytics(
  type: string,
  currentUrl: string,
  extra?: Record<string, unknown>
): Promise<boolean> {
  try {
    const bodyParams = {
      type,
      clienttype: 0,
      version: 'v5',
      currentUrl,
      client: 'web',
      ...extra,
    };

    await passportPost('/api/analytics', bodyParams);
    return true;
  } catch {
    return false;
  }
}

/**
 * Report user activity — TeraBox uses this for daily active tracking.
 *
 * API: POST /api/report/user
 */
export async function reportUserActivity(
  bdstoken: string,
  action: string = 'webv4_main'
): Promise<boolean> {
  try {
    await passportPost('/api/report/user', {
      bdstoken,
      action,
      timestamp: Math.floor(Date.now() / 1000),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract surl from a TeraBox share link.
 * e.g. "https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ" → "1_9hqBxA_U6WRc9FUhHl1zQ"
 */
export function extractSurlFromLink(link: string): string {
  const match = link.match(/\/s\/([^/?\s]+)/);
  return match ? match[1] : '';
}

/**
 * Visit a share link — sets referral cookies and fires analytics.
 * This should be called BEFORE signup so the referral tracking is set.
 *
 * ★★★ IMPORTANT: This now stores cookies in the session jar, so subsequent
 *   passport API calls will carry the referral cookies!
 *   Without this, TeraBox can't attribute the signup to the referrer.
 */
export async function visitShareLink(
  referralLink: string
): Promise<{ success: boolean; cookies?: string; error?: string }> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'sec-ch-ua': `"Not/A)Brand";v="8", "Chromium";v="${CHROME_VERSION}", "Google Chrome";v="${CHROME_VERSION}"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'Upgrade-Insecure-Requests': '1',
    };

    // Add existing cookies
    const cookieStr = getCookieString();
    if (cookieStr) headers['Cookie'] = cookieStr;

    const res = await proxiedFetch(referralLink, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
      proxyUrl: _proxyUrl || undefined,
    });

    // ★ Store ALL cookies from this response — this is how referral tracking works!
    const setCookies = (res as any).headers?.getSetCookie?.() || [];
    if (setCookies.length > 0) {
      storeCookies(setCookies);
      console.log(`[TeraBox API] Stored ${setCookies.length} cookies from share link visit (total: ${_cookieJar.size})`);
    }

    // Fire analytics event for the share page view
    await trackAnalytics('share_page_view', referralLink);

    return {
      success: res.ok,
      cookies: getCookieString() || undefined,
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
