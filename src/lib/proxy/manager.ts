/**
 * Proxy Rotation Manager — ProxyScrape.com ONLY.
 *
 * ═══════════════════════════════════════════════════════════════════
 * SINGLE SOURCE: ProxyScrape v3 API (api.proxyscrape.com)
 * ═══════════════════════════════════════════════════════════════════
 *
 * ProxyScrape provides the largest free proxy pool with multiple
 * protocol & anonymity tiers. We fetch from ALL tiers to maximize
 * our chances of finding proxies that TeraBox doesn't flag.
 *
 * FETCH STRATEGY (multi-tier from ProxyScrape):
 * 1. ELITE HTTP    — highest anonymity, Western countries preferred
 * 2. ELITE SOCKS5  — protocol diversity, different IP ranges
 * 3. ANONYMOUS HTTP — broader pool, still decent anonymity
 * 4. ALL HTTP       — last resort, largest pool but lower quality
 *
 * VALIDATION (tiered):
 *   Tier 1: httpbin connectivity check (fast, 3s)
 *   Tier 2: TeraBox API check (definitive — rejects captcha-flagged IPs)
 *          Proxies that trigger errno 400090/460030/106 = INSTANT REJECT
 *
 * ★★★ CRITICAL: Why proxied CaptchaSolv tasks? ★★★
 * Enterprise reCAPTCHA binds the token to the solver's IP.
 * Proxyless solve → CaptchaSolv's IP ≠ your proxy IP → TeraBox REJECTS.
 * Proxied solve → CaptchaSolv solves from YOUR proxy IP → token accepted!
 *
 * FEATURES:
 * - ProxyScrape-only: no other proxy sources, no IPRoyal, no Proxifly
 * - Multi-tier fetch: elite → socks5 → anonymous → all
 * - TeraBox-aware validation: auto-reject captcha-flagged IPs
 * - Round-robin rotation through validated pool
 * - Auto-refresh every 5 minutes
 * - Failure tracking: remove proxy after 3 consecutive fails
 * - Direct-connection fallback if no proxy available
 */

import { proxiedFetch } from '@/lib/http/proxied-fetch';

// ─── Types ───

export interface ProxyInfo {
  url: string;           // e.g. "http://1.2.3.4:8080"
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  country?: string;
  source?: string;       // which tier gave us this proxy
  anonymity?: string;    // transparent, anonymous, elite
  lastVerified: number;  // timestamp
  failCount: number;
  successCount: number;
}

// ─── State ───

let proxyPool: ProxyInfo[] = [];
let currentIndex = 0;
let isRefreshing = false;
let lastRefreshTime = 0;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const MAX_FAILS = 3; // Remove proxy after 3 consecutive failures

// ─── ProxyScrape v3 API ───
// Docs: https://proxyscrape.com/resources/free-proxy-list
// Base: https://api.proxyscrape.com/v3/free-proxy-list/get

const PROXYSCRAPE_BASE = 'https://api.proxyscrape.com/v3/free-proxy-list/get';

interface ProxyScrapeTier {
  name: string;          // tier label for logging
  protocol: string;      // http, socks4, socks5
  anonymity: string;     // elite, anonymous, transparent, all
  country?: string;      // comma-separated country codes
  maxProxies: number;    // max proxies to take from this tier
  priority: number;      // lower = higher priority in rotation
}

/**
 * ProxyScrape fetch tiers — ordered from best to worst.
 * We fetch from ALL tiers to maximize the pool.
 */
const PROXYSCRAPE_TIERS: ProxyScrapeTier[] = [
  // ★ Tier 1: Elite HTTP — highest anonymity, Western countries
  {
    name: 'elite-http-west',
    protocol: 'http',
    anonymity: 'elite',
    country: 'us,gb,de,ca,fr,nl',
    maxProxies: 25,
    priority: 1,
  },
  // ★ Tier 2: Elite SOCKS5 — protocol diversity, different IP ranges
  {
    name: 'elite-socks5',
    protocol: 'socks5',
    anonymity: 'elite',
    maxProxies: 15,
    priority: 2,
  },
  // ★ Tier 3: Anonymous HTTP — broader pool, still decent
  {
    name: 'anonymous-http',
    protocol: 'http',
    anonymity: 'anonymous',
    maxProxies: 20,
    priority: 3,
  },
  // ★ Tier 4: All HTTP — last resort, largest pool
  {
    name: 'all-http',
    protocol: 'http',
    anonymity: 'all',
    maxProxies: 15,
    priority: 4,
  },
];

/**
 * Fetch proxies from a single ProxyScrape tier.
 * Uses `proxy_format=protocolipport` which returns lines like:
 *   "http://1.2.3.4:8080" or "socks5://1.2.3.4:1080"
 */
async function fetchFromProxyScrapeTier(tier: ProxyScrapeTier): Promise<ProxyInfo[]> {
  const qs = new URLSearchParams({
    request: 'displayproxies',
    protocol: tier.protocol,
    timeout: '10000',
    proxy_format: 'protocolipport',
    anonymity: tier.anonymity,
  });
  if (tier.country) {
    qs.set('country', tier.country);
  }

  const url = `${PROXYSCRAPE_BASE}?${qs}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn(`[Proxy] ProxyScrape tier "${tier.name}" returned ${res.status}`);
      return [];
    }

    const text = await res.text();
    const lines = text.trim().split('\n').filter(l => l.includes('://'));

    const proxies: ProxyInfo[] = [];
    for (const line of lines.slice(0, tier.maxProxies)) {
      try {
        const proxyUrl = line.trim();
        const parsed = new URL(proxyUrl);
        const protocol = parsed.protocol.replace(':', '') as ProxyInfo['protocol'];

        proxies.push({
          url: proxyUrl,
          host: parsed.hostname,
          port: parseInt(parsed.port, 10),
          protocol: ['http', 'https', 'socks4', 'socks5'].includes(protocol) ? protocol : 'http',
          country: tier.country?.split(',')[0], // first country in filter
          source: tier.name,
          anonymity: tier.anonymity === 'all' ? undefined : tier.anonymity,
          lastVerified: 0, // will be set during validation
          failCount: 0,
          successCount: 0,
        });
      } catch {
        // Skip malformed lines
      }
    }

    console.log(`[Proxy] ProxyScrape "${tier.name}": ${proxies.length} proxies fetched`);
    return proxies;
  } catch (err) {
    console.warn(`[Proxy] ProxyScrape tier "${tier.name}" failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Fetch proxies from ALL ProxyScrape tiers concurrently.
 * Returns deduplicated results sorted by tier priority.
 */
async function fetchAllProxyScrapeTiers(): Promise<ProxyInfo[]> {
  console.log(`[Proxy] Fetching from ${PROXYSCRAPE_TIERS.length} ProxyScrape tiers...`);

  const results = await Promise.allSettled(
    PROXYSCRAPE_TIERS.map(tier => fetchFromProxyScrapeTier(tier))
  );

  const allProxies: ProxyInfo[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allProxies.push(...result.value);
    }
  }

  // Deduplicate by host:port
  const seen = new Set<string>();
  const deduped = allProxies.filter(p => {
    const key = `${p.host}:${p.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by tier priority (lower priority number = first in rotation)
  deduped.sort((a, b) => {
    const tierA = PROXYSCRAPE_TIERS.find(t => t.name === a.source);
    const tierB = PROXYSCRAPE_TIERS.find(t => t.name === b.source);
    return (tierA?.priority ?? 99) - (tierB?.priority ?? 99);
  });

  console.log(`[Proxy] ProxyScrape total: ${deduped.length} unique proxies (from ${allProxies.length} raw)`);
  return deduped;
}

// ─── Validate a single proxy ───
// ★★★ TIERED VALIDATION: httpbin first (fast), then TeraBox (definitive) ★★★

async function validateProxy(proxy: ProxyInfo, timeoutMs = 8000): Promise<boolean> {
  // ★ Tier 1: Quick connectivity check via httpbin (fast, 3s timeout)
  try {
    const res = await proxiedFetch('https://httpbin.org/ip', {
      signal: AbortSignal.timeout(Math.min(timeoutMs, 3000)),
      cache: 'no-store',
      proxyUrl: proxy.url,
    });

    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.origin) return false;
  } catch {
    return false; // Dead proxy — don't bother with TeraBox check
  }

  // ★ Tier 2: TeraBox-specific validation (definitive)
  // Check if TeraBox accepts requests from this proxy IP.
  // If TeraBox returns captcha errno (400090/460030/106), proxy is flagged → FAIL.
  // If TeraBox returns normal response (even error), proxy is NOT flagged → PASS.
  try {
    const teraboxRes = await proxiedFetch(
      'https://www.1024terabox.com/api/shorturlinfo?shorturl=1_test&root=1&app_id=250528&web=1',
      {
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
        proxyUrl: proxy.url,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'application/json, text/plain, */*',
          'sec-ch-ua':
            '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
      }
    );

    if (teraboxRes.ok) {
      const tbData = await teraboxRes.json();
      const errno = tbData.errno ?? tbData.error_code ?? tbData.code;

      // If TeraBox returned captcha-required on a simple API call,
      // this proxy IP is HIGH RISK — avoid it!
      if (errno === 400090 || errno === 460030 || errno === 106) {
        console.warn(
          `[Proxy] ${proxy.host}:${proxy.port} flagged by TeraBox (errno ${errno}) — skipping`
        );
        return false;
      }

      // Any other response = proxy is NOT flagged by TeraBox → good!
      proxy.anonymity = proxy.anonymity || 'terabox-verified';
    }
    // Even if TeraBox returned non-200 (rate limit, etc.), the proxy itself works
    // and isn't captcha-flagged. We'll count it as validated.
  } catch (tbErr) {
    // TeraBox check failed (timeout, network error) — still keep proxy
    // since it passed httpbin. It might work for other requests.
    console.warn(
      `[Proxy] TeraBox validation skipped for ${proxy.host}:${proxy.port}: ${(tbErr as Error).message?.substring(0, 50)}`
    );
  }

  proxy.lastVerified = Date.now();
  return true;
}

/**
 * Create the appropriate proxy agent based on protocol.
 * Used for Puppeteer browser connections (not for fetch).
 * For fetch-based requests, use proxiedFetch() instead.
 */
export function createAgent(proxy: ProxyInfo): any | null {
  try {
    // Lazy imports — only needed for Puppeteer, not for API calls
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const { SocksProxyAgent } = require('socks-proxy-agent');
    if (proxy.protocol === 'socks4' || proxy.protocol === 'socks5') {
      return new SocksProxyAgent(proxy.url);
    }
    return new HttpsProxyAgent(proxy.url);
  } catch {
    return null;
  }
}

// ─── Validate proxies in batch ───

async function validateBatch(proxies: ProxyInfo[], concurrency = 10): Promise<ProxyInfo[]> {
  const valid: ProxyInfo[] = [];

  for (let i = 0; i < proxies.length; i += concurrency) {
    const batch = proxies.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async proxy => {
        const ok = await validateProxy(proxy);
        return ok ? proxy : null;
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        valid.push(result.value);
      }
    }
  }

  return valid;
}

// ─── Public API ───

/**
 * Initialize and refresh the proxy pool.
 * ProxyScrape-only: fetches from all tiers, validates, and builds pool.
 */
export async function refreshProxyPool(): Promise<{
  fetched: number;
  validated: number;
  total: number;
}> {
  if (isRefreshing) {
    return { fetched: 0, validated: 0, total: proxyPool.length };
  }

  isRefreshing = true;
  console.log('[Proxy] Refreshing proxy pool (ProxyScrape only)...');

  try {
    // Fetch from all ProxyScrape tiers concurrently
    const allRaw = await fetchAllProxyScrapeTiers();
    console.log(`[Proxy] Fetched ${allRaw.length} raw proxies from ProxyScrape`);

    // Validate proxies (batch, up to 40 at a time)
    const toValidate = allRaw.slice(0, 40);
    const validProxies = await validateBatch(toValidate, 15);
    console.log(`[Proxy] Validated ${validProxies.length}/${toValidate.length} working proxies`);

    // Merge with existing pool (keep working proxies, add new ones)
    const existingUrls = new Set(proxyPool.map(p => p.url));
    const newProxies = validProxies.filter(p => !existingUrls.has(p.url));

    proxyPool = [
      ...proxyPool.filter(p => p.failCount < MAX_FAILS), // keep working existing
      ...newProxies,
    ];
    currentIndex = 0;
    lastRefreshTime = Date.now();

    // Log pool composition by tier
    const tierCounts: Record<string, number> = {};
    for (const p of proxyPool) {
      const src = p.source || 'unknown';
      tierCounts[src] = (tierCounts[src] || 0) + 1;
    }
    console.log(
      `[Proxy] Pool size: ${proxyPool.length} — tiers: ${Object.entries(tierCounts)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ')}`
    );

    return {
      fetched: allRaw.length,
      validated: validProxies.length,
      total: proxyPool.length,
    };
  } catch (error) {
    console.error('[Proxy] Refresh failed:', (error as Error).message);
    return { fetched: 0, validated: 0, total: proxyPool.length };
  } finally {
    isRefreshing = false;
  }
}

/**
 * Get the next proxy in rotation.
 * ★ Prefers elite proxies → socks5 → anonymous → all
 * Auto-refreshes if pool is empty or stale.
 */
export async function getNextProxy(): Promise<ProxyInfo | null> {
  // Auto-refresh if pool is empty or stale
  if (proxyPool.length === 0 || Date.now() - lastRefreshTime > REFRESH_INTERVAL) {
    await refreshProxyPool();
  }

  if (proxyPool.length === 0) {
    console.warn('[Proxy] No proxies available — using direct connection');
    return null;
  }

  // ★ Priority 1: Elite proxies (highest anonymity — least likely flagged)
  const eliteProxies = proxyPool.filter(
    p => p.anonymity === 'elite' && p.failCount < MAX_FAILS
  );
  if (eliteProxies.length > 0) {
    const proxy = eliteProxies[currentIndex % eliteProxies.length];
    currentIndex++;
    return proxy;
  }

  // ★ Priority 2: SOCKS5 proxies (protocol diversity)
  const socksProxies = proxyPool.filter(
    p => p.protocol === 'socks5' && p.failCount < MAX_FAILS
  );
  if (socksProxies.length > 0) {
    const proxy = socksProxies[currentIndex % socksProxies.length];
    currentIndex++;
    return proxy;
  }

  // ★ Priority 3: Anonymous proxies
  const anonProxies = proxyPool.filter(
    p => p.anonymity === 'anonymous' && p.failCount < MAX_FAILS
  );
  if (anonProxies.length > 0) {
    const proxy = anonProxies[currentIndex % anonProxies.length];
    currentIndex++;
    return proxy;
  }

  // ★ Priority 4: Any working proxy
  const workingProxies = proxyPool.filter(p => p.failCount < MAX_FAILS);
  if (workingProxies.length > 0) {
    const proxy = workingProxies[currentIndex % workingProxies.length];
    currentIndex++;
    return proxy;
  }

  console.warn('[Proxy] No working proxies — using direct connection');
  return null;
}

/**
 * Mark a proxy as successfully used.
 */
export function markProxySuccess(proxyUrl: string): void {
  const proxy = proxyPool.find(p => p.url === proxyUrl);
  if (proxy) {
    proxy.successCount++;
    proxy.failCount = 0; // Reset fail count on success
  }
}

/**
 * Mark a proxy as failed. Remove after MAX_FAILS consecutive failures.
 */
export function markProxyFailed(proxyUrl: string): void {
  const proxy = proxyPool.find(p => p.url === proxyUrl);
  if (proxy) {
    proxy.failCount++;
    if (proxy.failCount >= MAX_FAILS) {
      proxyPool = proxyPool.filter(p => p.url !== proxyUrl);
      console.log(`[Proxy] Removed failing proxy: ${proxyUrl} (pool: ${proxyPool.length})`);
    }
  }
}

/**
 * Get current proxy pool status.
 */
export function getProxyStatus(): {
  poolSize: number;
  currentIndex: number;
  lastRefresh: string;
  isRefreshing: boolean;
  eliteCount: number;
  socks5Count: number;
  anonCount: number;
  proxies: Array<{
    url: string;
    source?: string;
    country?: string;
    anonymity?: string;
    successCount: number;
    failCount: number;
  }>;
} {
  const eliteCount = proxyPool.filter(p => p.anonymity === 'elite').length;
  const socks5Count = proxyPool.filter(p => p.protocol === 'socks5').length;
  const anonCount = proxyPool.filter(p => p.anonymity === 'anonymous').length;

  return {
    poolSize: proxyPool.length,
    currentIndex,
    lastRefresh: lastRefreshTime ? new Date(lastRefreshTime).toISOString() : 'never',
    isRefreshing,
    eliteCount,
    socks5Count,
    anonCount,
    proxies: proxyPool.slice(0, 20).map(p => ({
      url: p.url,
      source: p.source,
      country: p.country,
      anonymity: p.anonymity,
      successCount: p.successCount,
      failCount: p.failCount,
    })),
  };
}

/**
 * Set custom proxy list (for user-configured proxies).
 */
export function setCustomProxies(proxies: string[]): void {
  const parsed = proxies
    .map(l => {
      try {
        const url = new URL(l.trim());
        return {
          url: l.trim(),
          host: url.hostname,
          port: parseInt(url.port, 10),
          protocol: url.protocol.replace(':', '') as ProxyInfo['protocol'],
          source: 'custom',
          lastVerified: 0,
          failCount: 0,
          successCount: 0,
        } as ProxyInfo;
      } catch {
        return null;
      }
    })
    .filter((p): p is ProxyInfo => p !== null);
  proxyPool = [...parsed, ...proxyPool];
  console.log(`[Proxy] Added ${parsed.length} custom proxies (pool: ${proxyPool.length})`);
}

/**
 * Clear the proxy pool.
 */
export function clearProxyPool(): void {
  proxyPool = [];
  currentIndex = 0;
}
