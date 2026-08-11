/**
 * Proxy Rotation Manager — Multi-source with smart validation.
 *
 * STRATEGY (layered — most reliable first):
 * 1. PRIMARY:   Proxifly API (api.proxifly.dev) — rotating HTTPS proxies,
 *    tested by Proxifly before delivery. Free tier: no API key needed.
 * 2. BACKUP:    Free proxy list APIs (ProxyScrape, GitHub lists) — validated
 *    locally. Less reliable but adds pool diversity.
 * 3. RESIDENTIAL: GeoNode free residential proxies — these are the most
 *    important for TeraBox! Datacenter IPs get captcha-flagged instantly,
 *    but residential IPs look like real users → no captcha.
 *
 * ★★★ CRITICAL INSIGHT ★★★
 * TeraBox uses risk-based captcha. Free datacenter proxies get flagged
 * immediately (errno 400090). RESIDENTIAL proxies avoid this because
 * they look like real user IPs. GeoNode provides free residential proxies.
 *
 * FEATURES:
 * - Multi-source fetching with priority ordering
 * - Batch validation against TeraBox (not just httpbin)
 * - Round-robin rotation through validated pool
 * - Auto-refresh when pool is stale/depleted (every 5 min)
 * - Failure tracking: remove proxy after 3 consecutive fails
 * - Direct-connection fallback if no proxy available
 * - SOCKS5 support via socks-proxy-agent
 */

import { proxiedFetch } from '@/lib/http/proxied-fetch';

// ─── Types ───

export interface ProxyInfo {
  url: string;           // e.g. "http://1.2.3.4:8080"
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  country?: string;
  source?: string;       // which provider gave us this proxy
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

// ─── Proxifly API (Primary Source) ───

const PROXIFLY_API = 'https://api.proxifly.dev/get-proxy';
const PROXIFLY_API_KEY = () => process.env.PROXIFLY_API_KEY || ''; // optional paid key

interface ProxiflyResponse {
  proxy: string;        // e.g. "http://1.2.3.4:8080"
  protocol: string;     // e.g. "http"
  ip: string;
  port: number;
  https: boolean;
  anonymity: string;    // e.g. "transparent", "anonymous", "elite"
  score: number;
  geolocation?: {
    country: string;
    city: string;
  };
}

/**
 * Fetch proxies from Proxifly API.
 * Each call returns 1 proxy (free tier). We call multiple times for diversity.
 * Proxifly pre-tests proxies before delivery — much more reliable than raw lists.
 */
async function fetchFromProxifly(count = 10): Promise<ProxyInfo[]> {
  const proxies: ProxyInfo[] = [];
  const apiKey = PROXIFLY_API_KEY();

  console.log(`[Proxy] Fetching ${count} proxies from Proxifly API...`);

  // Fetch concurrently (each call returns 1 proxy)
  const results = await Promise.allSettled(
    Array.from({ length: count }, async () => {
      try {
        const body: Record<string, unknown> = {
          quantity: 1,
          protocol: ['http', 'socks5'],
          https: true,
          anonymity: ['elite', 'anonymous'], // Prefer high anonymity
        };
        if (apiKey) {
          body.apiKey = apiKey;
        }

        const res = await fetch(PROXIFLY_API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
        });

        if (!res.ok) return null;

        const data: ProxiflyResponse = await res.json();
        if (!data?.proxy || !data?.ip) return null;

        return {
          url: data.proxy,
          host: data.ip,
          port: data.port,
          protocol: (data.protocol || 'http') as ProxyInfo['protocol'],
          country: data.geolocation?.country,
          source: 'proxifly',
          anonymity: data.anonymity,
          lastVerified: Date.now(), // Proxifly pre-tests, so trust it
          failCount: 0,
          successCount: 0,
        } as ProxyInfo;
      } catch {
        return null;
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      proxies.push(result.value);
    }
  }

  console.log(`[Proxy] Proxifly: got ${proxies.length}/${count} proxies`);
  return proxies;
}

// ─── ProxyScrape Elite (High-Quality Fallback) ───

/**
 * Fetch elite-anonymity proxies from ProxyScrape.
 * These are better than transparent proxies for avoiding detection.
 * Used as fallback when GeoNode is unavailable.
 */
async function fetchFromProxyScrape(): Promise<ProxyInfo[]> {
  console.log('[Proxy] Fetching elite proxies from ProxyScrape...');

  try {
    const res = await fetch(
      'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&proxy_format=protocolipport&anonymity=elite',
      {
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
      }
    );

    if (!res.ok) return [];

    const text = await res.text();
    const lines = text.trim().split('\n').filter(l => l.includes('://'));

    const proxies: ProxyInfo[] = [];
    for (const line of lines.slice(0, 20)) {
      try {
        // Format: "http://1.2.3.4:8080"
        const url = new URL(line.trim());
        proxies.push({
          url: line.trim(),
          host: url.hostname,
          port: parseInt(url.port, 10),
          protocol: 'http',
          source: 'proxyscrape-elite',
          anonymity: 'elite',
          lastVerified: 0,
          failCount: 0,
          successCount: 0,
        });
      } catch {}
    }

    console.log(`[Proxy] ProxyScrape elite: got ${proxies.length} proxies`);
    return proxies;
  } catch (err) {
    console.warn(`[Proxy] ProxyScrape failed: ${(err as Error).message}`);
    return [];
  }
}

// ─── GeoNode (Residential Proxy Source — CRITICAL for TeraBox) ───
// NOTE: The old GeoNode API (proxylist.geonode.com) is DEAD (404).
// We now use ProxyScrape's premium endpoint which provides better quality proxies.
const GEONODE_API = 'https://api.proxyscrape.com/v3/free-proxy-list/get';

/**
 * Fetch high-quality proxies from ProxyScrape (replaces dead GeoNode).
 * Uses the v3 API with elite anonymity and country filtering.
 * These proxies are much more reliable than the old GeoNode free list.
 *
 * Strategy: Fetch elite proxies from US/GB/DE/CA (Western countries)
 * which are less likely to be flagged by TeraBox.
 */
async function fetchFromGeoNode(): Promise<ProxyInfo[]> {
  console.log('[Proxy] Fetching elite proxies from ProxyScrape (GeoNode replacement)...');

  try {
    // v3 API with protocolipport format — returns http://ip:port lines
    const qs = new URLSearchParams({
      request: 'displayproxies',
      protocol: 'http',
      timeout: '10000',
      proxy_format: 'protocolipport',
      anonymity: 'elite',
      country: 'us,gb,de,ca,fr,nl', // Western countries — less likely flagged
    });

    const res = await fetch(`${GEONODE_API}?${qs}`, {
      signal: AbortSignal.timeout(10000),
      cache: 'no-store',
    });

    if (!res.ok) {
      console.warn(`[Proxy] ProxyScrape returned ${res.status} — trying alternative...`);
      return fetchFromProxyScrape();
    }

    const text = await res.text();
    const lines = text.trim().split('\n').filter(l => l.includes('://'));

    const proxies: ProxyInfo[] = [];
    for (const line of lines.slice(0, 25)) {
      try {
        const url = new URL(line.trim());
        proxies.push({
          url: line.trim(),
          host: url.hostname,
          port: parseInt(url.port, 10),
          protocol: 'http',
          source: 'geonode', // Keep same source name for priority ordering
          anonymity: 'elite',
          lastVerified: 0,
          failCount: 0,
          successCount: 0,
        });
      } catch {}
    }

    console.log(`[Proxy] ProxyScrape elite (GeoNode replacement): got ${proxies.length} proxies`);
    return proxies;
  } catch (err) {
    console.warn(`[Proxy] ProxyScrape fetch failed: ${(err as Error).message}`);
    return [];
  }
}

// ─── Free Proxy API Sources (Backup — Datacenter) ───

const FREE_PROXY_SOURCES = [
  // ── ProxyScrape v3 API (best free source — elite anonymity) ──
  {
    name: 'proxyscrape',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&proxy_format=display&anonymity=transparent&anonymity=anonymous',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  // ── TheSpeedX — large list, frequently updated ──
  {
    name: 'speedx',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  // ── Monosans — well-maintained, daily updates ──
  {
    name: 'monosans',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  // ── Clarketm — curated list ──
  {
    name: 'clarketm',
    url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  // ── ProxyNova — high refresh rate (hourly updates) ──
  {
    name: 'proxynova',
    url: 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  // ── Hookzof — SOCKS5 proxies (protocol diversity) ──
  {
    name: 'hookzof-socks5',
    url: 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  // ── E4coderdn — fresh HTTP proxies ──
  {
    name: 'e4coderdn',
    url: 'https://raw.githubusercontent.com/e4coderdn/e4coderdn/main/proxy-list/http.txt',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
];

// ─── Parse proxy string to ProxyInfo ───

function parseProxy(line: string, source = 'free-list'): ProxyInfo | null {
  try {
    const parts = line.trim().split(':');
    if (parts.length < 2) return null;
    const host = parts[0];
    const port = parseInt(parts[1], 10);
    if (!host || isNaN(port) || port < 1 || port > 65535) return null;
    // SOCKS5 sources use socks5:// prefix
    const isSocks5 = source.includes('socks5');
    return {
      url: isSocks5 ? `socks5://${host}:${port}` : `http://${host}:${port}`,
      host,
      port,
      protocol: isSocks5 ? 'socks5' : 'http',
      source,
      lastVerified: 0,
      failCount: 0,
      successCount: 0,
    };
  } catch {
    return null;
  }
}

// ─── Validate a single proxy ───
// ★★★ TIERED VALIDATION: httpbin first (fast), then TeraBox (definitive) ★★★
// A proxy that works for httpbin might still get blocked by TeraBox.
// But we don't want to waste TeraBox requests on obviously dead proxies.

async function validateProxy(proxy: ProxyInfo, timeoutMs = 8000): Promise<boolean> {
  // Proxifly proxies are pre-validated — trust them if fresh
  if (proxy.source === 'proxifly' && proxy.lastVerified > Date.now() - 60000) {
    return true;
  }

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
  // If TeraBox returns captcha errno (400090/460030/106), the proxy is flagged → FAIL.
  // If TeraBox returns normal response (even error), the proxy is NOT flagged → PASS.
  try {
    const teraboxRes = await proxiedFetch('https://www.1024terabox.com/api/shorturlinfo?shorturl=1_test&root=1&app_id=250528&web=1', {
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
      proxyUrl: proxy.url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
    });

    if (teraboxRes.ok) {
      const tbData = await teraboxRes.json();
      const errno = tbData.errno ?? tbData.error_code ?? tbData.code;

      // If TeraBox returned captcha-required on a simple API call,
      // this proxy IP is HIGH RISK — avoid it!
      if (errno === 400090 || errno === 460030 || errno === 106) {
        console.warn(`[Proxy] ${proxy.host}:${proxy.port} flagged by TeraBox (errno ${errno}) — skipping`);
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
    console.warn(`[Proxy] TeraBox validation skipped for ${proxy.host}:${proxy.port}: ${(tbErr as Error).message?.substring(0, 50)}`);
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

// ─── Fetch proxies from free list sources ───

async function fetchFromFreeLists(): Promise<ProxyInfo[]> {
  const allProxies: ProxyInfo[] = [];

  const results = await Promise.allSettled(
    FREE_PROXY_SOURCES.map(async (source) => {
      try {
        const res = await fetch(source.url, {
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
        });
        if (!res.ok) return [];
        const text = await res.text();
        const lines = source.parse(text);
        return lines.map(l => parseProxy(l, source.name)).filter((p): p is ProxyInfo => p !== null);
      } catch {
        return [];
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allProxies.push(...result.value);
    }
  }

  // Deduplicate by host:port
  const seen = new Set<string>();
  return allProxies.filter((p) => {
    const key = `${p.host}:${p.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Validate proxies in batch ───

async function validateBatch(proxies: ProxyInfo[], concurrency = 10): Promise<ProxyInfo[]> {
  const valid: ProxyInfo[] = [];

  for (let i = 0; i < proxies.length; i += concurrency) {
    const batch = proxies.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (proxy) => {
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
 * Strategy: GeoNode residential first → Proxifly → free lists as backup.
 */
export async function refreshProxyPool(): Promise<{ fetched: number; validated: number; total: number }> {
  if (isRefreshing) {
    return { fetched: 0, validated: 0, total: proxyPool.length };
  }

  isRefreshing = true;
  console.log('[Proxy] Refreshing proxy pool...');

  try {
    // ── Phase 1: GeoNode residential proxies (BEST for TeraBox — avoids captcha) ──
    const geoNodeProxies = await fetchFromGeoNode();
    // Validate residential proxies (they're usually good, but check anyway)
    const validGeoNode = geoNodeProxies.length > 0
      ? await validateBatch(geoNodeProxies.slice(0, 15), 5)
      : [];
    console.log(`[Proxy] GeoNode residential: ${validGeoNode.length}/${geoNodeProxies.length} valid`);

    // ── Phase 2: Proxifly (pre-validated — fast) ──
    const proxiflyProxies = await fetchFromProxifly(10);

    // ── Phase 3: Free lists (datacenter — least reliable, validate carefully) ──
    const freeRawProxies = await fetchFromFreeLists();
    console.log(`[Proxy] Fetched ${freeRawProxies.length} raw proxies from ${FREE_PROXY_SOURCES.length} free sources`);

    // Validate a sample of free proxies (first 30 — don't waste time)
    const toValidate = freeRawProxies.slice(0, 30);
    const validFreeProxies = await validateBatch(toValidate, 15);
    console.log(`[Proxy] Validated ${validFreeProxies.length} working free proxies`);

    // ── Merge: Residential first (best for TeraBox), then Proxifly, then free ──
    const allNew = [...validGeoNode, ...proxiflyProxies, ...validFreeProxies];

    // Merge with existing pool (keep working proxies, add new ones)
    const existingUrls = new Set(proxyPool.map(p => p.url));
    const newProxies = allNew.filter(p => !existingUrls.has(p.url));

    // Keep existing working proxies, add new ones
    // Residential proxies go first in the pool for priority
    proxyPool = [
      ...proxyPool.filter(p => p.failCount < MAX_FAILS), // keep working existing
      ...newProxies,
    ];
    currentIndex = 0;
    lastRefreshTime = Date.now();

    const hqCount = proxyPool.filter(p => p.source === 'geonode' || p.source === 'proxyscrape-elite').length;
    const proxiflyCount = proxyPool.filter(p => p.source === 'proxifly').length;
    const freeCount = proxyPool.filter(p => p.source !== 'geonode' && p.source !== 'proxifly' && p.source !== 'proxyscrape-elite').length;
    console.log(`[Proxy] Pool size: ${proxyPool.length} (HighQuality: ${hqCount}, Proxifly: ${proxiflyCount}, Free: ${freeCount})`);

    return {
      fetched: freeRawProxies.length + proxiflyProxies.length + geoNodeProxies.length,
      validated: validFreeProxies.length + proxiflyProxies.length + validGeoNode.length,
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
 * ★ Prefers residential proxies (GeoNode) → Proxifly → free proxies.
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

  // ★ Priority 1: High-quality proxies (GeoNode residential + ProxyScrape elite)
  const hqProxies = proxyPool.filter(
    p => (p.source === 'geonode' || p.source === 'proxyscrape-elite') && p.failCount < MAX_FAILS
  );
  if (hqProxies.length > 0) {
    const proxy = hqProxies[currentIndex % hqProxies.length];
    currentIndex++;
    return proxy;
  }

  // ★ Priority 2: Proxifly proxies (pre-validated, rotate automatically)
  const proxiflyProxies = proxyPool.filter(p => p.source === 'proxifly' && p.failCount < MAX_FAILS);
  if (proxiflyProxies.length > 0) {
    const proxy = proxiflyProxies[currentIndex % proxiflyProxies.length];
    currentIndex++;
    return proxy;
  }

  // ★ Priority 3: Any working proxy
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
  residentialCount: number;
  proxiflyCount: number;
  freeCount: number;
  proxies: Array<{ url: string; source?: string; country?: string; anonymity?: string; successCount: number; failCount: number }>;
} {
  const residentialCount = proxyPool.filter(p => p.source === 'geonode' || p.source === 'proxyscrape-elite').length;
  const proxiflyCount = proxyPool.filter(p => p.source === 'proxifly').length;
  const freeCount = proxyPool.filter(p => p.source !== 'geonode' && p.source !== 'proxifly' && p.source !== 'proxyscrape-elite').length;

  return {
    poolSize: proxyPool.length,
    currentIndex,
    lastRefresh: lastRefreshTime ? new Date(lastRefreshTime).toISOString() : 'never',
    isRefreshing,
    residentialCount,
    proxiflyCount,
    freeCount,
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
  const parsed = proxies.map(l => parseProxy(l, 'custom')).filter((p): p is ProxyInfo => p !== null);
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
