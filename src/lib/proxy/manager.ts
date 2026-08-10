/**
 * Proxy Rotation Manager — Proxifly API + free list fallback.
 *
 * STRATEGY (layered — Proxifly first, free lists as backup):
 * 1. PRIMARY: Proxifly API (api.proxifly.dev) — rotating HTTPS proxies,
 *    tested by Proxifly before delivery. Free tier: no API key needed.
 * 2. BACKUP:  Free proxy list APIs (ProxyScrape, GitHub lists) — validated
 *    locally via https-proxy-agent. Less reliable but adds pool diversity.
 *
 * FEATURES:
 * - Proxifly on-demand proxy per signup (rotates automatically on each call)
 * - Batch validation of free proxies (concurrent, timeout-aware)
 * - Round-robin rotation through validated pool
 * - Auto-refresh when pool is stale/depleted (every 5 min)
 * - Failure tracking: remove proxy after 3 consecutive fails
 * - Direct-connection fallback if no proxy available
 *
 * PROXIFLY API: https://proxifly.dev/
 *   POST https://api.proxifly.dev/get-proxy
 *   Body: { quantity: N, protocol: [...], https: true, anonymity: [...] }
 *   Response: { proxy, protocol, ip, port, https, anonymity, geolocation }
 *   Free tier: no API key needed, ~1 proxy per call
 */

import { HttpsProxyAgent } from 'https-proxy-agent';

// ─── Types ───

export interface ProxyInfo {
  url: string;           // e.g. "http://1.2.3.4:8080"
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  country?: string;
  source?: string;       // which provider gave us this proxy
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

// ─── Free Proxy API Sources (Backup) ───

const FREE_PROXY_SOURCES = [
  {
    name: 'proxyscrape',
    url: 'https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&proxy_format=display&anonymity=transparent&anonymity=anonymous',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  {
    name: 'free-proxy-list',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  {
    name: 'monosans',
    url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    parse: (text: string): string[] => text.trim().split('\n').filter(l => l.includes(':')),
  },
  {
    name: 'clarketm',
    url: 'https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt',
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
    return {
      url: `http://${host}:${port}`,
      host,
      port,
      protocol: 'http',
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

async function validateProxy(proxy: ProxyInfo, timeoutMs = 8000): Promise<boolean> {
  // Proxifly proxies are pre-validated — just do a quick connectivity check
  if (proxy.source === 'proxifly' && proxy.lastVerified > Date.now() - 60000) {
    return true; // Trust Proxifly's pre-test if less than 1 min old
  }

  try {
    const agent = new HttpsProxyAgent(proxy.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch('https://httpbin.org/ip', {
      signal: controller.signal,
      // @ts-expect-error - agent is supported by Node.js undici fetch
      dispatcher: agent,
      cache: 'no-store',
    });

    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data?.origin) {
        proxy.lastVerified = Date.now();
        return true;
      }
    }
    return false;
  } catch {
    // Fallback: try a simpler validation
    try {
      const agent = new HttpsProxyAgent(proxy.url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const res = await fetch('https://www.google.com/', {
        method: 'HEAD',
        signal: controller.signal,
        // @ts-expect-error - agent is supported by Node.js undici fetch
        dispatcher: agent,
        cache: 'no-store',
        redirect: 'manual',
      });

      clearTimeout(timer);
      if (res.status >= 200 && res.status < 500) {
        proxy.lastVerified = Date.now();
        return true;
      }
    } catch {}
    return false;
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
 * Strategy: Proxifly first (fast, pre-validated), then free lists as backup.
 */
export async function refreshProxyPool(): Promise<{ fetched: number; validated: number; total: number }> {
  if (isRefreshing) {
    return { fetched: 0, validated: 0, total: proxyPool.length };
  }

  isRefreshing = true;
  console.log('[Proxy] Refreshing proxy pool...');

  try {
    // ── Phase 1: Proxifly (primary — fast, pre-validated) ──
    const proxiflyProxies = await fetchFromProxifly(10);

    // ── Phase 2: Free lists (backup — needs validation) ──
    const freeRawProxies = await fetchFromFreeLists();
    console.log(`[Proxy] Fetched ${freeRawProxies.length} raw proxies from ${FREE_PROXY_SOURCES.length} free sources`);

    // Validate a sample of free proxies (first 50 — don't waste time on too many)
    const toValidate = freeRawProxies.slice(0, 50);
    const validFreeProxies = await validateBatch(toValidate, 15);
    console.log(`[Proxy] Validated ${validFreeProxies.length} working free proxies`);

    // ── Merge: Proxifly first (they're pre-validated), then free proxies ──
    const allNew = [...proxiflyProxies, ...validFreeProxies];

    // Merge with existing pool (keep working proxies, add new ones)
    const existingUrls = new Set(proxyPool.map(p => p.url));
    const newProxies = allNew.filter(p => !existingUrls.has(p.url));

    // Keep existing working proxies, add new ones
    // Proxifly proxies go first in the pool for priority
    proxyPool = [
      ...proxyPool.filter(p => p.failCount < MAX_FAILS), // keep working existing
      ...newProxies,
    ];
    currentIndex = 0;
    lastRefreshTime = Date.now();

    const proxiflyCount = proxyPool.filter(p => p.source === 'proxifly').length;
    const freeCount = proxyPool.filter(p => p.source !== 'proxifly').length;
    console.log(`[Proxy] Pool size: ${proxyPool.length} (Proxifly: ${proxiflyCount}, Free: ${freeCount})`);

    return {
      fetched: freeRawProxies.length + proxiflyProxies.length,
      validated: validFreeProxies.length + proxiflyProxies.length,
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
 * Prefers Proxifly proxies (they're pre-validated and rotate automatically).
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

  // Prefer Proxifly proxies (source === 'proxifly') — they rotate automatically
  const proxiflyProxies = proxyPool.filter(p => p.source === 'proxifly' && p.failCount < MAX_FAILS);
  if (proxiflyProxies.length > 0) {
    // Round-robin through Proxifly proxies
    const proxy = proxiflyProxies[currentIndex % proxiflyProxies.length];
    currentIndex++;
    return proxy;
  }

  // Fallback: any working proxy
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
  proxiflyCount: number;
  freeCount: number;
  proxies: Array<{ url: string; source?: string; country?: string; successCount: number; failCount: number }>;
} {
  const proxiflyCount = proxyPool.filter(p => p.source === 'proxifly').length;
  const freeCount = proxyPool.filter(p => p.source !== 'proxifly').length;

  return {
    poolSize: proxyPool.length,
    currentIndex,
    lastRefresh: lastRefreshTime ? new Date(lastRefreshTime).toISOString() : 'never',
    isRefreshing,
    proxiflyCount,
    freeCount,
    proxies: proxyPool.slice(0, 20).map(p => ({
      url: p.url,
      source: p.source,
      country: p.country,
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
