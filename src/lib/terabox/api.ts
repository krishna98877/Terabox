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
 * ★★★ CRITICAL FIX: Per-session state ★★★
 * Previous version used module-level singletons (_cookieJar, _proxyUrl, activeBaseUrl)
 * which were SHARED across all 5 parallel workers → race conditions → session corruption.
 *
 * Now: Each parallel worker creates its own TeraBoxSession instance with isolated
 * cookie jar, proxy URL, and active base URL. No cross-worker contamination!
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
const APP_ID = '250528';
const PASS_VERSION_RECAPTCHA = '3.0'; // Updated: TeraBox now uses v3.0+ for reCAPTCHA Enterprise

// ─── Modern Chrome Headers ───
// TeraBox risk detection checks for modern browser headers.
// Missing sec-ch-ua, sec-fetch-* etc. flags the request as bot-like.

const CHROME_VERSION = '131';
const CHROME_FULL_VERSION = '131.0.0.0';

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

// ─── Captcha Error Detection ───
// TeraBox uses various errno values to indicate reCAPTCHA requirement.
// errno 400090 = standard reCAPTCHA v2
// errno 460030 = Enterprise reCAPTCHA (TeraBox's primary)
// errno 106    = "verify captcha" (general)
// errno 10     = rate limit / trigger captcha after too many requests
// errno 18     = "captcha required" (alternate)
export function isCaptchaErrno(errno: number | undefined | null): boolean {
  if (errno == null) return false;
  return errno === 400090 || errno === 460030 || errno === 106 || errno === 10 || errno === 18;
}

// ═══════════════════════════════════════════════════════════════════════
// ★★★ TeraBoxSession — Per-worker isolated state ★★★
// Each parallel worker creates its own session instance.
// No shared module-level singletons → no race conditions!
// ═══════════════════════════════════════════════════════════════════════

export class TeraBoxSession {
  // Per-session state (NOT shared across workers)
  private cookieJar: Map<string, string> = new Map();
  private proxyUrl: string | null = null;
  private activeBaseUrl: string = BASE_URLS[0];
  private sessionId: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId || `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ─── Cookie Management ───

  private storeCookies(setCookieHeaders: string[]): void {
    for (const header of setCookieHeaders) {
      const parts = header.split(';')[0];
      const [name, ...valueParts] = parts.split('=');
      if (name && valueParts.length > 0) {
        this.cookieJar.set(name.trim(), valueParts.join('=').trim());
      }
    }
  }

  private getCookieString(): string {
    return Array.from(this.cookieJar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  clearCookies(): void {
    this.cookieJar = new Map();
  }

  getCookieCount(): number {
    return this.cookieJar.size;
  }

  // ─── Proxy ───

  setProxyUrl(url: string | null): void {
    this.proxyUrl = url;
    if (url) {
      console.log(`[TeraBox ${this.sessionId}] Proxy set: ${url}`);
    }
  }

  getProxyUrl(): string | null {
    return this.proxyUrl;
  }

  // ─── API Request ───

  private async passportPost(
    endpoint: string,
    bodyParams: Record<string, unknown>,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ data: any; status: number }> {
    const qs = getCommonParams();
    const paramStr = new URLSearchParams(
      Object.entries(qs).map(([k, v]) => [k, String(v)])
    ).toString();
    let lastError: Error | null = null;

    for (const baseUrl of BASE_URLS) {
      const url = `${baseUrl}${endpoint}?${paramStr}`;

      const headers = getChromeHeaders(baseUrl, extraHeaders);
      const cookieStr = this.getCookieString();
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
          signal: AbortSignal.timeout(25000),
          cache: 'no-store',
          proxyUrl: this.proxyUrl || undefined,
        });

        const setCookies = (res as any).headers?.getSetCookie?.() || [];
        if (setCookies.length > 0) {
          this.storeCookies(setCookies);
        }

        const data = await res.json();
        this.activeBaseUrl = baseUrl;
        return { data, status: res.status };
      } catch (error) {
        lastError = error as Error;
        console.warn(`[TeraBox ${this.sessionId}] ${baseUrl} failed: ${(error as Error).message} — trying next domain`);
        continue;
      }
    }

    return { data: { errno: -1, errmsg: lastError?.message || 'All TeraBox domains failed' }, status: 0 };
  }

  // ─── Public API Methods ───

  /**
   * Step 1: Get RSA public key for encryption.
   */
  async getPubKey(): Promise<{ pp1: string; pp2: string; pp4: string; pubkey: string } | null> {
    const { data } = await this.passportPost('/passport/getpubkey', {});

    if (data.errno === 0 || data.code === 0) {
      const result = {
        pp1: data.data?.pp1 || data.pp1 || '',
        pp2: data.data?.pp2 || data.pp2 || '',
        pp4: data.data?.pp4 || data.pp4 || '',
        pubkey: data.data?.pubkey || data.pubkey || data.data?.pp1 || data.pp1 || '',
      };
      console.log(`[TeraBox ${this.sessionId}] getpubkey OK — pp1 length: ${result.pp1.length}, pp2: ${result.pp2}`);
      return result;
    }
    console.error(`[TeraBox ${this.sessionId}] getpubkey failed:`, data.errmsg || data.msg || data);
    return null;
  }

  /**
   * Step 2: Send verification code to email.
   * May return errno 400090 or 460030 requiring reCAPTCHA.
   */
  async sendVerificationCode(
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

    console.log(`[TeraBox ${this.sessionId}] sendcode: email=${email.substring(0, 5)}***, g_identity=${gIdentity ? `${gIdentity.substring(0, 15)}... (${gIdentity.length} chars)` : 'none'}, encrypted=${encrypted}`);

    const { data } = await this.passportPost(
      '/passport/register_v4/sendcode',
      bodyParams,
      extraHeaders
    );

    const errno = data.errno ?? data.error_code ?? data.code;
    console.log(`[TeraBox ${this.sessionId}] sendcode response: errno=${errno}, data=${JSON.stringify(data).substring(0, 200)}`);

    if (errno === 0) {
      console.log(`[TeraBox ${this.sessionId}] sendcode SUCCESS — OTP sent to email`);
      return {
        success: true,
        token: data.data?.token || data.token,
        canSkipCode: data.data?.can_skip_code || data.can_skip_code,
        retryPeriod: data.data?.retry_period || data.retry_period,
      };
    }

    if (isCaptchaErrno(errno)) {
      console.warn(`[TeraBox ${this.sessionId}] sendcode needs captcha (errno ${errno}) — captcha token was ${gIdentity ? 'provided but rejected' : 'not provided'}`);
      return {
        success: false,
        needsCaptcha: true,
        errno,
        error: `Need reCAPTCHA verification (errno ${errno})`,
      };
    }

    console.error(`[TeraBox ${this.sessionId}] sendcode error: errno=${errno}, msg=${data.errmsg || data.msg}`);
    return {
      success: false,
      errno,
      error: data.errmsg || data.msg || `Error ${errno}`,
    };
  }

  /**
   * Step 3: Verify the OTP code.
   */
  async verifyCode(
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

    const { data } = await this.passportPost(
      '/passport/register_v4/verify',
      bodyParams
    );

    const errno = data.errno ?? data.error_code ?? data.code;
    console.log(`[TeraBox ${this.sessionId}] verify response: errno=${errno}, g_identity=${gIdentity ? 'provided' : 'none'}`);

    if (errno === 0) {
      console.log(`[TeraBox ${this.sessionId}] verify SUCCESS — OTP verified`);
      return { success: true };
    }

    console.warn(`[TeraBox ${this.sessionId}] verify failed: errno=${errno}, msg=${data.errmsg || data.msg || ''}`);
    return {
      success: false,
      errno,
      error: data.errmsg || data.msg || `Verify error ${errno}`,
    };
  }

  /**
   * Step 4: Finish registration with password.
   */
  async finishRegistration(
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

    const { data } = await this.passportPost(
      '/passport/register_v4/finish',
      bodyParams
    );

    const errno = data.errno ?? data.error_code ?? data.code;
    console.log(`[TeraBox ${this.sessionId}] finish response: errno=${errno}, g_identity=${gIdentity ? 'provided' : 'none'}`);

    if (errno === 0) {
      console.log(`[TeraBox ${this.sessionId}] finish SUCCESS — registration complete`);
      return { success: true };
    }

    console.warn(`[TeraBox ${this.sessionId}] finish failed: errno=${errno}, msg=${data.errmsg || data.msg || ''}`);
    return {
      success: false,
      errno,
      error: data.errmsg || data.msg || `Finish error ${errno}`,
    };
  }

  /**
   * Login to TeraBox with email + password → get bdstoken (auth token).
   * Needed for authenticated calls like /share/transfer.
   *
   * ★★★ FIX: Now accepts gIdentity for captcha-based login!
   * API: POST /passport/login
   */
  async loginToTerabox(
    email: string,
    password: string,
    pubkey?: string,
    gIdentity?: string
  ): Promise<{
    success: boolean;
    bdstoken?: string;
    uk?: string;
    cookies?: string;
    error?: string;
    errno?: number;
  }> {
    // ★ BUG FIX: Handle RSA encryption failure gracefully.
    // Previously, if encryptEmail/encodePassword threw, the entire login would fail
    // with an uncaught exception. Now we fall back to plaintext (some TeraBox
    // endpoints accept unencrypted credentials).
    let encryptedEmail: string;
    let encryptedPwd: string;
    let isEncrypted = false;
    try {
      encryptedEmail = pubkey ? encryptEmail(email, pubkey) : email;
      encryptedPwd = pubkey ? encodePassword(password, pubkey) : password;
      isEncrypted = !!pubkey && encryptedEmail !== email;
    } catch (encErr) {
      console.warn(`[TeraBox ${this.sessionId}] Login encryption failed: ${(encErr as Error).message} — trying plaintext`);
      encryptedEmail = email;
      encryptedPwd = password;
      isEncrypted = false;
    }

    const bodyParams: Record<string, unknown> = {
      username: encryptedEmail,
      pwd: encryptedPwd,
      pass_version: PASS_VERSION_RECAPTCHA,
      verifychannel: '',
      countrycode: '',
      clientfrom: 'web',
    };

    // ★★★ FIX: Pass g_identity if captcha was solved for login
    if (gIdentity) {
      bodyParams.g_identity = gIdentity;
    }

    const extraHeaders: Record<string, string> = {};
    if (isEncrypted) {
      extraHeaders['fs-ex-st'] = '1';
    }

    const { data } = await this.passportPost('/passport/login', bodyParams, extraHeaders);

    const errno = data.errno ?? data.error_code ?? data.code;
    console.log(`[TeraBox ${this.sessionId}] login response: errno=${errno}, g_identity=${gIdentity ? 'provided' : 'none'}`);

    if (errno === 0) {
      console.log(`[TeraBox ${this.sessionId}] login SUCCESS — got bdstoken`);
      return {
        success: true,
        bdstoken: data.data?.bdstoken || data.bdstoken || '',
        uk: data.data?.uk || data.uk || '',
      };
    }

    if (errno === 400090 || errno === 460030 || errno === 106) {
      console.warn(`[TeraBox ${this.sessionId}] login needs captcha (errno ${errno}) — caller should solve and retry with gIdentity`);
      return {
        success: false,
        errno,
        error: `Login requires captcha (errno ${errno})`,
      };
    }

    console.warn(`[TeraBox ${this.sessionId}] login failed: errno=${errno}, msg=${data.errmsg || data.msg || ''}`);
    return {
      success: false,
      errno,
      error: data.errmsg || data.msg || `Login error ${errno}`,
    };
  }

  /**
   * Get share link info — returns shareid, uk, sign, file list, etc.
   */
  async getShareInfo(shorturl: string): Promise<{
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
        const cookieStr = this.getCookieString();
        if (cookieStr) headers['Cookie'] = cookieStr;

        const res = await proxiedFetch(`${baseUrl}/api/shorturlinfo?${qs}`, {
          headers,
          redirect: 'follow',
          signal: AbortSignal.timeout(25000),
          cache: 'no-store',
          proxyUrl: this.proxyUrl || undefined,
        });

        const setCookies = (res as any).headers?.getSetCookie?.() || [];
        if (setCookies.length > 0) this.storeCookies(setCookies);

        const data = await res.json();
        const errno = data.errno ?? data.error_code ?? data.code;

        if (errno === 0) {
          this.activeBaseUrl = baseUrl;
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

        console.warn(`[TeraBox ${this.sessionId}] shorturlinfo errno ${errno}: ${data.errmsg || ''}`);
        return { success: false, errno, error: data.errmsg || `Error ${errno}` };
      } catch (err) {
        console.warn(`[TeraBox ${this.sessionId}] ${baseUrl} shorturlinfo failed: ${(err as Error).message}`);
      }
    }

    return { success: false, error: 'All TeraBox domains failed for shorturlinfo' };
  }

  /**
   * ★★★ THE KEY API — Transfer (save) a shared file to your own account ★★★
   */
  async shareTransfer(params: {
    shareid: string;
    from: string;
    bdstoken: string;
    sekey?: string;
    path?: string;
    fs_id?: string;
    dir?: string;
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

    const { data } = await this.passportPost('/share/transfer', bodyParams);

    const errno = data.errno ?? data.error_code ?? data.code;

    if (errno === 0) {
      console.log(`[TeraBox ${this.sessionId}] share/transfer SUCCESS! File saved to account.`);
      return {
        success: true,
        taskid: data.taskid || data.data?.taskid || '',
      };
    }

    console.warn(`[TeraBox ${this.sessionId}] share/transfer errno ${errno}: ${data.errmsg || ''}`);
    return {
      success: false,
      errno,
      error: data.errmsg || data.msg || `Transfer error ${errno}`,
    };
  }

  /**
   * Track analytics event.
   */
  async trackAnalytics(
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

      await this.passportPost('/api/analytics', bodyParams);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Report user activity.
   */
  async reportUserActivity(
    bdstoken: string,
    action: string = 'webv4_main'
  ): Promise<boolean> {
    try {
      await this.passportPost('/api/report/user', {
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
   * Visit a share link — sets referral cookies and fires analytics.
   * ★★★ IMPORTANT: Stores cookies in THIS session's jar, so subsequent
   *   passport API calls will carry the referral cookies!
   */
  async visitShareLink(
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

      const cookieStr = this.getCookieString();
      if (cookieStr) headers['Cookie'] = cookieStr;

      const res = await proxiedFetch(referralLink, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
        cache: 'no-store',
        proxyUrl: this.proxyUrl || undefined,
      });

      const setCookies = (res as any).headers?.getSetCookie?.() || [];
      if (setCookies.length > 0) {
        this.storeCookies(setCookies);
        console.log(`[TeraBox ${this.sessionId}] Stored ${setCookies.length} cookies from share link visit (total: ${this.cookieJar.size})`);
      }

      await this.trackAnalytics('share_page_view', referralLink);

      return {
        success: res.ok,
        cookies: this.getCookieString() || undefined,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }
}

// ─── Static Utility Functions (no session needed) ───

/**
 * Get the reCAPTCHA site key.
 */
export function getRecaptchaSiteKey(): string {
  return process.env.RECAPTCHA_SITE_KEY || '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';
}

/**
 * ★★★ Dynamic reCAPTCHA sitekey extraction from TeraBox page HTML.
 * TeraBox rotates their sitekey — the hardcoded fallback may be stale.
 * This fetches the actual signup/passport page and extracts the sitekey
 * from the reCAPTCHA script tag or render() call in the HTML source.
 *
 * Extraction patterns (in order of priority):
 * 1. ?k=SITEKEY in script src (e.g. .../recaptcha/enterprise.js?render=SITEKEY)
 * 2. grecaptcha.render('...',{sitekey:'SITEKEY'}) in inline script
 * 3. data-sitekey="SITEKEY" on a div element
 */
let _cachedSiteKey: string | null = null;
let _cachedSiteKeyTime = 0;
const SITEKEY_CACHE_TTL = 30 * 60 * 1000; // 30 min cache — sitekey rarely changes within a session

export async function extractRecaptchaSiteKey(proxyUrl?: string): Promise<string | null> {
  // Return cached if fresh
  if (_cachedSiteKey && Date.now() - _cachedSiteKeyTime < SITEKEY_CACHE_TTL) {
    return _cachedSiteKey;
  }

  for (const baseUrl of BASE_URLS) {
    try {
      // Try the main page first — reCAPTCHA is rendered on signup modal
      const res = await proxiedFetch(`${baseUrl}/`, {
        headers: {
          'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_FULL_VERSION} Safari/537.36`,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
        proxyUrl: proxyUrl || undefined,
      });

      const html = await res.text();

      // Pattern 1: enterprise.js?render=SITEKEY or api.js?render=SITEKEY
      const renderMatch = html.match(/recaptcha\/(?:enterprise|api)\.js\?(?:render|onload)=([A-Za-z0-9_-]{39,41})/);
      if (renderMatch) {
        _cachedSiteKey = renderMatch[1];
        _cachedSiteKeyTime = Date.now();
        console.log(`[TeraBox] Extracted reCAPTCHA sitekey from script src: ${_cachedSiteKey.substring(0, 10)}...`);
        return _cachedSiteKey;
      }

      // Pattern 2: grecaptcha.render('...',{sitekey:'SITEKEY'})
      const renderCallMatch = html.match(/(?:sitekey|site_key)\s*:\s*['"]([A-Za-z0-9_-]{39,41})['"]/);
      if (renderCallMatch) {
        _cachedSiteKey = renderCallMatch[1];
        _cachedSiteKeyTime = Date.now();
        console.log(`[TeraBox] Extracted reCAPTCHA sitekey from render call: ${_cachedSiteKey.substring(0, 10)}...`);
        return _cachedSiteKey;
      }

      // Pattern 3: data-sitekey attribute
      const dataAttrMatch = html.match(/data-sitekey=['"]([A-Za-z0-9_-]{39,41})['"]/);
      if (dataAttrMatch) {
        _cachedSiteKey = dataAttrMatch[1];
        _cachedSiteKeyTime = Date.now();
        console.log(`[TeraBox] Extracted reCAPTCHA sitekey from data-sitekey: ${_cachedSiteKey.substring(0, 10)}...`);
        return _cachedSiteKey;
      }

      console.warn(`[TeraBox] Could not extract sitekey from ${baseUrl} HTML (length: ${html.length})`);
    } catch (err) {
      console.warn(`[TeraBox] Failed to fetch ${baseUrl} for sitekey extraction: ${(err as Error).message}`);
    }
  }

  return null;
}

/**
 * Get the reCAPTCHA sitekey — tries dynamic extraction first, falls back to hardcoded.
 */
export async function getRecaptchaSiteKeyDynamic(proxyUrl?: string): Promise<string> {
  const dynamic = await extractRecaptchaSiteKey(proxyUrl);
  if (dynamic) return dynamic;
  // Fallback to hardcoded / env var
  console.warn('[TeraBox] Dynamic sitekey extraction failed — using hardcoded fallback (may be stale!)');
  return getRecaptchaSiteKey();
}

/**
 * RSA encrypt data using TeraBox's public key.
 */
export function rsaEncrypt(data: string, pubkeyStr: string): string {
  try {
    const forge = require('node-forge');
    const pki = forge.pki;

    const publicKey = pki.publicKeyFromPem(
      '-----BEGIN PUBLIC KEY-----\n' +
      pubkeyStr +
      '\n-----END PUBLIC KEY-----'
    );

    const encrypted = publicKey.encrypt(data, 'RSAES-PKCS1-V1_5');
    return forge.util.encode64(encrypted);
  } catch (err) {
    console.error('[TeraBox API] RSA encryption FAILED:', (err as Error).message);
    throw new Error(`RSA encryption failed: ${(err as Error).message}`);
  }
}

/**
 * Simple password encoding for TeraBox.
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

/**
 * Extract surl from a TeraBox share link.
 */
export function extractSurlFromLink(link: string): string {
  const match = link.match(/\/s\/([^/?\s]+)/);
  return match ? match[1] : '';
}

// ═══════════════════════════════════════════════════════════════════════
// ★ Backward-compatible module-level API ★
// Uses a DEFAULT session for code that doesn't need parallel isolation.
// For parallel workers, use: const session = new TeraBoxSession(workerId);
// ═══════════════════════════════════════════════════════════════════════

const _defaultSession = new TeraBoxSession('default');

export function setProxyUrl(url: string | null): void {
  _defaultSession.setProxyUrl(url);
}

export function clearCookies(): void {
  _defaultSession.clearCookies();
}

export function getCookieCount(): number {
  return _defaultSession.getCookieCount();
}

export async function getPubKey() { return _defaultSession.getPubKey(); }
export async function sendVerificationCode(email: string, gIdentity?: string, encrypted?: boolean) {
  return _defaultSession.sendVerificationCode(email, gIdentity, encrypted);
}
export async function verifyCode(token: string, code: string, gIdentity?: string) {
  return _defaultSession.verifyCode(token, code, gIdentity);
}
export async function finishRegistration(token: string, encryptedPwd: string, gIdentity?: string) {
  return _defaultSession.finishRegistration(token, encryptedPwd, gIdentity);
}
export async function loginToTerabox(email: string, password: string, pubkey?: string, gIdentity?: string) {
  return _defaultSession.loginToTerabox(email, password, pubkey, gIdentity);
}
export async function getShareInfo(shorturl: string) { return _defaultSession.getShareInfo(shorturl); }
export async function shareTransfer(params: Parameters<TeraBoxSession['shareTransfer']>[0]) {
  return _defaultSession.shareTransfer(params);
}
export async function trackAnalytics(type: string, currentUrl: string, extra?: Record<string, unknown>) {
  return _defaultSession.trackAnalytics(type, currentUrl, extra);
}
export async function reportUserActivity(bdstoken: string, action?: string) {
  return _defaultSession.reportUserActivity(bdstoken, action);
}
export async function visitShareLink(referralLink: string) {
  return _defaultSession.visitShareLink(referralLink);
}
