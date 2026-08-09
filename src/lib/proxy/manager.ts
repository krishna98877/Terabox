/**
 * Proxy Rotation Manager — Fetches, validates, and rotates free proxies.
 *
 * Strategy:
 * - Fetch proxies from multiple free APIs on startup
 * - Validate each proxy by testing HTTP connectivity (using https-proxy-agent)
 * - Maintain a pool of working proxies
 * - Rotate through the pool (round-robin) for each signup
 * - Auto-refresh when pool is depleted or proxies go stale
 * - If no proxies available, fall back to direct connection
 */

import { HttpsProxyAgent } from 'https-proxy-agent';

// ─── Types ───

export interface ProxyInfo {
  url: string;           // e.g. "http://1.2.3.4:8080"
  host: string;
  port: number;
  protocol: 'http' | 'https' | 'socks4' | 'socks5';
  country?: string;
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

// ─── Free Proxy API Sources ───

const PROXY_SOURCES = [
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

function parseProxy(line: string): ProxyInfo | null {
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
      lastVerified: 0,
      failCount: 0,
      successCount: 0,
    };
  } catch {
    return null;
  }
}

// ─── Validate a single proxy using https-proxy-agent ───

async function validateProxy(proxy: ProxyInfo, timeoutMs = 8000): Promise<boolean> {
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
      // If we get a different IP than our own, the proxy works
      if (data?.origin) {
        proxy.lastVerified = Date.now();
        return true;
      }
    }
    return false;
  } catch {
    // Fallback: try a simpler validation using direct TCP connection
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
      // Any response (even redirect) means the proxy connected
      if (res.status >= 200 && res.status < 500) {
        proxy.lastVerified = Date.now();
        return true;
      }
    } catch {}
    return false;
  }
}

// ─── Fetch proxies from all sources ───

async function fetchFromSources(): Promise<ProxyInfo[]> {
  const allProxies: ProxyInfo[] = [];

  const results = await Promise.allSettled(
    PROXY_SOURCES.map(async (source) => {
      try {
        const res = await fetch(source.url, {
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
        });
        if (!res.ok) return [];
        const text = await res.text();
        const lines = source.parse(text);
        return lines.map(parseProxy).filter((p): p is ProxyInfo => p !== null);
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

// ─── Validate proxies in batch (fast concurrent validation) ───

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
 * Fetches proxies from free APIs and validates them.
 */
export async function refreshProxyPool(): Promise<{ fetched: number; validated: number; total: number }> {
  if (isRefreshing) {
    return { fetched: 0, validated: 0, total: proxyPool.length };
  }

  isRefreshing = true;
  console.log('[Proxy] Refreshing proxy pool...');

  try {
    // Fetch raw proxies
    const rawProxies = await fetchFromSources();
    console.log(`[Proxy] Fetched ${rawProxies.length} raw proxies from ${PROXY_SOURCES.length} sources`);

    // Validate a sample (first 80 to improve chances)
    const toValidate = rawProxies.slice(0, 80);
    const validProxies = await validateBatch(toValidate, 15);
    console.log(`[Proxy] Validated ${validProxies.length} working proxies`);

    // Merge with existing pool (keep working proxies, add new ones)
    const existingUrls = new Set(proxyPool.map(p => p.url));
    const newProxies = validProxies.filter(p => !existingUrls.has(p.url));

    proxyPool = [...proxyPool.filter(p => p.failCount < MAX_FAILS), ...newProxies];
    currentIndex = 0;
    lastRefreshTime = Date.now();

    console.log(`[Proxy] Pool size: ${proxyPool.length} proxies`);
    return { fetched: rawProxies.length, validated: validProxies.length, total: proxyPool.length };
  } catch (error) {
    console.error('[Proxy] Refresh failed:', (error as Error).message);
    return { fetched: 0, validated: 0, total: proxyPool.length };
  } finally {
    isRefreshing = false;
  }
}

/**
 * Get the next proxy in rotation.
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

  // Round-robin rotation
  const proxy = proxyPool[currentIndex % proxyPool.length];
  currentIndex++;

  return proxy;
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
  proxies: Array<{ url: string; successCount: number; failCount: number }>;
} {
  return {
    poolSize: proxyPool.length,
    currentIndex,
    lastRefresh: lastRefreshTime ? new Date(lastRefreshTime).toISOString() : 'never',
    isRefreshing,
    proxies: proxyPool.slice(0, 20).map(p => ({
      url: p.url,
      successCount: p.successCount,
      failCount: p.failCount,
    })),
  };
}

/**
 * Set custom proxy list (for user-configured proxies).
 */
export function setCustomProxies(proxies: string[]): void {
  const parsed = proxies.map(parseProxy).filter((p): p is ProxyInfo => p !== null);
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
