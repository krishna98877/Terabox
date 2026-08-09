/**
 * Structured logging utility with log-level filtering and credential sanitization.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

const LOG_LEVELS: Record<string, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
  silent: LogLevel.SILENT,
};

let currentLevel: LogLevel = LogLevel.INFO;

/**
 * Set the global log level.
 */
export function setLogLevel(level: string): void {
  const l = LOG_LEVELS[level.toLowerCase()];
  if (l !== undefined) {
    currentLevel = l;
  }
}

/**
 * Sanitize strings to remove API keys, tokens, and other credentials.
 * Matches common patterns like X-API-Key values, Bearer tokens, and long hex/base64 strings.
 */
function sanitize(input: string): string {
  return input
    // Replace API key values in headers or JSON
    .replace(/(X-API-Key["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi, '$1[REDACTED]')
    // Replace Bearer tokens
    .replace(/(Bearer\s+)(\S+)/gi, '$1[REDACTED]')
    // Replace potential API keys that look like 20+ char hex/alphanumeric strings after known key names
    .replace(/(api[_-]?key|token|secret|password|credential)["']?\s*[:=]\s*["']?([^\s"',}]{12,})/gi, '$1=[REDACTED]')
    // Replace email addresses in URL paths that might leak credentials
    .replace(/(\/v1\/emails\/)([^/\s]+)/g, '$1[email]');
}

function formatMessage(level: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ` ${JSON.stringify(meta, null, 0)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LogLevel.DEBUG) {
      console.debug(sanitize(formatMessage('debug', message, meta)));
    }
  },

  info(message: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LogLevel.INFO) {
      console.info(sanitize(formatMessage('info', message, meta)));
    }
  },

  warn(message: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LogLevel.WARN) {
      console.warn(sanitize(formatMessage('warn', message, meta)));
    }
  },

  error(message: string, meta?: Record<string, unknown>): void {
    if (currentLevel <= LogLevel.ERROR) {
      console.error(sanitize(formatMessage('error', message, meta)));
    }
  },
};
