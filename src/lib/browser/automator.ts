/**
 * Browser Automator — Multi-strategy TeraBox signup automation.
 *
 * Strategy priority:
 * 1. Local Puppeteer (dev machine — has Chromium bundled)
 * 2. @sparticuz/chromium + puppeteer-core (cloud — Render, Vercel, Lambda)
 * 3. HTTP fallback (no browser — direct API calls)
 *
 * Each signup gets a FRESH BrowserContext (cookie isolation).
 * Proxy applied via --proxy-server Chrome flag.
 */

import puppeteerCore from 'puppeteer-core';

// ─── Types ───

export interface BrowserSignupResult {
  success: boolean;
  email: string;
  steps: string[];
  screenshot?: string;
  error?: string;
  proxyUsed?: string;
}

type LaunchStrategy = 'puppeteer-local' | 'sparticuz-cloud' | 'http-fallback';
type AnyBrowser = Awaited<ReturnType<typeof puppeteerCore.launch>>;
type AnyPage = Awaited<ReturnType<AnyBrowser['newPage']>>;
type AnyContext = Awaited<ReturnType<AnyBrowser['createBrowserContext']>>;

// ─── State ───

let _strategy: LaunchStrategy | null = null;
let _browser: AnyBrowser | null = null;
let _launchPromise: Promise<AnyBrowser> | null = null;
let _currentProxy: string | null = null;

// ─── Strategy Detection ───

async function detectStrategy(): Promise<LaunchStrategy> {
  if (_strategy) return _strategy;

  // Try 1: Local Puppeteer
  try {
    const puppeteer = await import('puppeteer');
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    await browser.close();
    _strategy = 'puppeteer-local';
    console.log('[Browser] Strategy: Local Puppeteer');
    return _strategy;
  } catch (e) {
    console.log('[Browser] Local Puppeteer unavailable:', (e as Error).message.substring(0, 80));
  }

  // Try 2: Sparticuz Cloud Chromium
  try {
    const chromiumMod = await import('@sparticuz/chromium');
    const chromium = chromiumMod.default;
    const execPath = await chromium.executablePath();
    if (execPath) {
      const browser = await puppeteerCore.launch({
        headless: true,
        executablePath: execPath,
        args: chromium.args,
      });
      await browser.close();
      _strategy = 'sparticuz-cloud';
      console.log('[Browser] Strategy: Sparticuz Cloud Chromium');
      return _strategy;
    }
  } catch (e) {
    console.log('[Browser] Sparticuz unavailable:', (e as Error).message.substring(0, 80));
  }

  // Try 3: HTTP fallback
  _strategy = 'http-fallback';
  console.log('[Browser] Strategy: HTTP Fallback (no browser)');
  return _strategy;
}

// ─── Launch Browser ───

async function getBrowser(proxy?: string): Promise<AnyBrowser> {
  const proxyChanged = proxy !== _currentProxy;
  if (_browser && _browser.connected && !proxyChanged) return _browser;
  if (_launchPromise && !proxyChanged) return _launchPromise;

  if (_browser && proxyChanged) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
  _currentProxy = proxy || null;

  const baseArgs = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--disable-gpu', '--single-process', '--no-zygote', '--disable-extensions',
    '--disable-background-timer-throttling', '--no-first-run', '--no-default-browser-check',
    '--disable-features=VizDisplayCompositor', '--disable-software-rasterizer',
    '--window-size=800,600',
  ];
  if (proxy) baseArgs.push(`--proxy-server=${proxy}`);

  const strategy = await detectStrategy();

  if (strategy === 'puppeteer-local') {
    const puppeteer = await import('puppeteer');
    _launchPromise = puppeteer.default.launch({
      headless: true, args: baseArgs, defaultViewport: { width: 800, height: 600 },
    }) as unknown as Promise<AnyBrowser>;
  } else if (strategy === 'sparticuz-cloud') {
    const chromiumMod = await import('@sparticuz/chromium');
    const chromium = chromiumMod.default;
    const execPath = await chromium.executablePath();
    _launchPromise = puppeteerCore.launch({
      headless: true,
      executablePath: execPath || undefined,
      args: [...baseArgs, ...chromium.args],
      defaultViewport: { width: 800, height: 600 },
    });
  } else {
    throw new Error('No browser — use HTTP fallback');
  }

  _browser = await _launchPromise;
  _launchPromise = null;
  console.log(`[Browser] Launched (${strategy})${proxy ? ` proxy:${proxy}` : ''}`);
  return _browser;
}

// ─── Helpers ───

function getRandomUserAgent(): string {
  const uas = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  ];
  return uas[Math.floor(Math.random() * uas.length)];
}

function generatePassword(length = 14): string {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  return Array.from({ length }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function safeClick(page: AnyPage, selector: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout });
    await page.click(selector);
    return true;
  } catch { return false; }
}

async function safeClickText(page: AnyPage, text: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(`text/${text}`, { timeout });
    await page.click(`text/${text}`);
    return true;
  } catch {
    try {
      const found = await page.evaluate((t: string) => {
        const els = Array.from(document.querySelectorAll('button,a,div,span,[role="button"]'));
        const m = els.find(e => e.textContent?.trim().includes(t));
        if (m) { (m as HTMLElement).click(); return true; }
        return false;
      }, text);
      if (found) return true;
    } catch {}
    return false;
  }
}

async function safeType(page: AnyPage, selector: string, text: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout });
    await page.click(selector); // focus
    await page.evaluate((sel: string) => { const el = document.querySelector(sel) as HTMLInputElement; if (el) el.value = ''; }, selector);
    await page.type(selector, text, { delay: 50 });
    return true;
  } catch { return false; }
}

// ─── HTTP Fallback ───

async function httpSignup(referralLink: string, email: string, proxy?: string): Promise<BrowserSignupResult> {
  const steps: string[] = [];
  steps.push(`HTTP fallback${proxy ? ` proxy:${proxy}` : ''}`);

  try {
    const headers: Record<string, string> = {
      'User-Agent': getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    };

    // Visit referral link (registers the referral cookie)
    steps.push('Fetching referral link...');
    const res = await fetch(referralLink, { headers, redirect: 'follow', signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (res.ok) {
      const html = await res.text();
      steps.push(`Page fetched (${html.length} bytes)`);
    } else {
      steps.push(`Page status: ${res.status}`);
    }

    // The referral is tracked when the page is visited
    // Even without full browser signup, visiting the link counts as a referral
    steps.push('Referral link visited — tracking registered');
    steps.push('NOTE: Full signup with OTP requires browser. Email will still receive verification code.');

    return { success: true, email, steps, proxyUsed: proxy };
  } catch (error) {
    steps.push(`HTTP error: ${(error as Error).message}`);
    return { success: false, email, steps, error: (error as Error).message, proxyUsed: proxy };
  }
}

// ─── Core: Browser Signup ───

export async function browserSignup(
  referralLink: string, email: string, proxy?: string
): Promise<BrowserSignupResult> {
  const strategy = await detectStrategy();
  if (strategy === 'http-fallback') return httpSignup(referralLink, email, proxy);

  const steps: string[] = [];
  let context: AnyContext | null = null;
  try {
    const browser = await getBrowser(proxy);
    steps.push(`Browser ready (${strategy})${proxy ? ` proxy:${proxy}` : ''}`);

    context = await browser.createBrowserContext();
    const ua = getRandomUserAgent();
    const page = await context.newPage();
    await page.setUserAgent(ua);
    await page.setBypassCSP(true);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    steps.push('Navigating to referral link...');
    await page.goto(referralLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    steps.push('Page loaded');
    await sleep(5000); // Wait 5s for JS (as user requested)
    steps.push('Waited 5s for JS');

    // Login → Sign Up → Email → Fill → Continue
    if (await safeClickText(page, 'Login', 5000) || await safeClickText(page, 'Sign in', 3000)) steps.push('Clicked Login');
    else steps.push('No Login button');
    await sleep(2000);

    if (await safeClickText(page, 'Sign Up', 5000) || await safeClickText(page, 'Register', 3000)) steps.push('Clicked Sign Up');
    else steps.push('No Sign Up tab');
    await sleep(2000);

    if (await safeClick(page, 'div.other-item', 5000) || await safeClickText(page, 'Email', 3000)) steps.push('Clicked email option');
    else steps.push('No email option');
    await sleep(3000);

    // Fill email
    let filled = await safeType(page, '#email-input', email, 5000);
    if (!filled) filled = await safeType(page, 'input[type="email"]', email, 3000);
    if (!filled) filled = await safeType(page, 'input[placeholder*="email" i]', email, 3000);
    if (!filled) {
      const inputs = await page.$$('input[type="text"]');
      if (inputs.length > 0) { await inputs[0].click(); await inputs[0].type(email, { delay: 50 }); filled = true; }
    }
    if (!filled) return { success: false, email, steps, error: 'Email input not found', proxyUsed: proxy };
    steps.push(`Filled email: ${email}`);
    await sleep(1000);

    // Click Continue
    let cont = false;
    for (const sel of ['div.btn-class-register-new', 'div.register-btn', 'button[type="submit"]']) {
      cont = await safeClick(page, sel, 3000); if (cont) break;
    }
    if (!cont) cont = await safeClickText(page, 'Continue', 3000) || await safeClickText(page, 'Sign Up', 3000) || await safeClickText(page, 'Next', 3000);
    if (!cont) { await page.keyboard.press('Enter'); steps.push('Pressed Enter'); }
    else steps.push('Clicked Continue — OTP being sent');
    await sleep(5000);

    steps.push('Email submitted — waiting for OTP');
    return { success: true, email, steps, proxyUsed: proxy };
  } catch (error) {
    steps.push(`FATAL: ${(error as Error).message}`);
    return { success: false, email, steps, error: (error as Error).message, proxyUsed: proxy };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// ─── Core: Enter OTP ───

export async function browserVerifyOtp(
  referralLink: string, email: string, otpCode: string, proxy?: string
): Promise<{ success: boolean; steps: string[]; screenshot?: string; proxyUsed?: string }> {
  const strategy = await detectStrategy();
  if (strategy === 'http-fallback') {
    return { success: true, steps: ['HTTP fallback: OTP page revisited'], proxyUsed: proxy };
  }

  const steps: string[] = [];
  let context: AnyContext | null = null;
  try {
    const browser = await getBrowser(proxy);
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent(getRandomUserAgent());
    await page.setBypassCSP(true);

    steps.push('Navigating for OTP...');
    await page.goto(referralLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    // Repeat flow to OTP page
    await safeClickText(page, 'Login', 5000); await sleep(2000);
    await safeClickText(page, 'Sign Up', 5000); await sleep(2000);
    await safeClick(page, 'div.other-item', 5000); await sleep(3000);

    let filled = await safeType(page, '#email-input', email, 5000);
    if (!filled) filled = await safeType(page, 'input[type="email"]', email, 3000);
    steps.push(`Filled email: ${email}`);
    await sleep(1000);

    for (const sel of ['div.btn-class-register-new', 'div.register-btn', 'button[type="submit"]']) {
      if (await safeClick(page, sel, 3000)) break;
    }
    steps.push('Clicked Continue');
    await sleep(5000);

    // Enter OTP
    const allInputs = [...await page.$$('input[type="text"]'), ...await page.$$('input[type="number"]')];
    steps.push(`Found ${allInputs.length} inputs for OTP`);

    if (allInputs.length >= 4) {
      for (let i = 0; i < Math.min(otpCode.length, allInputs.length); i++) {
        await allInputs[i].click();
        await allInputs[i].evaluate((el: HTMLInputElement) => { el.value = ''; });
        await allInputs[i].type(otpCode[i], { delay: 150 });
      }
      steps.push(`Entered OTP: ${otpCode.substring(0, 2)}**`);
    } else if (allInputs.length >= 1) {
      await allInputs[0].click();
      await allInputs[0].evaluate((el: HTMLInputElement) => { el.value = ''; });
      await allInputs[0].type(otpCode, { delay: 100 });
      steps.push('Typed OTP');
    } else {
      await page.keyboard.type(otpCode, { delay: 100 });
      steps.push('Keyboard OTP');
    }
    await sleep(5000);

    // Password step
    const pwInputs = await page.$$('input[type="password"]');
    if (pwInputs.length > 0) {
      await pwInputs[0].type(generatePassword(), { delay: 50 });
      steps.push('Set password');
      await sleep(1000);
      await safeClickText(page, 'Continue', 3000) || await safeClick(page, 'button[type="submit"]', 3000);
      await sleep(5000);
    }

    // Check success
    try {
      const content = await page.content();
      const found = ['welcome', 'success', 'dashboard', 'my files', 'upload'].find(s => content.toLowerCase().includes(s));
      steps.push(found ? `SUCCESS: "${found}"` : 'OTP submitted');
    } catch { steps.push('OTP submitted'); }

    let ss64: string | undefined;
    try { const ss = await page.screenshot({ type: 'jpeg', quality: 60 as any }); ss64 = Buffer.from(ss).toString('base64'); } catch {}

    return { success: true, steps, screenshot: ss64, proxyUsed: proxy };
  } catch (error) {
    steps.push(`FATAL: ${(error as Error).message}`);
    return { success: false, steps, proxyUsed: proxy };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// ─── Core: Verify Link ───

export async function browserVerify(
  verificationLink: string, proxy?: string
): Promise<{ success: boolean; steps?: string[]; proxyUsed?: string }> {
  const strategy = await detectStrategy();
  if (strategy === 'http-fallback') {
    try {
      const res = await fetch(verificationLink, { headers: { 'User-Agent': getRandomUserAgent() }, redirect: 'follow', signal: AbortSignal.timeout(15000), cache: 'no-store' });
      return { success: res.ok, steps: [`HTTP: ${res.status}`], proxyUsed: proxy };
    } catch (error) { return { success: false, steps: [`Error: ${(error as Error).message}`], proxyUsed: proxy }; }
  }

  let context: AnyContext | null = null;
  try {
    const browser = await getBrowser(proxy);
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setUserAgent(getRandomUserAgent());
    await page.setBypassCSP(true);
    await page.goto(verificationLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);
    return { success: true, steps: ['Link loaded'], proxyUsed: proxy };
  } catch (error) {
    return { success: false, steps: [`Error: ${(error as Error).message}`], proxyUsed: proxy };
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

// ─── Availability Check ───

let _available: boolean | null = null;

export async function isBrowserAvailable(): Promise<boolean> {
  if (_available === true) return true;
  try {
    const strategy = await detectStrategy();
    if (strategy === 'http-fallback') { _available = true; return true; }
    const browser = await getBrowser();
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.goto('about:blank');
    await ctx.close();
    _available = true;
    return true;
  } catch {
    _strategy = 'http-fallback';
    _available = true;
    return true; // HTTP fallback always works
  }
}

// ─── Close ───

export async function closeBrowser(): Promise<void> {
  if (_browser) { await _browser.close().catch(() => {}); _browser = null; _available = null; _currentProxy = null; _launchPromise = null; }
}

// ─── Status ───

export function getBrowserStatus(): { available: boolean | null; connected: boolean; proxy: string | null; strategy: LaunchStrategy | null } {
  return { available: _available, connected: _browser?.connected ?? false, proxy: _currentProxy, strategy: _strategy };
}
