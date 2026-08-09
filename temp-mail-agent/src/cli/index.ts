#!/usr/bin/env node

/**
 * Temp Mail Agent CLI — temporary email testing agent.
 */

import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { setLogLevel } from '../utils/logging';
import {
  generateCommand,
  inboxCommand,
  waitCommand,
  readCommand,
  extractCodeCommand,
  extractLinkCommand,
  deleteCommand,
  listCommand,
  cleanupCommand,
  domainsCommand,
  rateLimitCommand,
  checkCommand,
} from './commands';

const program = new Command();

program
  .name('temp-mail')
  .description('Temporary email testing agent — generate inboxes, poll messages, extract verification codes/links')
  .version('1.0.0')
  .option('--debug', 'Enable debug logging', false);

// ─── generate ───

program
  .command('generate')
  .description('Generate one or more temporary email addresses')
  .option('--count <number>', 'Number of inboxes to create', '1')
  .option('--domain <domain>', 'Use a specific domain')
  .option('--ttl <seconds>', 'Time-to-live in seconds')
  .option('--label <label>', 'Label prefix for inboxes (e.g., "terabox-test")')
  .option('--app <application>', 'Application/site being tested')
  .action(async (opts) => {
    const count = parseInt(opts.count, 10);
    if (isNaN(count) || count < 1) {
      console.error('Error: --count must be a positive integer');
      process.exit(1);
    }
    await generateCommand(count, {
      domain: opts.domain,
      ttl: opts.ttl ? parseInt(opts.ttl, 10) : undefined,
      label: opts.label,
      app: opts.app,
    });
  });

// ─── inbox ───

program
  .command('inbox <email>')
  .description('Show messages received by the specified inbox')
  .action(async (email: string) => {
    await inboxCommand(email);
  });

// ─── wait ───

program
  .command('wait <email>')
  .description('Poll an inbox until a new message arrives')
  .option('--interval <ms>', 'Polling interval in milliseconds', '3000')
  .option('--max-attempts <n>', 'Maximum poll attempts', '60')
  .action(async (email: string, opts) => {
    await waitCommand(email, {
      interval: parseInt(opts.interval, 10),
      maxAttempts: parseInt(opts.maxAttempts, 10),
    });
  });

// ─── read ───

program
  .command('read <messageId>')
  .description('Retrieve and display the complete message')
  .action(async (messageId: string) => {
    await readCommand(messageId);
  });

// ─── extract-code ───

program
  .command('extract-code <email>')
  .description('Find likely verification/OTP codes in recent messages')
  .action(async (email: string) => {
    await extractCodeCommand(email);
  });

// ─── extract-link ───

program
  .command('extract-link <email>')
  .description('Extract likely verification/confirmation links')
  .option('--all', 'Include non-action links as well', false)
  .action(async (email: string, opts) => {
    await extractLinkCommand(email, { all: opts.all });
  });

// ─── delete ───

program
  .command('delete <email>')
  .description('Delete the temporary inbox and all its messages')
  .action(async (email: string) => {
    await deleteCommand(email);
  });

// ─── list ───

program
  .command('list')
  .description('Show currently active test inboxes')
  .action(async () => {
    await listCommand();
  });

// ─── cleanup ───

program
  .command('cleanup')
  .description('Delete all temporary inboxes from the current session')
  .action(async () => {
    await cleanupCommand();
  });

// ─── domains ───

program
  .command('domains')
  .description('List available email domains')
  .action(async () => {
    await domainsCommand();
  });

// ─── ratelimit ───

program
  .command('ratelimit')
  .description('Show current rate limit status')
  .action(async () => {
    await rateLimitCommand();
  });

// ─── check (alias) ───

program
  .command('check <email>')
  .description('Check inbox for messages (alias for inbox)')
  .action(async (email: string) => {
    await checkCommand(email);
  });

// ─── Parse and run ───

program.parseAsync(process.argv).catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});

// Handle global debug flag
const globalOpts = program.opts();
if (globalOpts.debug) {
  setLogLevel('debug');
}
