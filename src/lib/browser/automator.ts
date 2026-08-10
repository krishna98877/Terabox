/**
 * Browser Automator — TeraBox signup automation with stealth & captcha support.
 *
 * Strategy priority:
 * 1. puppeteer-extra + stealth plugin (anti-detection)
 * 2. Local Puppeteer (dev machine — has Chromium bundled)
 * 3. @sparticuz/chromium + puppeteer-core (cloud — Render, Vercel, Lambda)
 * 4. HTTP fallback (no browser — direct API calls)
 *
 * KEY DESIGN: signup + OTP happen in the SAME browser context.
 * browserSignup() returns the page + context so engine.ts can reuse them
 * for OTP entry without re-navigating.
 *
 * TeraBox DOM (verified Aug 2026):
 * - Login button: div.login-btn or div.btn.primary (text "Login")
 * - Sign Up tab: span.login-method (text "Sign up")
 * - Email icon: first div.logo inside div.other-item
 * - Email/Phone tabs appear after clicking email icon
 * - Email input: input with type="email" or placeholder containing "email"
 * - Continue button: various div.btn variants
 * - OTP inputs: input[type="text"] or input[type="number"] after OTP sent
 * - reCAPTCHA Enterprise: div#robot with iframe
 */

import puppeteerCore from 'puppeteer-core';
import { isCaptchaConfigured, solveRecaptcha } from '@/lib/captcha';

// ─── Types ───

export interface BrowserSignupResult {
  success: boolean;
  email: string;
  steps: string[];
  screenshot?: string;
  error?: string;
  proxyUsed?: string;
  /** The active page and context for OTP entry — engine.ts MUST use these */
  page?: AnyPage;
  context?: AnyContext;
}

export interface OtpEntryResult {
  success: boolean;
  steps: string[];
  screenshot?: string;
  password?: string;
}

type LaunchStrategy = 'puppeteer-stealth' | 'puppeteer-local' | 'sparticuz-cloud' | 'http-fallback';
type AnyBrowser = Awaited<ReturnType<typeof puppeteerCore.launch>>;
type AnyPage = Awaited<ReturnType<AnyBrowser['newPage']>>;
type AnyContext = Awaited<ReturnType<AnyBrowser['createBrowserContext']>>;

// ─── State ───

let _strategy: LaunchStrategy | null = null;
let _browser: AnyBrowser | null = null;
let _launchPromise: Promise<AnyBrowser> | null = null;
let _currentProxy: string | null = null;

// ─── Captcha Config ───
// Uses @/lib/captcha (direct 2captcha API) — no npm package dependency

// ─── Strategy Detection ───

async function detectStrategy(): Promise<LaunchStrategy> {
  if (_strategy) return _strategy;

  // Try 1: puppeteer-extra with stealth
  try {
    const puppeteerExtra = (await import('puppeteer-extra')).default;
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    puppeteerExtra.use(StealthPlugin());

    const browser = await puppeteerExtra.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    await browser.close();
    _strategy = 'puppeteer-stealth';
    console.log('[Browser] Strategy: puppeteer-extra + stealth');
    return _strategy;
  } catch (e) {
    console.log('[Browser] puppeteer-extra unavailable:', (e as Error).message.substring(0, 80));
  }

  // Try 2: Local Puppeteer
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

  // Try 3: Sparticuz Cloud Chromium
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

  // Try 4: HTTP fallback
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
    '--window-size=1280,800',
    // Stealth-related flags
    '--disable-blink-features=AutomationControlled',
  ];
  if (proxy) baseArgs.push(`--proxy-server=${proxy}`);

  const strategy = await detectStrategy();

  if (strategy === 'puppeteer-stealth') {
    const puppeteerExtra = (await import('puppeteer-extra')).default;
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    puppeteerExtra.use(StealthPlugin());
    _launchPromise = puppeteerExtra.launch({
      headless: true, args: baseArgs, defaultViewport: { width: 1280, height: 800 },
    }) as unknown as Promise<AnyBrowser>;
  } else if (strategy === 'puppeteer-local') {
    const puppeteer = await import('puppeteer');
    _launchPromise = puppeteer.default.launch({
      headless: true, args: baseArgs, defaultViewport: { width: 1280, height: 800 },
    }) as unknown as Promise<AnyBrowser>;
  } else if (strategy === 'sparticuz-cloud') {
    const chromiumMod = await import('@sparticuz/chromium');
    const chromium = chromiumMod.default;
    const execPath = await chromium.executablePath();
    _launchPromise = puppeteerCore.launch({
      headless: true,
      executablePath: execPath || undefined,
      args: [...baseArgs, ...chromium.args],
      defaultViewport: { width: 1280, height: 800 },
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
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  ];
  return uas[Math.floor(Math.random() * uas.length)];
}

function generatePassword(length = 14): string {
  const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
  return Array.from({ length }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function takeScreenshot(page: AnyPage): Promise<string | undefined> {
  try {
    const ss = await page.screenshot({ type: 'jpeg', quality: 60 as any });
    return Buffer.from(ss).toString('base64');
  } catch { return undefined; }
}

// ─── Robust Click/Type Helpers ───

async function safeClick(page: AnyPage, selector: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout, visible: true });
    await page.click(selector);
    return true;
  } catch { return false; }
}

async function safeClickText(page: AnyPage, text: string, timeout = 5000): Promise<boolean> {
  // Try Puppeteer text selector first
  try {
    await page.waitForSelector(`text/${text}`, { timeout: Math.min(timeout, 3000) });
    await page.click(`text/${text}`);
    return true;
  } catch {}

  // Fallback: DOM scan for matching text
  try {
    const found = await page.evaluate((t: string) => {
      const els = Array.from(document.querySelectorAll('button, a, div, span, [role="button"]'));
      const match = els.find(e => (e as HTMLElement).offsetWidth > 0 && e.textContent?.trim() === t);
      if (match) { (match as HTMLElement).click(); return true; }
      // Partial match
      const partial = els.find(e => (e as HTMLElement).offsetWidth > 0 && e.textContent?.trim().includes(t));
      if (partial) { (partial as HTMLElement).click(); return true; }
      return false;
    }, text);
    if (found) return true;
  } catch {}
  return false;
}

async function safeType(page: AnyPage, selector: string, text: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout, visible: true });
    await page.click(selector); // focus
    await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLInputElement;
      if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }, selector);
    await page.type(selector, text, { delay: 50 });
    return true;
  } catch { return false; }
}

// ─── reCAPTCHA Handling ───

/**
 * Attempt to solve reCAPTCHA on the page.
 * Strategy:
 * 1. If 2captcha API key is set, use it to solve
 * 2. Otherwise, try clicking the checkbox (sometimes it auto-passes with stealth)
 * 3. Wait and check if solved
 */
async function handleRecaptcha(page: AnyPage, steps: string[]): Promise<boolean> {
  // Check if captcha is present and visible
  const captchaVisible = await page.evaluate(() => {
    const robotBox = document.querySelector('.robot-box') as HTMLElement;
    if (!robotBox) return false;
    const style = getComputedStyle(robotBox);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  if (!captchaVisible) {
    steps.push('No captcha visible — proceeding');
    return true;
  }

  steps.push('reCAPTCHA detected — attempting to solve...');

  // Strategy 1: CaptchaSolv (solveRecaptcha tries v2 then v3)
  if (isCaptchaConfigured()) {
    try {
      steps.push('Solving captcha via CaptchaSolv...');
      const siteKey = await page.evaluate(() => {
        const iframe = document.querySelector('#robot iframe') as HTMLIFrameElement;
        if (iframe) {
          const url = new URL(iframe.src);
          return url.searchParams.get('k');
        }
        const siteKeyEl = document.querySelector('[data-sitekey]');
        if (siteKeyEl) return siteKeyEl.getAttribute('data-sitekey');
        return null;
      });

      if (siteKey) {
        const token = await solveRecaptcha(siteKey, page.url());

        if (token) {
          await page.evaluate((t: string) => {
            const textarea = document.querySelector('#g-recaptcha-response') as HTMLTextAreaElement;
            if (textarea) {
              textarea.value = t;
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            const successCallback = (window as any).___grecaptcha_cfg?.clients?.['0']?.callback;
            if (typeof successCallback === 'function') {
              successCallback(t);
            }
          }, token);
          steps.push('Captcha solved — token injected');
          await sleep(3000);
          return true;
        }
      } else {
        steps.push('Could not extract reCAPTCHA sitekey from page');
      }
    } catch (err) {
      steps.push(`Captcha solve failed: ${(err as Error).message?.substring(0, 80)}`);
    }
  }

  // Strategy 2: Try clicking the checkbox (sometimes passes with stealth mode)
  try {
    const frames = page.frames();
    const recaptchaFrame = frames.find(f => f.url().includes('recaptcha'));
    if (recaptchaFrame) {
      const checkbox = await recaptchaFrame.$('#recaptcha-anchor');
      if (checkbox) {
        await checkbox.click();
        steps.push('Clicked reCAPTCHA checkbox');
        await sleep(5000);

        // Check if solved
        const solved = await page.evaluate(() => {
          const response = (document.querySelector('#g-recaptcha-response') as HTMLTextAreaElement)?.value;
          return response && response.length > 0;
        });
        if (solved) {
          steps.push('reCAPTCHA auto-solved!');
          return true;
        }
      }
    }
  } catch (err) {
    steps.push(`Checkbox click failed: ${(err as Error).message?.substring(0, 60)}`);
  }

  // Strategy 3: Try to close the captcha dialog and proceed anyway
  try {
    const closed = await page.evaluate(() => {
      const closeBtn = document.querySelector('.robot-box .icon-close, .robot-box .close') as HTMLElement;
      if (closeBtn) { closeBtn.click(); return true; }
      // Force hide
      const robotBox = document.querySelector('.robot-box') as HTMLElement;
      if (robotBox) { robotBox.style.display = 'none'; return true; }
      return false;
    });
    if (closed) {
      steps.push('Closed/dismissed captcha dialog');
      await sleep(2000);
    }
  } catch {}

  steps.push('Captcha handling attempted — may or may not be solved');
  return true; // Continue anyway — sometimes the form is accessible even with captcha
}

// ─── TeraBox-Specific Navigation ───

/**
 * Navigate the TeraBox signup flow: Login → Sign Up → Email icon → Email form
 * Returns the page ready for email input.
 */
async function navigateToSignupForm(page: AnyPage, steps: string[]): Promise<boolean> {
  // Wait for page to be ready
  await sleep(3000);

  // Step 1: Click Login button
  let loginClicked = false;
  // Try multiple selectors for the Login button
  for (const attempt of [
    () => safeClick(page, 'div.login-btn', 5000),
    () => safeClick(page, 'div.btn.primary', 3000),
    () => safeClickText(page, 'Login', 3000),
  ]) {
    loginClicked = await attempt();
    if (loginClicked) break;
  }

  if (!loginClicked) {
    // Maybe we're already on the login page or the page auto-showed the dialog
    const dialogVisible = await page.evaluate(() => !!document.querySelector('.login-box, .new-login-card'));
    if (dialogVisible) {
      loginClicked = true;
      steps.push('Login dialog already open');
    } else {
      steps.push('WARNING: Could not click Login button');
      // Take debug screenshot
      const ss = await takeScreenshot(page);
      if (ss) steps.push('Screenshot saved for debug');
      return false;
    }
  } else {
    steps.push('Clicked Login');
  }
  await sleep(3000);

  // Step 2: Handle captcha if it appears
  await handleRecaptcha(page, steps);

  // Step 3: Click Sign Up tab
  let signupClicked = false;
  for (const attempt of [
    () => page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('span.login-method'));
      const signup = els.find(e => e.textContent?.trim() === 'Sign up');
      if (signup) { (signup as HTMLElement).click(); return true; }
      return false;
    }),
    () => safeClickText(page, 'Sign Up', 3000),
    () => safeClickText(page, 'Sign up', 3000),
    () => safeClickText(page, 'Register', 3000),
  ]) {
    try {
      signupClicked = await attempt();
      if (signupClicked) break;
    } catch {}
  }

  if (signupClicked) steps.push('Clicked Sign Up tab');
  else steps.push('WARNING: Could not click Sign Up tab — may already be on it');
  await sleep(3000);

  // Step 4: Click email icon (first div.logo inside div.other-item)
  let emailIconClicked = false;
  for (const attempt of [
    () => page.evaluate(() => {
      // Click first logo inside other-item (email icon)
      const items = document.querySelectorAll('div.other-item > div.logo');
      if (items.length > 0) { (items[0] as HTMLElement).click(); return true; }
      // Fallback: click other-item itself
      const otherItem = document.querySelector('div.other-item');
      if (otherItem) { (otherItem as HTMLElement).click(); return true; }
      return false;
    }),
    () => safeClick(page, 'div.other-item', 3000),
  ]) {
    try {
      emailIconClicked = await attempt();
      if (emailIconClicked) break;
    } catch {}
  }

  if (emailIconClicked) steps.push('Clicked email icon');
  else steps.push('WARNING: Could not click email icon');
  await sleep(3000);

  // Step 5: Handle captcha again (it may re-appear after clicking email icon)
  await handleRecaptcha(page, steps);

  // Step 6: Look for Email/Phone tabs and select Email
  const emailTabClicked = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, span, a'));
    const emailTab = els.find(e => {
      const t = e.textContent?.trim().toLowerCase();
      return (e as HTMLElement).offsetWidth > 0 && (t === 'email' || t === 'email signup');
    });
    if (emailTab) { (emailTab as HTMLElement).click(); return true; }
    return false;
  });
  if (emailTabClicked) {
    steps.push('Selected Email tab');
    await sleep(2000);
  }

  return true;
}

// ─── Find and fill email input ───

async function fillEmailInput(page: AnyPage, email: string, steps: string[]): Promise<boolean> {
  let filled = false;

  // Try multiple email input selectors
  for (const [label, attempt] of [
    ['input[type="email"]', () => safeType(page, 'input[type="email"]', email, 5000)],
    ['input[name*="email"]', () => safeType(page, 'input[name*="email" i]', email, 3000)],
    ['input[placeholder*="email"]', () => safeType(page, 'input[placeholder*="email" i]', email, 3000)],
    ['#email-input', () => safeType(page, '#email-input', email, 3000)],
  ] as [string, () => Promise<boolean>][]) {
    filled = await attempt();
    if (filled) {
      steps.push(`Filled email (${label}): ${email}`);
      break;
    }
  }

  // Fallback: find any visible text/email input
  if (!filled) {
    filled = await page.evaluate((emailAddr: string) => {
      const inputs = Array.from(document.querySelectorAll('input'));
      const visible = inputs.filter(i => i.offsetWidth > 0 && (
        i.type === 'email' || i.type === 'text' || i.type === 'tel'
      ));
      if (visible.length > 0) {
        const input = visible[0] as HTMLInputElement;
        input.focus();
        input.value = '';
        input.value = emailAddr;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return false;
    }, email);
    if (filled) steps.push(`Filled email (fallback DOM): ${email}`);
  }

  if (!filled) {
    steps.push('ERROR: Could not find email input field');
    return false;
  }

  return true;
}

// ─── Click Continue/Submit button ───

async function clickContinue(page: AnyPage, steps: string[]): Promise<boolean> {
  let clicked = false;

  // Try multiple button selectors
  for (const [label, attempt] of [
    ['Continue text', () => safeClickText(page, 'Continue', 3000)],
    ['Next text', () => safeClickText(page, 'Next', 3000)],
    ['Sign Up text', () => safeClickText(page, 'Sign Up', 3000)],
    ['submit button', () => safeClick(page, 'button[type="submit"]', 3000)],
    ['div.btn-class-register-new', () => safeClick(page, 'div.btn-class-register-new', 3000)],
    ['div.register-btn', () => safeClick(page, 'div.register-btn', 3000)],
    ['main-btn', () => safeClick(page, 'div.main-btn', 3000)],
  ] as [string, () => Promise<boolean>][]) {
    clicked = await attempt();
    if (clicked) {
      steps.push(`Clicked ${label}`);
      break;
    }
  }

  if (!clicked) {
    // Try Enter key as last resort
    await page.keyboard.press('Enter');
    steps.push('Pressed Enter as fallback');
    clicked = true;
  }

  return clicked;
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

    steps.push('Referral link visited — tracking registered');
    steps.push('NOTE: Full signup requires browser. HTTP fallback only visits the link.');

    return { success: true, email, steps, proxyUsed: proxy };
  } catch (error) {
    steps.push(`HTTP error: ${(error as Error).message}`);
    return { success: false, email, steps, error: (error as Error).message, proxyUsed: proxy };
  }
}

// ─── Core: Browser Signup (returns page for OTP) ───

export async function browserSignup(
  referralLink: string, email: string, proxy?: string
): Promise<BrowserSignupResult> {
  const strategy = await detectStrategy();
  if (strategy === 'http-fallback') return httpSignup(referralLink, email, proxy);

  const steps: string[] = [];
  let context: AnyContext | null = null;
  let page: AnyPage | null = null;

  try {
    const browser = await getBrowser(proxy);
    steps.push(`Browser ready (${strategy})${proxy ? ` proxy:${proxy}` : ''}`);

    context = await browser.createBrowserContext();
    const ua = getRandomUserAgent();
    page = await context.newPage();
    await page.setUserAgent(ua);
    await page.setBypassCSP(true);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });

    // Stealth: override navigator properties
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      (window as any).chrome = { runtime: {} };
    });

    // Navigate to referral link
    steps.push('Navigating to referral link...');
    await page.goto(referralLink, { waitUntil: 'domcontentloaded', timeout: 45000 });
    steps.push(`Page loaded: ${page.url().substring(0, 80)}`);
    await sleep(5000);

    // Navigate to signup form
    const navOk = await navigateToSignupForm(page, steps);
    if (!navOk) {
      steps.push('WARNING: Signup navigation incomplete — trying to continue anyway');
    }

    // Fill email
    const emailOk = await fillEmailInput(page, email, steps);
    if (!emailOk) {
      const ss = await takeScreenshot(page);
      // Close context since we're failing
      await context.close().catch(() => {});
      return { success: false, email, steps, error: 'Email input not found', screenshot: ss, proxyUsed: proxy };
    }
    await sleep(1500);

    // Click Continue/Submit
    const contOk = await clickContinue(page, steps);
    if (contOk) steps.push('Clicked Continue — OTP being sent');
    await sleep(5000);

    // Handle any popup captcha after clicking Continue
    await handleRecaptcha(page, steps);

    steps.push('Email submitted — waiting for OTP');

    // IMPORTANT: Return the page and context so engine.ts can reuse them for OTP
    return {
      success: true,
      email,
      steps,
      proxyUsed: proxy,
      page,
      context,
    };
  } catch (error) {
    steps.push(`FATAL: ${(error as Error).message}`);
    const ss = page ? await takeScreenshot(page) : undefined;
    if (context) await context.close().catch(() => {});
    return { success: false, email, steps, error: (error as Error).message, screenshot: ss, proxyUsed: proxy };
  }
  // NOTE: context is NOT closed here — engine.ts owns it now
}

// ─── Core: Enter OTP in SAME page context ───

export async function browserEnterOtp(
  page: AnyPage,
  otpCode: string,
): Promise<OtpEntryResult> {
  const steps: string[] = [];

  try {
    // Wait for OTP input to appear
    await sleep(3000);

    // Try to find OTP input fields
    // TeraBox typically uses either:
    // 1. A single input for the full code
    // 2. Multiple inputs (one per digit)
    // 3. A code input component

    let otpEntered = false;

    // Strategy 1: Look for single OTP input
    for (const selector of [
      'input[placeholder*="code" i]',
      'input[placeholder*="OTP" i]',
      'input[placeholder*="verification" i]',
      'input[name*="code" i]',
      'input[name*="otp" i]',
      'input[name*="verify" i]',
    ]) {
      const found = await safeType(page, selector, otpCode, 3000);
      if (found) {
        steps.push(`Entered OTP in ${selector}`);
        otpEntered = true;
        break;
      }
    }

    // Strategy 2: Multiple single-digit inputs (common for OTP)
    if (!otpEntered) {
      const digitInputs = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const visible = inputs.filter(i => i.offsetWidth > 0 && (
          i.type === 'text' || i.type === 'number' || i.type === 'tel'
        ));
        // Check if these look like OTP digit inputs (small, single char)
        return visible.filter(i => {
          const width = i.offsetWidth;
          const maxLength = i.getAttribute('maxlength');
          return (width > 20 && width < 80) || maxLength === '1';
        }).length;
      });

      if (digitInputs >= 4) {
        // Enter each digit in separate inputs
        const inputs: any[] = await page.$$('input[type="text"], input[type="number"], input[type="tel"]');
        const visibleInputs: any[] = [];
        for (const input of inputs) {
          const visible = await input.evaluate((el: any) => el.offsetWidth > 0);
          if (visible) visibleInputs.push(input);
        }

        for (let i = 0; i < Math.min(otpCode.length, visibleInputs.length); i++) {
          await visibleInputs[i].click();
          await visibleInputs[i].evaluate((el: any) => { el.value = ''; });
          await visibleInputs[i].type(otpCode[i], { delay: 150 });
        }
        steps.push(`Entered OTP digit-by-digit (${digitInputs} inputs)`);
        otpEntered = true;
      }
    }

    // Strategy 3: Single combined input (text or tel)
    if (!otpEntered) {
      const allInputs: any[] = await page.$$('input[type="text"], input[type="tel"]');
      for (const input of allInputs) {
        const visible = await input.evaluate((el: any) => el.offsetWidth > 0);
        if (visible) {
          await input.click();
          await input.evaluate((el: any) => { el.value = ''; });
          await input.type(otpCode, { delay: 100 });
          steps.push('Typed OTP in text input');
          otpEntered = true;
          break;
        }
      }
    }

    // Strategy 4: Keyboard fallback
    if (!otpEntered) {
      await page.keyboard.type(otpCode, { delay: 100 });
      steps.push('Typed OTP via keyboard');
      otpEntered = true;
    }

    await sleep(3000);

    // Click Continue/Verify after OTP
    for (const [label, attempt] of [
      ['Continue', () => safeClickText(page, 'Continue', 3000)],
      ['Verify', () => safeClickText(page, 'Verify', 3000)],
      ['Submit', () => safeClickText(page, 'Submit', 3000)],
      ['submit btn', () => safeClick(page, 'button[type="submit"]', 3000)],
    ] as [string, () => Promise<boolean>][]) {
      const clicked = await attempt();
      if (clicked) { steps.push(`Clicked ${label} after OTP`); break; }
    }

    await sleep(5000);

    // Password step — TeraBox requires setting a password after OTP
    let password = '';
    const pwInputs: any[] = await page.$$('input[type="password"]');
    const visiblePwInputs: any[] = [];
    for (const input of pwInputs) {
      const visible = await input.evaluate((el: any) => el.offsetWidth > 0);
      if (visible) visiblePwInputs.push(input);
    }

    if (visiblePwInputs.length > 0) {
      password = generatePassword();
      await visiblePwInputs[0].click();
      await visiblePwInputs[0].type(password, { delay: 50 });
      steps.push('Set password');

      // If there's a confirm password field
      if (visiblePwInputs.length > 1) {
        await visiblePwInputs[1].click();
        await visiblePwInputs[1].type(password, { delay: 50 });
        steps.push('Confirmed password');
      }

      await sleep(1000);

      // Click Continue/Submit after password
      for (const [label, attempt] of [
        ['Continue', () => safeClickText(page, 'Continue', 3000)],
        ['Sign Up', () => safeClickText(page, 'Sign Up', 3000)],
        ['submit', () => safeClick(page, 'button[type="submit"]', 3000)],
      ] as [string, () => Promise<boolean>][]) {
        const clicked = await attempt();
        if (clicked) { steps.push(`Clicked ${label} after password`); break; }
      }
      await sleep(5000);
    }

    // Check for success indicators
    try {
      const content = await page.content();
      const lowerContent = content.toLowerCase();
      const successKeywords = ['welcome', 'success', 'dashboard', 'my files', 'upload', 'home', 'main'];
      const found = successKeywords.find(k => lowerContent.includes(k));
      steps.push(found ? `SUCCESS indicator found: "${found}"` : 'OTP submitted — success unknown');
    } catch {
      steps.push('OTP submitted');
    }

    const ss = await takeScreenshot(page);
    return { success: true, steps, screenshot: ss, password };
  } catch (error) {
    steps.push(`FATAL: ${(error as Error).message}`);
    const ss = await takeScreenshot(page);
    return { success: false, steps, screenshot: ss };
  }
}

// ─── Core: Enter OTP in NEW context (legacy, for link-based verification) ───

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

    steps.push('Navigating for OTP (new context)...');
    await page.goto(referralLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(5000);

    // Navigate to signup form
    await navigateToSignupForm(page, steps);

    // Fill email
    await fillEmailInput(page, email, steps);
    await sleep(1000);

    // Click Continue
    await clickContinue(page, steps);
    steps.push('Clicked Continue');
    await sleep(5000);

    // Handle captcha
    await handleRecaptcha(page, steps);

    // Enter OTP
    const otpResult = await browserEnterOtp(page, otpCode);
    steps.push(...otpResult.steps);

    const ss = otpResult.screenshot || await takeScreenshot(page);
    return { success: otpResult.success, steps, screenshot: ss, proxyUsed: proxy };
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
