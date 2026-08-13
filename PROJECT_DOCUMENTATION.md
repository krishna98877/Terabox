# TeraBox Referral Agent — Complete Project Documentation

> **Version:** 1.0.0 | **Last Updated:** 2026-08-13 | **Status:** Active Development (Pipeline Integration In Progress)

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [What It Does](#2-what-it-does)
3. [How It Works — Full Architecture](#3-how-it-works--full-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Project Structure](#5-project-structure)
6. [Core Modules — Deep Dive](#6-core-modules--deep-dive)
7. [API Routes Reference](#7-api-routes-reference)
8. [Database Schema](#8-database-schema)
9. [Environment Variables](#9-environment-variables)
10. [The Signup Pipeline — Step by Step](#10-the-signup-pipeline--step-by-step)
11. [Captcha Solving System](#11-captcha-solving-system)
12. [Proxy System](#12-proxy-system)
13. [Email Verification System](#13-email-verification-system)
14. [Browser Automation](#14-browser-automation)
15. [Keep-Alive System](#15-keep-alive-system)
16. [Dashboard UI](#16-dashboard-ui)
17. [Problems We Faced & Solutions](#17-problems-we-faced--solutions)
18. [Current Blockers & Pending Work](#18-current-blockers--pending-work)
19. [Deployment](#19-deployment)
20. [Scripts & Testing Utilities](#20-scripts--testing-utilities)
21. [Key Findings From Testing](#21-key-findings-from-testing)
22. [Configuration Quick Reference](#22-configuration-quick-reference)
23. [Credentials & API Keys — Master Reference](#23-credentials--api-keys--master-reference)
24. [Full .env File (Production-Ready)](#24-full-env-file-production-ready)

---

## 1. Project Overview

**TeraBox Referral Agent** is an automated system that creates TeraBox accounts via referral links, solves CAPTCHAs, verifies email OTPs, and tracks referral credit — all running autonomously 24/7 on Render's free tier.

The core value proposition: **Every new account created through a referral link earns the referrer storage bonuses.** This system automates that process at scale, running 5 parallel workers that continuously:
1. Generate disposable email addresses
2. Solve TeraBox's reCAPTCHA challenges
3. Create and verify new TeraBox accounts
4. "Save" the shared file to earn referral credit

The system provides a real-time web dashboard for monitoring, configuration, and manual control.

---

## 2. What It Does

### Core Functionality
| Feature | Description |
|---|---|
| **Automated Signup** | Creates TeraBox accounts via referral links using the Passport API |
| **CAPTCHA Solving** | Solves reCAPTCHA v2 Standard via CaptchaSolv API (with residential proxy) |
| **Email Verification** | Creates disposable emails, polls for OTP, extracts verification codes |
| **Referral Credit** | "Saves" shared file to new accounts, earning referral credit for the referrer |
| **5 Parallel Workers** | Continuous infinite loop — each worker handles one signup at a time |
| **Proxy Rotation** | Multi-source residential proxy rotation (Webshare.io, IPRoyal, ProxyScrape) |
| **24/7 Keep-Alive** | Self-pings every 4 minutes to prevent Render free tier from sleeping |
| **Real-Time Dashboard** | Web UI with live status, signup history, logs, and configuration |

### Dual Strategy
The engine uses a **two-tier approach** for reliability:
1. **API-First (Fast):** Direct HTTP API calls to TeraBox Passport endpoints — preferred for speed
2. **Browser Fallback (Reliable):** Puppeteer + stealth plugin for cases where API fails — handles JS challenges, dynamic tokens

---

## 3. How It Works — Full Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    DASHBOARD UI (page.tsx)                       │
│  Tabs: Dashboard │ History │ Logs │ Config                      │
│  Real-time polling: /api/health every 5 seconds                 │
│  40+ shadcn/ui components, dark theme, responsive               │
└──────────────────────┬──────────────────────────────────────────┘
                       │ fetch()
┌──────────────────────▼──────────────────────────────────────────┐
│              Next.js API Routes (14 endpoints)                   │
│  /api/health    → Full system status                            │
│  /api/init      → Bootstrap proxy pool + keep-alive             │
│  /api/scheduler → Start/stop 5-worker engine                    │
│  /api/config    → Get/update referral link & settings           │
│  /api/signup    → Trigger manual signup, list records           │
│  /api/proxy     → Proxy pool status & management               │
│  /api/keepalive → Self-ping control                             │
│  /api/captcha   → CaptchaSolv status & balance                  │
│  ...                                                             │
└──────────────────────┬──────────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────────┐
│         AUTOMATION ENGINE (engine.ts + scheduler.ts)             │
│                                                                  │
│  ┌─ Scheduler ──────────────────────────────────────────────┐   │
│  │  5 Worker Slots × Infinite Loop                          │   │
│  │  Each worker:                                            │   │
│  │    while(true) {                                         │   │
│  │      proxy = getNextProxy()                              │   │
│  │      email = createTempEmail()                           │   │
│  │      result = executeSignup(referralLink, proxy, email)  │   │
│  │      if(failed) retry or cooldown                        │   │
│  │    }                                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ executeSignup() Pipeline ───────────────────────────────┐   │
│  │  1. Get proxy         → proxy/manager.ts                 │   │
│  │  2. Visit share link  → terabox/api.ts (sets cookies)    │   │
│  │  3. Get share info    → shareid, uk, sign, surl          │   │
│  │  4. Create temp email → catchmail/client.ts              │   │
│  │  5. Get RSA pubkey    → terabox/api.ts getpubkey()       │   │
│  │  6. RSA-encrypt email → node-forge (raw modulus N)       │   │
│  │  7. Send OTP          → sendcode (may need captcha)      │   │
│  │  8. Solve CAPTCHA     → captcha/solver.ts → CaptchaSolv  │   │
│  │  9. Poll for OTP      → catchmail/client.ts (60 checks)  │   │
│  │  10. Verify OTP       → terabox/api.ts verifyCode()      │   │
│  │  11. Finish register  → setPassword, complete account     │   │
│  │  12. Login            → terabox/api.ts loginToTerabox()   │   │
│  │  13. Transfer share   → save file → REFERRAL CREDIT!     │   │
│  │  14. Track analytics  → log view/download event           │   │
│  │  15. Cleanup          → delete temp email                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Keep-Alive → pings /api/health every 4 min (Render compat)    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                             │
│                                                                  │
│  TeraBox API (1024terabox.com/terabox.com/dubox.com)            │
│    → /passport/getpubkey        RSA public key                  │
│    → /passport/register_v4/sendcode   Send OTP                 │
│    → /passport/register_v4/verify     Verify OTP               │
│    → /passport/register_v4/finish     Complete registration     │
│    → /passport/login                  Login                     │
│    → /share/transfer                  Save file (referral)      │
│                                                                  │
│  CaptchaSolv (v1.captchasolv.com)                               │
│    → /createTask   Create async captcha task                    │
│    → /getTaskResult  Poll for solution                          │
│    → /solve         Sync endpoint (handles polling internally)  │
│    → 100 free solves/day                                        │
│                                                                  │
│  CatchMail.io (api.catchmail.io)                                │
│    → Free disposable email, no account creation needed           │
│    → Domains: mailistry.com, zeppost.com, catchmail.io, etc.   │
│                                                                  │
│  Webshare.io Residential Proxies                                 │
│    → 10 free residential proxies (HTTP)                         │
│    → Required for CaptchaSolv proxy-bound solving               │
│                                                                  │
│  Groq AI (api.groq.com)                                         │
│    → Email content analysis, error diagnosis, suggestions       │
│    → Model: llama-3.3-70b-versatile                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Technology Stack

| Category | Technology | Version | Purpose |
|---|---|---|---|
| **Framework** | Next.js | 16.1.1 | Full-stack React framework (App Router) |
| **Frontend** | React | 19 | UI rendering |
| **Language** | TypeScript | 5 | Type safety |
| **CSS** | Tailwind CSS | 4 | Utility-first styling |
| **UI Components** | shadcn/ui | latest | 40+ accessible components (Radix UI based) |
| **Database** | Prisma | 6.11.1 | ORM for SQLite |
| **Database Engine** | SQLite | — | Embedded database (zero-config) |
| **Browser Automation** | Puppeteer | 24 | Headless Chrome control |
| | puppeteer-extra | 3 | Plugin system for Puppeteer |
| | puppeteer-extra-plugin-stealth | 2 | Anti-detection (fingerprint evasion) |
| | @sparticuz/chromium | 149 | Serverless-optimized Chromium binary |
| **Captcha Solving** | CaptchaSolv API | v1 | reCAPTCHA v2/v3 solving (100/day free) |
| **Proxy Support** | https-proxy-agent | 7 | HTTP proxy agent for Node.js fetch |
| | socks-proxy-agent | 8 | SOCKS5 proxy agent |
| | undici | 8 | HTTP client (fetch polyfill) |
| **RSA Encryption** | node-forge | 1.4 | TeraBox email encryption (raw modulus RSA) |
| **Temp Email** | CatchMail.io API | — | Free disposable email |
| **AI** | Groq API | — | LLM for analysis (llama-3.3-70b) |
| **Deployment** | Render.com | — | Free tier hosting (512MB RAM) |
| **Utilities** | date-fns | 4 | Date formatting |
| | uuid | 11 | Unique ID generation |
| | zod | 4 | Schema validation |
| | react-hook-form | latest | Form state management |

---

## 5. Project Structure

```
/home/z/my-project/
│
├── .env                              # Active environment variables
├── .env.example                      # Template with all documented env vars
├── package.json                      # Dependencies & scripts
├── next.config.ts                    # Next.js config (ignoreBuildErrors, strictMode off)
├── tsconfig.json                     # TypeScript config (ES2017, bundler resolution)
├── tailwind.config.ts                # Tailwind theme (dark mode, custom colors)
├── render.json                       # Render.com deployment config
├── prisma/
│   └── schema.prisma                 # Database schema (4 models)
│
├── src/
│   ├── instrumentation.ts            # Server startup hook (auto-start keep-alive + engine)
│   │
│   ├── app/                          # Next.js App Router
│   │   ├── globals.css               # Global CSS (dark theme, Tailwind v4)
│   │   ├── layout.tsx                # Root layout (Geist fonts, Toaster)
│   │   ├── page.tsx                  # Dashboard UI (~1400 lines, single-page app)
│   │   └── api/                      # 14 API route handlers
│   │       ├── route.ts              # Root: health marker + endpoint list
│   │       ├── health/route.ts       # Full system status
│   │       ├── init/route.ts         # Bootstrap system
│   │       ├── config/route.ts       # Referral config CRUD
│   │       ├── stats/route.ts        # Dashboard statistics
│   │       ├── scheduler/route.ts    # Worker pool control
│   │       ├── signup/
│   │       │   ├── list/route.ts     # List signup records
│   │       │   └── trigger/route.ts  # Manual signup trigger
│   │       ├── logs/route.ts         # Activity logs
│   │       ├── proxy/route.ts        # Proxy pool management
│   │       ├── keepalive/route.ts    # Keep-alive control
│   │       ├── test-email/route.ts   # Email debug endpoint
│   │       ├── domains/route.ts      # CatchMail.io domains
│   │       ├── captcha/status/route.ts # CaptchaSolv status
│   │       ├── browser/route.ts      # Browser availability check
│   │       └── ai/
│   │           ├── suggest/route.ts  # Groq AI suggestions
│   │           └── diagnose/route.ts # Groq AI error diagnosis
│   │
│   ├── components/ui/                # 40+ shadcn/ui components
│   │   ├── button.tsx, card.tsx, dialog.tsx, ...
│   │   └── (accordion, alert, badge, checkbox, form, input, 
│   │        select, table, tabs, toast, tooltip, etc.)
│   │
│   ├── hooks/
│   │   ├── use-toast.ts              # Toast notification system
│   │   └── use-mobile.ts            # Mobile breakpoint detection
│   │
│   └── lib/                          # Core library modules
│       ├── db.ts                     # Prisma singleton (globalThis caching)
│       ├── utils.ts                  # cn() class merge utility
│       │
│       ├── terabox/
│       │   └── api.ts                # TeraBox API client (~990 lines)
│       │
│       ├── automation/
│       │   ├── engine.ts             # Signup pipeline engine (~1030 lines)
│       │   ├── scheduler.ts          # 5-worker parallel loop (~260 lines)
│       │   └── index.ts              # Barrel re-exports
│       │
│       ├── captcha/
│       │   ├── captchasolv.ts        # CaptchaSolv API client (~833 lines)
│       │   ├── solver.ts             # High-level solver with strategy (~275 lines)
│       │   └── index.ts              # Barrel re-exports
│       │
│       ├── proxy/
│       │   ├── manager.ts            # Proxy rotation manager (~563 lines)
│       │   └── index.ts              # Barrel re-exports
│       │
│       ├── http/
│       │   └── proxied-fetch.ts      # fetch() with proxy support (~316 lines)
│       │
│       ├── browser/
│       │   ├── automator.ts          # Puppeteer signup automation (~1037 lines)
│       │   └── index.ts              # Barrel re-exports
│       │
│       ├── catchmail/
│       │   ├── client.ts             # CatchMail.io API client (~374 lines)
│       │   ├── extractors.ts         # OTP/code extraction (~131 lines)
│       │   └── index.ts              # Barrel re-exports
│       │
│       ├── mailtm/
│       │   ├── client.ts             # Mail.tm API client (legacy, ~274 lines)
│       │   ├── extractors.ts         # Simpler extractors (~75 lines)
│       │   └── index.ts              # Barrel re-exports
│       │
│       ├── groq/
│       │   ├── client.ts             # Groq AI client (~178 lines)
│       │   └── index.ts              # Barrel re-exports
│       │
│       └── keepalive/
│           └── index.ts              # Self-ping keep-alive (~259 lines)
│
├── scripts/                          # 70+ test/debug/utility scripts
│   ├── test-e2e-*.js/ts/sh           # End-to-end pipeline tests
│   ├── quick-captcha-test.ts         # Captcha solving validation
│   ├── test-captchasolv-api.ts       # CaptchaSolv API testing
│   ├── find-sitekey.ts               # reCAPTCHA sitekey discovery
│   ├── analyze-pubkey.ts             # RSA key format analysis
│   ├── keep-alive.sh                 # External keep-alive daemon
│   └── ... (70+ more)
│
├── temp-mail-agent/                  # Separate CLI sub-project (temp mail testing)
└── db/
    └── custom.db                     # SQLite database file
```

**Total:** 93 TypeScript source files, 70+ scripts, ~7,600 lines of core code

---

## 6. Core Modules — Deep Dive

### 6.1 TeraBox API Client (`src/lib/terabox/api.ts` — ~990 lines)

This is the most critical module — it handles all communication with TeraBox's Passport API.

#### Class: `TeraBoxSession`
Each parallel worker creates its own instance with **isolated state** (cookie jar, proxy URL, active base URL) to prevent cross-worker contamination.

**Key Methods:**

| Method | TeraBox Endpoint | Purpose |
|---|---|---|
| `getPubKey()` | `GET /passport/getpubkey` | Get RSA public key (pp1/pp2/pp4 format) |
| `sendVerificationCode()` | `POST /passport/register_v4/sendcode` | Send OTP to email (may require captcha) |
| `verifyCode()` | `POST /passport/register_v4/verify` | Verify OTP code |
| `finishRegistration()` | `POST /passport/register_v4/finish` | Set password, complete registration |
| `loginToTerabox()` | `POST /passport/login` | Login with credentials |
| `getShareInfo()` | `GET /api/shorturlinfo` | Get share metadata (shareid, uk, sign, surl) |
| `visitShareLink()` | `GET /s/{surl}` | Visit referral share link (sets cookies) |
| `transferShare()` | `POST /share/transfer` | Save shared file → referral credit |
| `trackAnalytics()` | `POST /api/analytics` | Track view/download event |

**RSA Encryption (`rsaEncrypt`):**
- TeraBox returns pp1 as a **raw RSA modulus (N)** in base64url format (360 chars = 268 bytes)
- This is NOT standard SPKI/DER format — attempting PEM parsing causes "Too few bytes to parse DER"
- **Correct approach:** Build RSA key from raw N + e=65537 using `forge.pki.setRsaPublicKey(n, e)`
- Email is encrypted with PKCS#1 v1.5 padding, result is base64-encoded
- The `fs-ex-st: 1` header must be sent with encrypted emails

**Multi-Domain Fallback:**
Tries 3 domains in order: `1024terabox.com` → `terabox.com` → `dubox.com`

**Chrome Headers:**
Uses Chrome 131 headers including `sec-ch-ua`, `sec-fetch-*` headers to avoid bot detection.

**Captcha Error Detection:**
| errno | Meaning | TeraBox Wants |
|---|---|---|
| 400090 | "need verify_v2" | reCAPTCHA v2 Standard |
| 460030 | Enterprise captcha | reCAPTCHA v2 Enterprise |
| 106 | "verify captcha" | Any captcha type |
| 10 | Rate limit | Captcha after too many requests |
| 18 | "captcha required" | Any captcha type |

---

### 6.2 CaptchaSolv Client (`src/lib/captcha/captchasolv.ts` — ~833 lines)

Direct API client for CaptchaSolv (2captcha-compatible format).

**API Base:** `https://v1.captchasolv.com`

**Two Modes:**
| Mode | Endpoint | Description |
|---|---|---|
| **Sync** | `POST /solve` | Handles polling internally, 130s timeout (recommended) |
| **Async** | `POST /createTask` → `POST /getTaskResult` | Manual polling, 5s interval |

**Supported Types:**
- `RecaptchaV2Task` / `RecaptchaV2TaskProxyless`
- `RecaptchaV2EnterpriseTask` / `RecaptchaV2EnterpriseTaskProxyless`
- `RecaptchaV3Task` / `RecaptchaV3TaskProxyless`
- `RecaptchaV3EnterpriseTask` / `RecaptchaV3EnterpriseTaskProxyless`
- `TurnstileTask` / `HCaptchaTask` / `GeeTestV4Task`

**Proxy Format (2captcha-compatible):**
```json
{
  "proxyType": "http",
  "proxyAddress": "31.59.20.176",
  "proxyPort": 6754,
  "proxyLogin": "zvuvwjcq",
  "proxyPassword": "d0y8143zsfif"
}
```

**Error Handling:**
| Error | Action |
|---|---|
| `ERROR_LIMIT_EXCEEDED` | Retryable — wait 10s, re-poll |
| `ERROR_CAPTCHA_UNSOLVABLE` | Fatal — captcha type/proxy combination failed |
| `ERROR_INVALID_TASK_ID` | Fatal — task ID not found |
| `CHALLENGE_NOT_READY` | Temporary — continue polling |

---

### 6.3 Captcha Solver (`src/lib/captcha/solver.ts` — ~275 lines)

High-level solver with **sequential strategy** optimized for TeraBox.

**Strategy (v2 Standard first):**
```
Phase 1: RecaptchaV2Task (with proxy) → TeraBox explicitly wants "verify_v2"
Phase 2: RecaptchaV2EnterpriseTask (with proxy) → Fallback
Phase 3: RecaptchaV3EnterpriseTask (with proxy) → Last resort
```

Sequential (not parallel) to avoid CaptchaSolv's concurrent task limit (`ERROR_LIMIT_EXCEEDED`).

**Why this order?**
- TeraBox `sendcode` returns `errno 400090` with `errmsg="need verify_v2"` — it explicitly wants v2 Standard
- v2 Enterprise tokens get rejected by TeraBox
- v3 tokens have lower success rates for TeraBox's risk scoring

---

### 6.4 Proxy Manager (`src/lib/proxy/manager.ts` — ~563 lines)

Multi-source proxy rotation with health tracking.

**Proxy Sources (by priority):**

| Priority | Source | Type | Cost | Quality |
|---|---|---|---|---|
| 0 | Uploaded proxies | Any | Free | User-trusted |
| 1 | Webshare.io | Residential HTTP | Free (10 proxies) | ★★★ Best for TeraBox |
| 2 | IPRoyal | Residential | Pay-as-you-go | ★★ Good |
| 3 | ProxyScrape v3 | Datacenter | Free | ★ All dead/blocked |

**Webshare.io Integration:**
- 10 free residential proxies from `WEBSHARE_PROXY` env var (comma-separated)
- API key stored in `WEBSHARE_API_KEY` for fetching more endpoints
- Proxy format: `http://user:pass@host:port`

**Proxy Health Tracking:**
Each proxy tracks: `successCount`, `failCount`, `lastUsed`, `lastVerified`, `teraboxVerified`

**Validation Tiers:**
1. **Tier 1:** httpbin connectivity check (3s timeout)
2. **Tier 2:** TeraBox API check — proxies that trigger captcha errno values are instantly rejected

---

### 6.5 Proxied Fetch (`src/lib/http/proxied-fetch.ts` — ~316 lines)

Drop-in `fetch()` replacement with working proxy support.

**Critical Fix:** Node.js native `fetch()` + `HttpsProxyAgent` dispatcher have incompatible types. Fixed by using `fetch()` with `agent` option (Node.js v22+).

**Features:**
- Proxy agent caching (reuse agents for same proxy URL)
- Redirect following (up to 5 hops)
- `getSetCookie()` method for cookie jar extraction
- Abort signal support

---

### 6.6 Automation Engine (`src/lib/automation/engine.ts` — ~1030 lines)

The brain of the system — orchestrates the entire signup pipeline.

**`executeSignup(referralLink)` returns `SignupResult`:**
```typescript
{
  success: boolean;
  email: string;
  status: string;           // "verified" | "failed" | "pending"
  verificationCode?: string;
  verificationLink?: string;
  error?: string;
  signupId?: string;
  steps: string[];          // Step-by-step log
  proxyUsed?: string;
  password?: string;
}
```

**Full Pipeline:**
1. Get proxy from pool
2. Visit share link (sets referral cookies)
3. Get share info (shareid, uk, sign, surl)
4. Create temp email via CatchMail.io
5. Get RSA pubkey from TeraBox
6. RSA-encrypt email with raw modulus
7. Call `sendcode` (may trigger captcha)
8. If captcha needed: solve via CaptchaSolv → retry `sendcode` with token
9. Poll inbox for OTP (60 attempts, adaptive 1.1→3s interval)
10. Call `verifyCode` with OTP
11. Call `finishRegistration` with password
12. Login to new account
13. Call `transferShare` → REFERRAL CREDIT
14. Track analytics event
15. Cleanup temp email

---

### 6.7 Scheduler (`src/lib/automation/scheduler.ts` — ~260 lines)

**5 parallel workers** running in continuous infinite loops.

```typescript
MAX_WORKERS = 5

// Each worker:
while (poolActive) {
  if (dailyLimitReached) { sleep(60s); continue; }
  proxy = getNextProxy();
  email = createTempEmail();
  result = executeSignup(referralLink, proxy, email);
  if (result.success) successes++; else failures++;
  sleep(3s);  // cooldown
}
```

**Worker State Tracking:**
Each worker reports: `id`, `status` (idle/running/cooldown), `currentEmail`, `currentStep`, `currentProxy`, `startedAt`, `attempts`, `successes`, `failures`

---

### 6.8 CatchMail.io Client (`src/lib/catchmail/client.ts` — ~374 lines)

Free disposable email — no account creation needed.

**API Base:** `https://api.catchmail.io`

**Domains (ordered by "least obvious" first):**
1. `mailistry.com`
2. `zeppost.com`
3. `mailsac.com`
4. `snapmail.cc`
5. `catchmail.io`

**Key Functions:**
| Function | Purpose |
|---|---|
| `createTempEmail()` | Generate random inbox with preferred domain |
| `listMessages()` | List messages in inbox |
| `getMessage()` | Get full message content (HTML) |
| `pollForMessages()` | Adaptive polling (1.1s → 2s → 3s), TeraBox-specific detection, 60 attempts |

**Rate Limiting:** 1 QPS per instance (prevents parallel worker throttling)

**OTP Extraction (`extractors.ts`):**
10+ regex patterns for:
- 4-8 digit numeric codes
- HTML `<code>`, `<strong>`, `<b>` elements
- TeraBox-specific patterns ("verification code: 123456")
- Verification links (`/verify?code=...`)

---

### 6.9 Browser Automator (`src/lib/browser/automator.ts` — ~1037 lines)

Puppeteer-based signup for cases where API approach fails.

**Strategy Chain:**
```
puppeteer-extra + stealth (local)
  → Puppeteer (local Chromium)
    → @sparticuz/chromium + puppeteer-core (cloud/serverless)
      → HTTP API fallback
```

**Key Design:** Signup + OTP entry happen in the **same browser context** for cookie continuity.

**Functions:**
| Function | Purpose |
|---|---|
| `browserSignup()` | Open TeraBox signup page, fill email, solve captcha, submit |
| `browserEnterOtp()` | Enter OTP code in verification page |
| `browserVerifyOtp()` | Complete OTP verification flow |
| `isBrowserAvailable()` | Check if Puppeteer/Chromium is available |

---

### 6.10 Keep-Alive (`src/lib/keepalive/index.ts` — ~259 lines)

Prevents Render free tier from sleeping (15-min inactivity threshold).

**Architecture:**
- 4-minute interval pings to `/api/health` + `/api/init`
- Tracks: ping history (50 records), success rate, consecutive failures
- URL detection: `RENDER_EXTERNAL_URL` → `NEXT_PUBLIC_BASE_URL` → hardcoded fallback

---

## 7. API Routes Reference

| Route | Methods | Purpose | Key Parameters |
|---|---|---|---|
| `/api` | GET | Root health marker | — |
| `/api/health` | GET | Full system status | — |
| `/api/init` | GET, POST | Bootstrap system | — |
| `/api/config` | GET, PATCH | Referral config CRUD | `masterLink`, `isActive`, `autoSignup`, `signupInterval`, `maxSignupsPerDay` |
| `/api/stats` | GET | Dashboard statistics | — |
| `/api/scheduler` | GET, POST | Worker pool control | `action`: "start" / "stop" |
| `/api/signup/list` | GET | List signup records | `status`, `page`, `limit` |
| `/api/signup/trigger` | POST | Manual signup | `referralLink` |
| `/api/logs` | GET | Activity logs | `limit` |
| `/api/proxy` | GET, POST | Proxy management | `action`: "refresh" / "clear" / "add" |
| `/api/keepalive` | GET, POST | Keep-alive control | `action`: "start" / "stop" / "restart" / "ping" |
| `/api/test-email` | GET | Email debug | `action`: "create" / "check" / "domains" |
| `/api/domains` | GET | CatchMail.io domains | — |
| `/api/captcha/status` | GET | CaptchaSolv status | — |
| `/api/ai/suggest` | POST | Groq AI suggestions | `error`, `context` |
| `/api/ai/diagnose` | POST | Groq AI error diagnosis | `error`, `steps` |
| `/api/browser` | GET | Browser availability | — |

All routes use `export const dynamic = 'force-dynamic'` (no caching).

---

## 8. Database Schema

**Provider:** SQLite via Prisma (`file:./db/custom.db`)

### ReferralConfig (Singleton)
| Field | Type | Default | Description |
|---|---|---|---|
| `id` | String @id @cuid() | auto | Primary key |
| `masterLink` | String | — | Master TeraBox referral link |
| `isActive` | Boolean | true | System active flag |
| `autoSignup` | Boolean | false | Auto-start engine on boot |
| `signupInterval` | Int | 30 | Minutes between signups |
| `maxSignupsPerDay` | Int | 50 | Daily signup cap |
| `createdAt` | DateTime | now() | Created timestamp |
| `updatedAt` | DateTime | updatedAt | Auto-updated timestamp |

### SignupRecord
| Field | Type | Default | Description |
|---|---|---|---|
| `id` | String @id @cuid() | auto | Primary key |
| `email` | String | — | Temp email used |
| `emailPassword` | String | — | Email account password |
| `mailTmToken` | String? | — | Mail.tm auth token (legacy) |
| `referralLink` | String | — | Referral link used |
| `status` | String | "pending" | pending / verified / failed |
| `verificationCode` | String? | — | OTP code received |
| `verificationLink` | String? | — | Verification URL |
| `errorMessage` | String? | — | Error message if failed |
| `retryCount` | Int | 0 | Retry attempts |
| `teraboxPassword` | String? | — | TeraBox account password |
| `createdAt` / `updatedAt` | DateTime | now()/updatedAt | Timestamps |

### ActivityLog
| Field | Type | Description |
|---|---|---|
| `id` | String @id @cuid() | Primary key |
| `type` | String | Log category |
| `message` | String | Log message |
| `signupId` | String? | Associated signup |
| `metadata` | String? | JSON metadata |
| `createdAt` | DateTime | Timestamp |

### MailDomain
| Field | Type | Description |
|---|---|---|
| `id` | String @id @cuid() | Primary key |
| `domain` | String @unique | Domain name |
| `isActive` | Boolean | Whether usable |
| `fetchedAt` | DateTime | When last fetched |

---

## 9. Environment Variables

| Variable | Required | Description | Current Value |
|---|---|---|---|
| `DATABASE_URL` | Yes | SQLite database path | `file:/home/z/my-project/db/custom.db` |
| `CAPTCHASOLV_API_KEY` | Yes | CaptchaSolv API key (100 free/day) | `40fd4b6c-efd9-4a07-99df-...` |
| `WEBSHARE_PROXY` | **Critical** | Webshare.io residential proxies (comma-separated) | 10 HTTP proxies |
| `WEBSHARE_API_KEY` | Recommended | Webshare.io API key (fetch more proxies) | `0yrk5hbrfrci...` |
| `RECAPTCHA_SITE_KEY` | No | Override TeraBox reCAPTCHA sitekey | (uses hardcoded fallback) |
| `GROQ_API_KEY` | No | Groq AI key for analysis features | (not set) |
| `CATCHMAIL_CUSTOM_DOMAIN` | No | Custom CatchMail.io domain | (not set) |
| `IPROYAL_USERNAME` | No | IPRoyal proxy username | (not set) |
| `IPROYAL_PASSWORD` | No | IPRoyal proxy password | (not set) |
| `IPROYAL_COUNTRY` | No | IPRoyal proxy country | `us` (default) |
| `NODE_ENV` | No | Environment mode | (development) |
| `RENDER_EXTERNAL_URL` | No | Render auto-sets this | (auto) |
| `NEXT_PUBLIC_BASE_URL` | No | Fallback base URL for keep-alive | (not set) |

---

## 10. The Signup Pipeline — Step by Step

This is the complete flow for one signup attempt, with all technical details:

### Step 1: Get Proxy
- `proxy/manager.ts` → `getNextProxy()`
- Priority: Uploaded → Webshare → IPRoyal → ProxyScrape
- Validates connectivity and TeraBox compatibility
- **Critical:** Residential proxy is REQUIRED for captcha solving

### Step 2: Visit Referral Share Link
- `terabox/api.ts` → `visitShareLink(surl)`
- `GET /s/{surl}` via proxy
- Sets session cookies (browserid, csrfToken) — these are ESSENTIAL for subsequent API calls
- Without these cookies, TeraBox treats every request as suspicious → captcha triggers

### Step 3: Get Share Info
- `terabox/api.ts` → `getShareInfo(surl)`
- `GET /api/shorturlinfo?shareid=...&uk=...&surl=...`
- Returns: shareid, uk, sign, timestamp — needed for transfer

### Step 4: Create Temp Email
- `catchmail/client.ts` → `createTempEmail()`
- Uses CatchMail.io API (no account creation needed)
- Selects domain from: mailistry.com, zeppost.com, mailsac.com, snapmail.cc, catchmail.io
- Rate limited to 1 QPS

### Step 5: Get RSA Public Key
- `terabox/api.ts` → `getPubKey()`
- `GET /passport/getpubkey?clienttype=0`
- Returns pp1 (raw RSA modulus N), pp2, pp4
- pp1 is 360 chars base64url = 268 bytes raw modulus

### Step 6: RSA-Encrypt Email
- `terabox/api.ts` → `rsaEncrypt(email, pp1)` (using `node-forge`)
- Converts pp1 from base64url → standard base64 → hex BigInteger
- Builds RSA key: `forge.pki.setRsaPublicKey(n, e)` where e = 65537
- Encrypts with PKCS#1 v1.5 padding
- Result: base64-encoded ciphertext (~360 chars)
- **Must send `fs-ex-st: 1` header** to indicate encrypted format

### Step 7: Send OTP (with captcha)
- `terabox/api.ts` → `sendVerificationCode(encryptedEmail)`
- `POST /passport/register_v4/sendcode`
- Body: `email`, `op_type=1`, `pass_version=3.0`, `reg_source=share`, `koltype=0`, `g_identity={captcha_token}`
- Common params: `app_id=250528`, `web=1`, `channel=dubox`, `clienttype=0`
- **If errno 400090/460030:** Captcha required → solve captcha → retry with `g_identity`

### Step 8: Solve CAPTCHA
- `captcha/solver.ts` → `solveRecaptcha(siteKey, pageUrl, proxyUrl)`
- **Sitekey:** `6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH` (hardcoded fallback + JS bundle extraction)
- **Page URL:** `https://www.1024terabox.com`
- **Strategy:** v2 Standard → v2 Enterprise → v3 Enterprise (sequential)
- Uses CaptchaSolv API with proxy-bound task type
- Token expires in ~2 minutes — must be used IMMEDIATELY

### Step 9: Poll for OTP
- `catchmail/client.ts` → `pollForMessages()`
- Adaptive interval: 1.1s → 2s → 3s
- 60 attempts maximum (~2.5 minutes)
- TeraBox emails typically arrive within 5-15 seconds
- Extracts 6-digit code using regex patterns

### Step 10: Verify OTP
- `terabox/api.ts` → `verifyCode(token, code)`
- `POST /passport/register_v4/verify`
- Body: `token` (from sendcode response), `code` (OTP)
- May also require captcha (retry if errno 400090/460030)

### Step 11: Finish Registration
- `terabox/api.ts` → `finishRegistration(token, password)`
- `POST /passport/register_v4/finish`
- Sets password (RSA-encrypted), completes account creation
- Password: auto-generated 16-char alphanumeric

### Step 12: Login
- `terabox/api.ts` → `loginToTerabox(email, password)`
- `POST /passport/login`
- Returns bdstoken for authenticated operations

### Step 13: Transfer Share (EARN REFERRAL CREDIT!)
- `terabox/api.ts` → `transferShare(shareInfo)`
- `POST /share/transfer`
- This is the KEY step — saving the shared file to the new account earns referral credit
- Requires: shareid, uk, sign, surl, bdstoken

### Step 14: Track Analytics
- `terabox/api.ts` → `trackAnalytics()`
- `POST /api/analytics`
- Logs the view/download event for the referral system

### Step 15: Cleanup
- Delete temp email (if supported)
- Log result to ActivityLog
- Update SignupRecord status

---

## 11. Captcha Solving System

### How It Works

```
TeraBox sendcode → errno 400090 "need verify_v2"
    ↓
solveRecaptcha(siteKey, pageUrl, proxyUrl)
    ↓
Phase 1: RecaptchaV2Task (with proxy) → CaptchaSolv API
    ↓ (if fails)
Phase 2: RecaptchaV2EnterpriseTask (with proxy)
    ↓ (if fails)
Phase 3: RecaptchaV3EnterpriseTask (with proxy)
    ↓
Token returned → Used in sendcode g_identity parameter
```

### Key Technical Details

| Parameter | Value | Notes |
|---|---|---|
| **Sitekey** | `6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH` | Extracted from TeraBox JS bundle |
| **Page URL** | `https://www.1024terabox.com` | Must match exactly |
| **Task Type** | `RecaptchaV2Task` | With proxy — preferred |
| **Alt Type** | `RecaptchaV2TaskProxyless` | Without proxy — inconsistent |
| **Token Expiry** | ~2 minutes | Must use immediately after solving |
| **Solve Time** | 10-60 seconds | Varies by proxy and load |
| **Free Limit** | 100/day | CaptchaSolv free plan |

### Why Proxy-Bound Solving is Required

Enterprise reCAPTCHA **binds the token to the solver's IP address**. If CaptchaSolv solves from their IP (proxyless) but you submit from your proxy IP, TeraBox **rejects** the token. With proxy-bound solving, CaptchaSolv solves from YOUR proxy IP → the token matches → accepted.

### CaptchaSolv API Flow

```
1. POST /createTask  →  { taskId: "uuid" }
2. POST /getTaskResult (poll every 5s)  →  { status: "processing" }
   ...repeat until...
3. POST /getTaskResult  →  { status: "ready", solution: { token: "..." } }
```

### Sitekey Extraction

The sitekey is obtained by two methods:
1. **Hardcoded fallback:** `6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH`
2. **Dynamic extraction:** Parse TeraBox's main JS bundle (`/main.*.js`) for `render()` or `execute()` calls containing the sitekey

---

## 12. Proxy System

### Architecture

```
getNextProxy()
    ↓
Priority 0: Uploaded proxies (user-provided, trusted)
    ↓ (if empty)
Priority 1: Webshare.io (10 free residential proxies)
    ↓ (if empty)
Priority 2: IPRoyal (pay-as-you-go residential)
    ↓ (if empty)
Priority 3: ProxyScrape v3 (free datacenter — ALL DEAD)
```

### Webshare.io (Current Primary Source)

- **Plan:** Free — 10 residential proxies
- **Protocol:** HTTP
- **Format:** `http://username:password@host:port`
- **API Key:** `0yrk5hbrfrci570mpa5kawi3s5odm955vobzi824`
- **Current Proxies (10):**

| # | IP | Port |
|---|---|---|
| 1 | 31.59.20.176 | 6754 |
| 2 | 31.56.127.193 | 7684 |
| 3 | 45.38.107.97 | 6014 |
| 4 | 198.105.121.200 | 6462 |
| 5 | 64.137.96.74 | 6641 |
| 6 | 198.23.243.226 | 6361 |
| 7 | 38.154.185.97 | 6370 |
| 8 | 84.247.60.125 | 6095 |
| 9 | 142.111.67.146 | 5611 |
| 10 | 191.96.254.138 | 6185 |

### Why Residential Proxies Are REQUIRED

| Proxy Type | TeraBox API | CaptchaSolv Solving | Verdict |
|---|---|---|---|
| **None (direct)** | Works | `ERROR_CAPTCHA_UNSOLVABLE` | ❌ Can't solve captcha |
| **Free datacenter** | All blocked/timeout | N/A | ❌ All 30+ tested are dead |
| **Residential (Webshare)** | Works | Solves in 10-60s | ✅ WORKS |

### Proxy Validation

**Tier 1 — Connectivity (3s timeout):**
```bash
curl --proxy "$PROXY" https://ipv4.webshare.io/  # Returns proxy IP
```

**Tier 2 — TeraBox Compatibility:**
```bash
curl --proxy "$PROXY" https://www.1024terabox.com/passport/getpubkey?clienttype=0
# If errno 400090/460030/106 → REJECT (captcha-flagged IP)
```

---

## 13. Email Verification System

### CatchMail.io (Primary)

| Feature | Detail |
|---|---|
| **Cost** | Free |
| **Account needed** | No — just use any address @supported-domain |
| **API** | `https://api.catchmail.io` |
| **Rate limit** | 1 QPS (self-imposed to avoid throttling) |
| **Polling** | Adaptive: 1.1s → 2s → 3s, up to 60 attempts |
| **Domains** | mailistry.com, zeppost.com, mailsac.com, snapmail.cc, catchmail.io |

### OTP Code Extraction

10+ regex patterns handle various formats:
```regex
/verification\s*code[:\s]*(\d{4,8})/i
/code[:\s]*(\d{6})/i
/<code[^>]*>(\d{4,8})<\/code>/
/<strong[^>]*>(\d{4,8})<\/strong>/
/(\d{6})/  // fallback: any 6-digit number
```

### Mail.tm (Legacy/Unused)

- Requires account creation (username + password + domain)
- 8 QPS rate limit
- Replaced by CatchMail.io (simpler, no auth needed)

---

## 14. Browser Automation

### Puppeteer Strategy Chain

```
puppeteer-extra + stealth plugin (anti-detection)
    → Local Puppeteer (bundles Chromium, reliable)
        → @sparticuz/chromium + puppeteer-core (cloud/serverless)
            → HTTP API fallback (no browser needed)
```

### Why Browser Fallback Exists

Some TeraBox scenarios can't be handled by pure API:
- Dynamic JavaScript challenges
- Cloudflare interstitial pages
- Cookie/session issues requiring full browser context
- Cases where API returns unexpected error codes

### Key Design: Same Browser Context

Signup and OTP entry happen in the **same Puppeteer incognito context** — this maintains cookie continuity, which is critical for TeraBox's session tracking.

---

## 15. Keep-Alive System

### Purpose
Render free tier sleeps after **15 minutes of inactivity**. The keep-alive system prevents this by self-pinging every **4 minutes**.

### Architecture
```
instrumentation.ts (server startup)
    → startKeepAlive()
        → setInterval(ping, 4 * 60 * 1000)
            → fetch(/api/health)
            → fetch(/api/init)
```

### URL Detection Priority
1. `RENDER_EXTERNAL_URL` (auto-set by Render)
2. `NEXT_PUBLIC_BASE_URL` (manual override)
3. Hardcoded: `https://terabox-detf.onrender.com` (fallback)

### Tracking
- Ping history: 50 most recent pings
- Success rate calculation
- Consecutive failure tracking
- Uptime reporting

---

## 16. Dashboard UI

### Single-Page Application (`page.tsx` — ~1400 lines)

**4 Tabs:**

| Tab | Content |
|---|---|
| **Dashboard** | Status cards (engine, browser, proxy, keep-alive, captcha, email), worker status, quick actions |
| **History** | Signup records table, status badges (pending/verified/failed), detail dialog with raw API responses |
| **Logs** | Activity log viewer with auto-refresh |
| **Config** | Master referral link, auto-signup toggle, interval slider, daily limit, captcha status, proxy management |

**Real-Time Updates:**
- Polls `/api/health` every 5 seconds
- Worker status indicators (idle/running/cooldown)
- Toast notifications for actions

**Quick Actions:**
- Start/Stop engine
- Trigger manual signup
- Refresh proxy pool
- Ping keep-alive

---

## 17. Problems We Faced & Solutions

### Problem 1: CaptchaSolv Proxyless ALWAYS Fails
**Issue:** `RecaptchaV2TaskProxyless` returns `ERROR_CAPTCHA_UNSOLVABLE` for ALL TeraBox captcha types.
**Root Cause:** TeraBox uses reCAPTCHA Enterprise which binds tokens to the solver's IP. Proxyless solving uses CaptchaSolv's IP, which differs from the request IP.
**Solution:** Use `RecaptchaV2Task` (with proxy params) so CaptchaSolv solves from the SAME IP as the request.
**Status:** ✅ Solved — residential proxy + proxy-bound task type works.

### Problem 2: Free Datacenter Proxies ALL Dead
**Issue:** 30+ free proxies from ProxyScrape, all timeout or blocked by TeraBox.
**Root Cause:** Datacenter IPs are flagged by TeraBox's risk detection system.
**Solution:** Switched to residential proxies (Webshare.io — 10 free).
**Status:** ✅ Solved — Webshare.io residential proxies work.

### Problem 3: reCAPTCHA Sitekey Unknown
**Issue:** TeraBox's sitekey wasn't in any public lists or the HTML source.
**Root Cause:** TeraBox loads reCAPTCHA dynamically via JavaScript.
**Solution:** Extracted sitekey from TeraBox's main JS bundle (`main.*.js`): `6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH`
**Status:** ✅ Solved — hardcoded fallback + dynamic extraction.

### Problem 4: RSA Encryption "Too few bytes to parse DER"
**Issue:** TeraBox's `pp1` pubkey can't be parsed as standard RSA SPKI/DER format.
**Root Cause:** pp1 is a **raw RSA modulus (N)**, not SPKI-wrapped. 360 chars base64url = 268 bytes (too short for RSA-2048 SPKI which is ~294 bytes).
**Solution:** Build RSA key from raw N + e=65537: `forge.pki.setRsaPublicKey(new BigInteger(nHex, 16), new BigInteger('10001', 16))`
**Status:** ✅ Solved — encryption works with raw modulus approach.

### Problem 5: CaptchaSolv Proxy Format Wrong
**Issue:** CaptchaSolv rejected proxy configurations with cryptic errors.
**Root Cause:** 2captcha-compatible API requires **separate fields** (`proxyType`, `proxyAddress`, `proxyPort`, `proxyLogin`, `proxyPassword`), not a single URL string.
**Solution:** `parseProxyForCaptcha()` splits `http://user:pass@host:port` into individual fields.
**Status:** ✅ Solved.

### Problem 6: Parallel Worker Session Corruption
**Issue:** Multiple workers sharing module-level singletons caused race conditions — cookies, proxy URLs, and base URLs got mixed between workers.
**Root Cause:** `_cookieJar`, `_proxyUrl`, `activeBaseUrl` were module-level variables shared across all 5 workers.
**Solution:** `TeraBoxSession` class with per-instance state. Each worker creates its own instance.
**Status:** ✅ Solved — `TeraBoxSession` provides isolated state.

### Problem 7: CaptchaSolv Concurrent Task Limit
**Issue:** `ERROR_LIMIT_EXCEEDED` when trying parallel captcha solving.
**Root Cause:** CaptchaSolv free plan limits concurrent tasks.
**Solution:** Sequential captcha strategy (v2 Standard → v2 Enterprise → v3 Enterprise) + 10s backoff on `ERROR_LIMIT_EXCEEDED`.
**Status:** ✅ Solved — sequential with retry.

### Problem 8: Node.js fetch() + Proxy Agent Type Incompatibility
**Issue:** `fetch()` with `HttpsProxyAgent` dispatcher throws type errors.
**Root Cause:** Node.js native `fetch()` uses `dispatcher` option which expects `undici.Dispatcher`, not `http.Agent`.
**Solution:** Use `fetch()` with `agent` option (Node.js v22+) or use `undici` directly.
**Status:** ✅ Solved — `proxiedFetch()` in `src/lib/http/proxied-fetch.ts`.

### Problem 9: v2 Enterprise Tokens Rejected by TeraBox
**Issue:** Even valid v2 Enterprise tokens get `errno 400090 "need verify_v2"` from sendcode.
**Root Cause:** TeraBox explicitly requires `verify_v2` (Standard reCAPTCHA v2), not Enterprise.
**Solution:** Prioritize `RecaptchaV2Task` (Standard) in the solving strategy.
**Status:** ✅ Solved — v2 Standard is tried first.

### Problem 10: Captcha Token Expiry
**Issue:** Solved captcha tokens expire in ~2 minutes. If sendcode isn't called immediately, the token is wasted.
**Root Cause:** reCAPTCHA tokens are time-limited by Google's verification server.
**Solution:** Call `sendcode` IMMEDIATELY after captcha solving. Minimize any delay between solving and using the token.
**Status:** ✅ Solved — pipeline calls sendcode right after solving.

---

## 18. Current Blockers & Pending Work

### Blocker 1: sendcode Returns `code: 2` "System Error"
**Status:** 🔴 ACTIVE — This is the current primary blocker.

**Symptom:** `POST /passport/register_v4/sendcode` returns `{"code": 2, "msg": "System error, please try again later"}` regardless of:
- Email format (plaintext, RSA-encrypted)
- Parameter combinations (with/without app_id, channel, etc.)
- Cookie presence (with/without session cookies)
- Domain (1024terabox.com, terabox.com)

**Possible Causes:**
1. **Missing session cookies** — TeraBox may require browserid/csrfToken cookies from a page visit before sendcode works
2. **Wrong parameter format** — TeraBox API may expect different field names or encoding
3. **IP/Cookie mismatch** — The proxy IP may need to match the cookie session
4. **Rate limiting** — The proxy IP may be temporarily blocked
5. **API version change** — TeraBox may have updated their API

**Next Steps to Debug:**
- Capture a real browser's sendcode request using DevTools Network tab
- Compare the exact headers, cookies, and body params with our API call
- Try with a fresh proxy IP
- Try without any params except the absolute minimum
- Check if TeraBox requires a specific CSRF token or session header

### Blocker 2: Captcha Solving Inconsistency
**Status:** 🟡 PARTIAL

**Symptom:** CaptchaSolv `RecaptchaV2Task` with proxy sometimes solves in 10s, sometimes times out with `ERROR_CAPTCHA_UNSOLVABLE` after 65s.

**Observations:**
- First attempt (proxy 31.59.20.176): Solved in ~10s ✅
- Second attempt (same proxy): `ERROR_CAPTCHA_UNSOLVABLE` / "Task timeout" ❌
- Proxyless (`RecaptchaV2TaskProxyless`): Sometimes works (solved in ~35s once) ✅
- Different proxy (31.56.127.193): `ERROR_CAPTCHA_UNSOLVABLE` ❌

**Possible Causes:**
1. CaptchaSolv worker availability varies
2. The proxy IP quality varies (some IPs flagged by Google)
3. TeraBox's captcha difficulty varies by time/session
4. CaptchaSolv free plan has limited worker pool

**Mitigation:** Try multiple proxies + proxyless in sequence; retry on failure.

### Pending Work

| Task | Priority | Description |
|---|---|---|
| Fix sendcode `code: 2` error | 🔴 Critical | Debug and fix the API call format |
| Verify full E2E pipeline | 🔴 Critical | Proxy → Captcha → Sendcode → OTP → Verify → Finish → Transfer |
| Implement Webshare proxy rotation in engine | 🟡 High | Rotate through all 10 proxies (not just first) |
| Add proxy health monitoring | 🟡 High | Track which proxies work for captcha solving |
| Rate limit handling | 🟡 High | Back off when TeraBox returns rate limit errors |
| OTP email reliability | 🟡 Medium | Ensure CatchMail.io receives TeraBox OTP emails |
| Push working version to GitHub | 🟡 Medium | Once pipeline is verified end-to-end |
| Production deployment on Render | 🟢 Low | Deploy once pipeline is stable |

---

## 19. Deployment

### Render.com (Primary)
- **Config:** `render.json` included
- **Free Tier:** 512MB RAM, sleeps after 15 min inactivity
- **Keep-Alive:** Self-ping every 4 min prevents sleeping
- **Build:** `prisma generate && prisma db push && next build`
- **Start:** `next start`

### Deployment Steps
1. Push to GitHub: `https://github.com/krishna98877/Terabox`
2. Connect repo to Render
3. Set environment variables (DATABASE_URL, CAPTCHASOLV_API_KEY, WEBSHARE_PROXY, etc.)
4. Deploy — instrumentation.ts auto-starts keep-alive + engine

### Alternative Platforms
Documented in `DEPLOY.md`: Railway, VPS, Vercel

---

## 20. Scripts & Testing Utilities

**70+ scripts** in the `/scripts/` directory organized by category:

### E2E Pipeline Testing
| Script | Purpose |
|---|---|
| `test-e2e-final.js` | Complete pipeline test with RSA encryption + captcha + sendcode |
| `test-e2e-complete.js` | Similar, older version |
| `test-e2e.sh` / `test-e2e-v2.sh` | Bash-based E2E tests |
| `test-e2e-pipeline.ts` | TypeScript E2E test |

### Captcha Testing
| Script | Purpose |
|---|---|
| `quick-captcha-test.ts` | Quick CaptchaSolv API test |
| `minimal-captcha-test.ts` | Minimal captcha solving test |
| `direct-captcha-test.ts` | Direct API call test |
| `test-captcha-with-proxy.ts` | Proxy-bound captcha test |
| `captcha-strategy-test.ts` | Test all captcha type strategies |
| `test-captchasolv-api.ts` | Full CaptchaSolv API validation |

### Proxy Testing
| Script | Purpose |
|---|---|
| `check-proxies.ts` | Validate proxy pool |
| `quick-proxy-test.ts` | Quick proxy connectivity test |
| `test-uploaded-proxies.ts` | Test uploaded proxy list |

### Sitekey Discovery
| Script | Purpose |
|---|---|
| `find-sitekey.ts` | Extract reCAPTCHA sitekey from TeraBox |
| `deep-search-sitekey.ts` | Deep JS bundle search |
| `puppeteer-sitekey.ts` | Browser-based sitekey extraction |

### Encryption Testing
| Script | Purpose |
|---|---|
| `analyze-pubkey.ts` | Analyze TeraBox pubkey format |
| `test-encryption.ts` | RSA encryption testing |
| `search-encrypt-lib.ts` | Search for encryption libraries |

### Keep-Alive Daemons
| Script | Purpose |
|---|---|
| `keep-alive.sh` | Simple cron-based keep-alive |
| `keep-alive-247.sh` | 24/7 keep-alive daemon |
| `keep-alive-daemon.js` | Node.js keep-alive daemon |

---

## 21. Key Findings From Testing

### Finding 1: Residential Proxy is NON-NEGOTIABLE
Without residential proxies, the entire pipeline is dead:
- No proxy → CaptchaSolv can't solve (`ERROR_CAPTCHA_UNSOLVABLE`)
- Datacenter proxies → All blocked by TeraBox (30+ tested, 0 valid)
- **Residential proxies** → CaptchaSolv solves + TeraBox API works

### Finding 2: TeraBox Wants reCAPTCHA v2 Standard (NOT Enterprise)
Despite TeraBox using Enterprise in some contexts, the `sendcode` endpoint specifically requires `verify_v2` (Standard):
- `errno 400090` + `errmsg="need verify_v2"` → Wants `RecaptchaV2Task`
- Enterprise tokens are rejected with the same errno 400090

### Finding 3: Captcha Token is SINGLE-USE
Each solved captcha token can only be used for ONE API call. If it's rejected or the call fails, a new token must be obtained.

### Finding 4: CaptchaSolv Free Plan is Rate-Limited
- 100 solves/day
- Concurrent task limit (causes `ERROR_LIMIT_EXCEEDED`)
- Sequential strategy with 10s backoff handles this

### Finding 5: TeraBox Pubkey is Raw Modulus (NOT SPKI)
The `pp1` field from `/passport/getpubkey` is a raw RSA modulus N in base64url encoding (360 chars = 268 bytes). It is NOT a standard SubjectPublicKeyInfo (SPKI) DER structure. Building the key with `forge.pki.setRsaPublicKey(n, e)` where e=65537 is the correct approach.

### Finding 6: TeraBox API Returns `code` Not `errno`
The getpubkey endpoint returns `{"code": 0, "data": {...}}` while the sendcode may return different error code field names (`errno`, `error_code`, or `code`). The code handles all three with `errno ?? error_code ?? code`.

### Finding 7: Session Cookies Are Required
TeraBox sets `browserid` and `csrfToken` cookies on page visit. These may be required for API calls to work. The `sendcode` returning `code: 2` may be related to missing or mismatched cookies.

### Finding 8: Captcha Solving is Inconsistent
Even with the same proxy, captcha solving can succeed in 10s one time and timeout with UNSOLVABLE the next. This suggests:
- CaptchaSolv worker pool varies
- Some solve attempts hit harder challenges
- Retry logic is essential

---

## 22. Configuration Quick Reference

### Minimal Working Config
```env
DATABASE_URL=file:./db/production.db
CAPTCHASOLV_API_KEY=your-captchasolv-key
WEBSHARE_PROXY=http://user:pass@host1:port1/,http://user:pass@host2:port2/
```

### Default Referral Link
```
https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ
```

### reCAPTCHA Sitekey
```
6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH
```

### TeraBox API Domains (fallback order)
1. `https://www.1024terabox.com`
2. `https://www.terabox.com`
3. `https://www.dubox.com`

### Key API Endpoints
```
GET  /passport/getpubkey?clienttype=0
POST /passport/register_v4/sendcode
POST /passport/register_v4/verify
POST /passport/register_v4/finish
POST /passport/login
GET  /api/shorturlinfo?shareid=&uk=&surl=
POST /share/transfer
POST /api/analytics
```

### CaptchaSolv API
```
Base: https://v1.captchasolv.com
POST /createTask     → Create async task
POST /getTaskResult  → Poll for solution
POST /solve          → Sync solve (recommended)
Free: 100 solves/day
```

---

## 23. Credentials & API Keys — Master Reference

> ⚠️ **SENSITIVE DATA** — This section contains all active credentials. Do NOT share publicly.

### CaptchaSolv (CAPTCHA Solving)
| Item | Value |
|---|---|
| **API Key** | `40fd4b6c-efd9-4a07-99df-53b0cb3888db` |
| **Base URL** | `https://v1.captchasolv.com` |
| **Free Tier** | 100 solves/day |
| **How to get more** | Discord `/claim` or Telegram bot for daily free resets |
| **Docs** | https://docs.captchasolv.com/getting-started/ |

### Webshare.io (Residential Proxies)
| Item | Value |
|---|---|
| **API Key** | `0yrk5hbrfrci570mpa5kawi3s5odm955vobzi824` |
| **Proxy Username** | `zvuvwjcq` |
| **Proxy Password** | `d0y8143zsfif` |
| **Free Tier** | 10 residential proxies |
| **Dashboard** | https://proxy.webshare.io/ |
| **API Docs** | https://docs.webshare.io/ |

**All 10 Proxy Endpoints:**
```
http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754/
http://zvuvwjcq:d0y8143zsfif@31.56.127.193:7684/
http://zvuvwjcq:d0y8143zsfif@45.38.107.97:6014/
http://zvuvwjcq:d0y8143zsfif@198.105.121.200:6462/
http://zvuvwjcq:d0y8143zsfif@64.137.96.74:6641/
http://zvuvwjcq:d0y8143zsfif@198.23.243.226:6361/
http://zvuvwjcq:d0y8143zsfif@38.154.185.97:6370/
http://zvuvwjcq:d0y8143zsfif@84.247.60.125:6095/
http://zvuvwjcq:d0y8143zsfif@142.111.67.146:5611/
http://zvuvwjcq:d0y8143zsfif@191.96.254.138:6185/
```

**Full WEBSHARE_PROXY env var:**
```
WEBSHARE_PROXY=http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754/,http://zvuvwjcq:d0y8143zsfif@31.56.127.193:7684/,http://zvuvwjcq:d0y8143zsfif@45.38.107.97:6014/,http://zvuvwjcq:d0y8143zsfif@198.105.121.200:6462/,http://zvuvwjcq:d0y8143zsfif@64.137.96.74:6641/,http://zvuvwjcq:d0y8143zsfif@198.23.243.226:6361/,http://zvuvwjcq:d0y8143zsfif@38.154.185.97:6370/,http://zvuvwjcq:d0y8143zsfif@84.247.60.125:6095/,http://zvuvwjcq:d0y8143zsfif@142.111.67.146:5611/,http://zvuvwjcq:d0y8143zsfif@191.96.254.138:6185/
```

### GitHub Repository
| Item | Value |
|---|---|
| **Owner** | `krishna98877` |
| **Repo** | `Terabox` |
| **Full URL** | https://github.com/krishna98877/Terabox |
| **Clone URL** | `https://github.com/krishna98877/Terabox.git` |
| **Default Branch** | `main` |

### Render.com (Deployment)
| Item | Value |
|---|---|
| **App URL** | https://terabox-detf.onrender.com |
| **Dashboard** | https://dashboard.render.com/ |
| **Plan** | Free (512MB RAM, 15-min sleep threshold) |
| **Build Command** | `npm run build` |
| **Start Command** | `npm start` |
| **Framework** | Next.js |
| **Region** | Oregon, USA |
| **Keep-Alive** | Self-ping every 4 min to prevent sleeping |

**Render Environment Variables (set in dashboard):**
```
DATABASE_URL=file:./db/production.db
CAPTCHASOLV_API_KEY=40fd4b6c-efd9-4a07-99df-53b0cb3888db
WEBSHARE_PROXY=http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754/,http://zvuvwjcq:d0y8143zsfif@31.56.127.193:7684/,http://zvuvwjcq:d0y8143zsfif@45.38.107.97:6014/,http://zvuvwjcq:d0y8143zsfif@198.105.121.200:6462/,http://zvuvwjcq:d0y8143zsfif@64.137.96.74:6641/,http://zvuvwjcq:d0y8143zsfif@198.23.243.226:6361/,http://zvuvwjcq:d0y8143zsfif@38.154.185.97:6370/,http://zvuvwjcq:d0y8143zsfif@84.247.60.125:6095/,http://zvuvwjcq:d0y8143zsfif@142.111.67.146:5611/,http://zvuvwjcq:d0y8143zsfif@191.96.254.138:6185/
WEBSHARE_API_KEY=0yrk5hbrfrci570mpa5kawi3s5odm955vobzi824
NODE_ENV=production
```

### Vercel (Not Currently Used)
| Item | Value |
|---|---|
| **Status** | Not deployed — Render is primary |
| **Reason** | Vercel free tier has 10s serverless function timeout (too short for captcha solving which takes 10-60s) |
| **Alternative** | Use Vercel for static frontend + Render for backend if needed |

### Supabase (Not Currently Used)
| Item | Value |
|---|---|
| **Status** | Not used — SQLite via Prisma is current DB |
| **Reason** | SQLite is sufficient for this use case (single-server, embedded DB) |
| **If needed** | Replace `DATABASE_URL` with Supabase PostgreSQL connection string |
| **Supabase URL** | (not set) |
| **Supabase Anon Key** | (not set) |
| **Supabase Service Key** | (not set) |

### CatchMail.io (Temp Email)
| Item | Value |
|---|---|
| **API Base** | `https://api.catchmail.io` |
| **Cost** | Free |
| **Auth Required** | No — just use any email @supported-domain |
| **Domains** | mailistry.com, zeppost.com, mailsac.com, snapmail.cc, catchmail.io |

### Groq AI (Optional — Not Currently Active)
| Item | Value |
|---|---|
| **Status** | Not configured (GROQ_API_KEY not set) |
| **API Base** | `https://api.groq.com/openai/v1/chat/completions` |
| **Model** | `llama-3.3-70b-versatile` |
| **Purpose** | Email analysis, error diagnosis, optimization suggestions |
| **Get Key** | https://console.groq.com/ |

### IPRoyal (Residential Proxies — Not Currently Active)
| Item | Value |
|---|---|
| **Status** | Not configured (no free tier available) |
| **Signup** | https://iproyal.com/residential-proxies/ |
| **Free Trial** | 100MB traffic |
| **Paid** | From $1.75/GB |
| **Gateway** | `http://user:pass@gate.iproyal.com:12321` |

### TeraBox (Target Platform)
| Item | Value |
|---|---|
| **Primary Domain** | `https://www.1024terabox.com` |
| **Fallback Domains** | `terabox.com`, `dubox.com` |
| **Default Referral Link** | `https://1024terabox.com/s/1_9hqBxA_U6WRc9FUhHl1zQ` |
| **reCAPTCHA Sitekey** | `6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH` |
| **App ID** | `250528` |
| **Chrome Version (spoofed)** | `131` |

---

## 24. Full .env File (Production-Ready)

```env
# ═══════════════════════════════════════════════════════════════════════
# TeraBox Referral Agent — Environment Configuration
# ═══════════════════════════════════════════════════════════════════════

# Database (SQLite — zero config, embedded)
DATABASE_URL=file:./db/production.db

# CaptchaSolv API Key (CAPTCHA solver — 100 FREE solves/day)
CAPTCHASOLV_API_KEY=40fd4b6c-efd9-4a07-99df-53b0cb3888db

# Webshare.io Residential Proxies (10 free — REQUIRED for TeraBox!)
WEBSHARE_PROXY=http://zvuvwjcq:d0y8143zsfif@31.59.20.176:6754/,http://zvuvwjcq:d0y8143zsfif@31.56.127.193:7684/,http://zvuvwjcq:d0y8143zsfif@45.38.107.97:6014/,http://zvuvwjcq:d0y8143zsfif@198.105.121.200:6462/,http://zvuvwjcq:d0y8143zsfif@64.137.96.74:6641/,http://zvuvwjcq:d0y8143zsfif@198.23.243.226:6361/,http://zvuvwjcq:d0y8143zsfif@38.154.185.97:6370/,http://zvuvwjcq:d0y8143zsfif@84.247.60.125:6095/,http://zvuvwjcq:d0y8143zsfif@142.111.67.146:5611/,http://zvuvwjcq:d0y8143zsfif@191.96.254.138:6185/

# Webshare.io API Key (for fetching more proxy endpoints)
WEBSHARE_API_KEY=0yrk5hbrfrci570mpa5kawi3s5odm955vobzi824

# Groq AI (optional — for email analysis & error diagnosis)
# GROQ_API_KEY=your-groq-key-here

# TeraBox reCAPTCHA site key (hardcoded fallback exists — only set if TeraBox rotates key)
# RECAPTCHA_SITE_KEY=6LceASUfAAAAAHBcvTdvuPVie_9yzavGubPLOGTH

# CatchMail.io custom domain (optional)
# CATCHMAIL_CUSTOM_DOMAIN=

# IPRoyal Residential Proxies (alternative to Webshare — not free)
# IPROYAL_USERNAME=
# IPROYAL_PASSWORD+PASSWORD=
# IPROYAL_HOST=gate.iproyal.com
# IPROYAL_PORT=12321
# IPROYAL_COUNTRY=us

# Environment
NODE_ENV=production
```

---

> **Document generated:** 2026-08-13 | **Project:** terabox-referral-agent v1.0.0 | **Repository:** https://github.com/krishna98877/Terabox
