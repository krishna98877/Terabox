/**
 * TeraBox Passport API Client — Direct API-based signup.
 *
 * This bypasses the browser DOM entirely and calls TeraBox's passport API directly.
 * Much faster and more reliable than browser automation.
 *
 * API Flow:
 * 1. POST /passport/getpubkey → Get RSA public key for email encryption
 * 2. POST /passport/register_v4/sendcode → Send OTP to email (may require captcha)
 * 3. If captcha needed (errno 400090/460030): solve reCAPTCHA → retry with g_identity
 * 4. POST /passport/register_v4/verify → Verify OTP code
 * 5. POST /passport/register_v4/finish → Set password, complete registration
 *
 * The email is RSA-encrypted using the pubkey from step 1.
 */

// TeraBox has multiple domains — try them in order if one fails
const BASE_URLS = [
  'https://www.1024terabox.com',
  'https://www.terabox.com',
  'https://www.dubox.com',
];
let activeBaseUrl = BASE_URLS[0];
const APP_ID = '250528';
const PASS_VERSION_RECAPTCHA = '2.8';

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

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Referer': `${baseUrl}/`,
      'Origin': baseUrl,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      ...extraHeaders,
    };

    const body = new URLSearchParams(
      Object.entries(bodyParams).map(([k, v]) => [k, String(v)])
    ).toString();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
        cache: 'no-store',
      });

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

  if (data.errno === 0 || data.code === 0) {
    return {
      pp1: data.data?.pp1 || data.pp1 || '',
      pp2: data.data?.pp2 || data.pp2 || '',
      pp4: data.data?.pp4 || data.pp4 || '',
      pubkey: data.data?.pubkey || data.pubkey || '',
    };
  }
  console.error('[TeraBox API] getpubkey failed:', data.errmsg || data);
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

  const { data } = await passportPost(
    '/passport/register_v4/sendcode',
    bodyParams,
    extraHeaders
  );

  const errno = data.errno ?? data.error_code ?? data.code;

  // Success
  if (errno === 0) {
    return {
      success: true,
      token: data.data?.token || data.token,
      canSkipCode: data.data?.can_skip_code || data.can_skip_code,
      retryPeriod: data.data?.retry_period || data.retry_period,
    };
  }

  // Need reCAPTCHA
  if (errno === 400090 || errno === 460030 || errno === 106) {
    return {
      success: false,
      needsCaptcha: true,
      errno,
      error: `Need reCAPTCHA verification (errno ${errno})`,
    };
  }

  // Other error
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

  if (errno === 0) {
    return { success: true };
  }

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

  if (errno === 0) {
    return { success: true };
  }

  return {
    success: false,
    errno,
    error: data.errmsg || data.msg || `Finish error ${errno}`,
  };
}

/**
 * Get the reCAPTCHA site key from TeraBox.
 */
export function getRecaptchaSiteKey(): string {
  return '6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH';
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
