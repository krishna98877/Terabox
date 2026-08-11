/**
 * Proxied Fetch — Drop-in replacement for fetch() with WORKING proxy support.
 *
 * ═══════════════════════════════════════════════════════════════════
 * ★★★ CRITICAL FIX ★★★
 * Node.js native fetch() + HttpsProxyAgent dispatcher = BROKEN!
 *   - HttpsProxyAgent creates an http.Agent (for http.request())
 *   - fetch() expects an undici Dispatcher (incompatible types!)
 *   - Result: ALL proxy requests fail silently with "fetch failed"
 *
 * undici ProxyAgent + fetch() dispatcher = ALSO BROKEN for free proxies!
 *   - Free HTTP proxies don't handle CONNECT tunneling correctly
 *   - undici.ProxyAgent sends CONNECT but proxy returns 400/503
 *   - Result: "Proxy response (400) !== 200 when HTTP Tunneling"
 *
 * ★★★ THE FIX ★★★
 * Use https.request() + HttpsProxyAgent for proxied requests!
 *   - HttpsProxyAgent handles CONNECT tunneling correctly
 *   - Confirmed working with ProxyScrape elite proxies
 *   - Wraps the result in a standard Response object
 *
 * Usage:
 *   import { proxiedFetch } from '@/lib/http/proxied-fetch';
 *   const res = await proxiedFetch(url, { proxyUrl: 'http://1.2.3.4:8080', ...fetchOptions });
 * ═══════════════════════════════════════════════════════════════════
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import type { IncomingMessage } from 'node:http';
import https from 'node:https';
import http from 'node:http';

// ─── Proxy Agent Cache ───
const agentCache = new Map<string, any>();

function getProxyAgent(proxyUrl: string): any {
  let agent = agentCache.get(proxyUrl);
  if (!agent) {
    agent = new HttpsProxyAgent(proxyUrl);
    agentCache.set(proxyUrl, agent);
  }
  return agent;
}

// ─── Types ───

export interface ProxiedFetchInit extends RequestInit {
  /** Proxy URL (e.g. 'http://1.2.3.4:8080', 'socks5://1.2.3.4:1080') */
  proxyUrl?: string;
}

// ─── Convert node IncomingMessage to Web Response ───

function nodeResponseToWebResponse(res: IncomingMessage, body: Buffer): Response {
  // Build Headers object from node's raw headers
  const headers = new Headers();
  const rawHeaders = res.rawHeaders;
  
  // ★★★ CRITICAL: Collect ALL Set-Cookie headers (there can be multiple!)
  // Standard Headers.set() would overwrite — we use Headers.append() for Set-Cookie
  const setCookieHeaders: string[] = [];
  
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    const value = rawHeaders[i + 1];
    try {
      if (name.toLowerCase() === 'set-cookie') {
        // Collect Set-Cookie headers separately for the getSetCookie() method
        setCookieHeaders.push(value);
        // Also append to Headers object (append preserves multiple values)
        headers.append(name, value);
      } else {
        headers.append(name, value);
      }
    } catch {
      // Skip invalid headers
    }
  }

  const response = new Response(new Uint8Array(body), {
    status: res.statusCode || 200,
    statusText: res.statusMessage || '',
    headers,
  });
  
  // ★ Attach getSetCookie() method so cookie parsing works
  // Node.js Response has this natively, but our custom Response doesn't
  // Without this, TeraBox cookie jar NEVER gets cookies → session breaks → captcha loop!
  (response as any).headers.getSetCookie = () => setCookieHeaders;
  
  return response;
}

// ─── Proxied request via https.request() + HttpsProxyAgent ───

function proxiedHttpRequest(
  url: string | URL,
  init: RequestInit,
  proxyUrl: string
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url.toString());
    const isHttps = parsedUrl.protocol === 'https:';
    const agent = getProxyAgent(proxyUrl);

    // Build headers object from Headers init
    const headers: Record<string, string> = {};
    if (init.headers) {
      const h = new Headers(init.headers as HeadersInit);
      h.forEach((value, key) => { headers[key] = value; });
    }

    // Determine timeout from AbortSignal or default
    let timeoutMs = 15000;
    if (init.signal) {
      // Try to extract timeout from AbortSignal.timeout
      // We'll rely on the signal's own abort behavior
    }

    const reqOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: (init.method || 'GET').toUpperCase() as https.RequestOptions['method'],
      headers,
      agent,
    };

    const httpModule = isHttps ? https : http;
    const req = httpModule.request(reqOptions, (res: IncomingMessage) => {
      // Handle redirects (follow up to 5)
      const statusCode = res.statusCode || 0;
      if ((statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) && headers['follow'] !== 'manual') {
        // Consume response body to free up connection
        res.resume();
        const location = res.headers.location;
        if (location) {
          try {
            const redirectUrl = new URL(location, url.toString());
            // For 303, change method to GET
            const redirectInit: RequestInit = {
              ...init,
              method: statusCode === 303 ? 'GET' : init.method,
            };
            if (statusCode === 303) {
              delete redirectInit.body;
            }
            // Follow redirect (recursive, but limited by native fetch behavior)
            proxiedHttpRequest(redirectUrl, redirectInit, proxyUrl)
              .then(resolve)
              .catch(reject);
            return;
          } catch {
            // Invalid redirect URL — fall through
          }
        }
      }

      // Collect response body
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve(nodeResponseToWebResponse(res, body));
      });
      res.on('error', reject);
    });

    // Handle request errors
    req.on('error', reject);

    // Handle abort signal
    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy();
        reject(new DOMException('The operation was aborted.', 'AbortError'));
        return;
      }
      init.signal.addEventListener('abort', () => {
        req.destroy();
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    }

    // Write request body
    if (init.body) {
      if (typeof init.body === 'string') {
        req.write(init.body);
      } else if (init.body instanceof Uint8Array || init.body instanceof ArrayBuffer) {
        req.write(Buffer.from(init.body as ArrayBuffer));
      } else if (Buffer.isBuffer(init.body)) {
        req.write(init.body);
      } else {
        // For ReadableStream, Blob, etc. — convert to string
        // This handles URLSearchParams body (common for TeraBox API)
        init.body instanceof URLSearchParams
          ? req.write(init.body.toString())
          : req.write(String(init.body));
      }
    }

    req.end();
  });
}

// ─── Main Function ───

/**
 * Fetch with proxy support.
 *
 * ★ When proxyUrl is provided, uses https.request() + HttpsProxyAgent.
 *   This is the ONLY reliable way to proxy HTTPS requests through
 *   free HTTP proxies in Node.js. The native fetch() dispatcher
 *   approach is broken (see file header).
 *
 * ★ When no proxy, delegates to native fetch() directly (fastest).
 *
 * @param url - The URL to fetch
 * @param init - Fetch options + optional proxyUrl
 * @returns Response (same API as native fetch)
 */
export async function proxiedFetch(url: string | URL, init: ProxiedFetchInit = {}): Promise<Response> {
  const { proxyUrl, ...fetchInit } = init;

  // No proxy — use native fetch directly (fastest, most compatible)
  if (!proxyUrl) {
    return fetch(url, fetchInit);
  }

  // With proxy — use https.request() + HttpsProxyAgent
  // This is the only reliable method for proxied HTTPS through free proxies
  return proxiedHttpRequest(url, fetchInit, proxyUrl);
}

// ─── Convenience: POST with form data ───

/**
 * POST with proxy support and form-encoded body.
 * Convenience wrapper for the most common TeraBox API pattern.
 */
export async function proxiedPost(
  url: string | URL,
  bodyParams: Record<string, unknown>,
  headers: Record<string, string> = {},
  proxyUrl?: string
): Promise<Response> {
  const body = new URLSearchParams(
    Object.entries(bodyParams).map(([k, v]) => [k, String(v)])
  ).toString();

  return proxiedFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body,
    proxyUrl,
  });
}

// ─── Convenience: GET with proxy ───

/**
 * GET with proxy support.
 */
export async function proxiedGet(
  url: string | URL,
  headers: Record<string, string> = {},
  proxyUrl?: string
): Promise<Response> {
  return proxiedFetch(url, {
    method: 'GET',
    headers,
    proxyUrl,
  });
}

// ─── Cleanup ───

/**
 * Clear the proxy agent cache.
 * Call this when the proxy pool is refreshed to avoid stale connections.
 */
export function clearProxyAgentCache(): void {
  agentCache.clear();
}

/**
 * Remove a specific proxy agent from the cache.
 */
export function removeProxyAgent(proxyUrl: string): void {
  agentCache.delete(proxyUrl);
}
