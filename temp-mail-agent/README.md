# Temp Mail Agent

A reusable temporary-email testing agent built on the [Temp Mail API](https://docs.temp-mail.io/docs/getting-started). Generate disposable inboxes, poll for incoming messages, extract verification codes and confirmation links, and automate QA workflows — all from the CLI.

---

## Features

- **Generate temporary emails** — single or batch, with labels and app tracking
- **Poll inboxes** — configurable intervals, automatic new-message detection
- **Read messages** — full body text and HTML, attachment metadata
- **Extract verification codes** — OTP, PIN, alphanumeric tokens via pattern matching
- **Extract confirmation links** — verify, reset, confirm, unsubscribe URLs
- **Session management** — track active inboxes, persist across runs
- **Cleanup** — delete all temporary inboxes with one command
- **Rate-limit aware** — reads `X-Ratelimit-*` headers, self-throttles, respects 429
- **Retry with backoff** — exponential backoff + jitter on transient failures
- **Credential safety** — API key from env vars only, sanitized logs, `.env` in `.gitignore`

---

## Quick Start

### 1. Install

```bash
cd temp-mail-agent
npm install
npm run build
```

### 2. Set your API key

```bash
cp .env.example .env
# Edit .env and add your TEMP_MAIL_API_KEY
```

Get your key at: https://temp-mail.io/profile?section=api (requires premium account)

### 3. Use

```bash
# Generate one temporary email
node dist/cli/index.js generate

# Generate 20 test inboxes for batch QA
node dist/cli/index.js generate --count 20 --label terabox-test --app terabox

# Check an inbox
node dist/cli/index.js inbox user@example.com

# Wait for a new message (polls until one arrives)
node dist/cli/index.js wait user@example.com

# Read a specific message
node dist/cli/index.js read <message-id>

# Extract verification code
node dist/cli/index.js extract-code user@example.com

# Extract verification/confirmation link
node dist/cli/index.js extract-link user@example.com

# List all active test inboxes
node dist/cli/index.js list

# Delete one inbox
node dist/cli/index.js delete user@example.com

# Clean up all inboxes from this session
node dist/cli/index.js cleanup

# Show available domains
node dist/cli/index.js domains

# Check rate limit status
node dist/cli/index.js ratelimit
```

Or run in dev mode without building:

```bash
npx ts-node src/cli/index.ts generate
```

---

## Commands

| Command | Description |
|---------|-------------|
| `generate [--count N] [--domain D] [--ttl S] [--label L] [--app A]` | Create temporary email(s) |
| `inbox <email>` | Show messages in an inbox |
| `wait <email> [--interval ms] [--max-attempts N]` | Poll until a new message arrives |
| `read <messageId>` | Retrieve and display a complete message |
| `extract-code <email>` | Find OTP/verification codes in recent messages |
| `extract-link <email> [--all]` | Extract verification/confirmation links |
| `delete <email>` | Delete a temporary inbox |
| `list` | Show all active test inboxes |
| `cleanup` | Delete all session inboxes |
| `domains` | List available email domains |
| `ratelimit` | Show current rate limit status |
| `check <email>` | Alias for `inbox` |

---

## Natural Language Shortcuts

| You say | Agent runs |
|---------|------------|
| "Generate a test email" | `generate` |
| "Generate 20 test emails" | `generate --count 20` |
| "Check [email]" | `inbox [email]` |
| "Get the verification code" | `extract-code [email]` |
| "Get the verification link" | `extract-link [email]` |
| "Clean up" | `cleanup` |

---

## Architecture

```
/src
  /api
    types.ts            — API type definitions
    tempMailClient.ts   — HTTP client with retry & rate-limit
    index.ts
  /email
    inboxManager.ts     — Create, track, poll, delete inboxes
    messageParser.ts    — HTML→text, message summarization
    codeExtractor.ts    — OTP/verification code extraction
    linkExtractor.ts    — Verification/confirmation link extraction
    index.ts
  /cli
    commands.ts         — CLI command implementations
    index.ts            — CLI entry point (commander)
  /storage
    sessionStore.ts     — Persist inboxes & message cache to JSON
    index.ts
  /utils
    logging.ts          — Structured logging with sanitization
    retry.ts            — Exponential backoff with jitter
    rateLimit.ts        — Rate-limit header parsing & throttling
    index.ts
/tests
  messageParser.test.ts — Unit tests for parser, extractor, retry, rate-limit
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMP_MAIL_API_KEY` | *(required)* | Your Temp Mail API key |
| `TEMP_MAIL_POLL_INTERVAL` | `3000` | Polling interval in ms |
| `TEMP_MAIL_MAX_POLL_ATTEMPTS` | `60` | Max poll attempts |
| `TEMP_MAIL_REQUEST_TIMEOUT` | `10000` | HTTP request timeout in ms |
| `TEMP_MAIL_MAX_RETRIES` | `3` | Max retry attempts |
| `TEMP_MAIL_RETRY_BASE_DELAY` | `1000` | Base delay for exponential backoff |
| `TEMP_MAIL_SESSION_FILE` | `.temp-mail-session.json` | Session file path |

---

## API Reference (from official docs)

Base URL: `https://api.temp-mail.io`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/v1/emails` | Create temporary email |
| `GET` | `/v1/emails/{email}/messages` | Get messages for inbox |
| `DELETE` | `/v1/emails/{email}` | Delete email + all messages |
| `GET` | `/v1/messages/{messageId}` | Get specific message |
| `DELETE` | `/v1/messages/{messageId}` | Delete specific message |
| `GET` | `/v1/messages/{messageId}/source` | Get raw message source |
| `GET` | `/v1/messages/{messageId}/attachments/{id}` | Download attachment |
| `GET` | `/v1/domains` | List available domains |

Authentication: `X-API-Key` header on every request.

Rate limit headers: `X-Ratelimit-Limit`, `X-Ratelimit-Remaining`, `X-Ratelimit-Used`, `X-Ratelimit-Reset`.

---

## Testing

```bash
npm test
```

Tests cover message parsing, code extraction, link extraction, retry logic, and rate-limit parsing.

---

## Use Case: TeraBox Webmaster Referral Program Automation

This agent is designed to support automation workflows such as the TeraBox webmaster referral program:

1. **Generate test emails** with labels:
   ```bash
   node dist/cli/index.js generate --count 5 --label terabox-ref --app terabox
   ```

2. **Use the generated emails** to sign up on TeraBox referral program

3. **Wait for verification emails**:
   ```bash
   node dist/cli/index.js wait user@example.com
   ```

4. **Extract verification codes** automatically:
   ```bash
   node dist/cli/index.js extract-code user@example.com
   ```

5. **Or extract the verification link** to click programmatically:
   ```bash
   node dist/cli/index.js extract-link user@example.com
   ```

6. **Clean up** when testing is done:
   ```bash
   node dist/cli/index.js cleanup
   ```

---

## Security

- API key is **never** printed, logged, or committed
- Credentials read from environment variables only
- `.env` is in `.gitignore`
- Log output is sanitized to remove API keys and tokens
- Email contents are not stored permanently unless cached in session
- No data is sent to third parties

---

## Ethical Use

This tool is for **QA testing of applications you own or are authorized to test**. It must NOT be used to:

- Bypass CAPTCHA or anti-abuse systems
- Evade disposable-email detection
- Create fraudulent accounts
- Manufacture referral rewards fraudulently
- Manipulate affiliate/referral systems
- Circumvent platform rate limits
- Rotate identities to evade restrictions

---

## License

MIT
