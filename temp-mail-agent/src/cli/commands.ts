/**
 * CLI commands — all user-facing command implementations.
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';

import { TempMailClient } from '../api/tempMailClient';
import { InboxManager } from '../email/inboxManager';
import { SessionStore } from '../storage/sessionStore';
import { extractCodesFromInbox, extractCodesFromMessage } from '../email/codeExtractor';
import { extractLinksFromInbox, extractLinksFromMessage } from '../email/linkExtractor';
import { getMessageText, summarizeMessage } from '../email/messageParser';
import { logger, setLogLevel } from '../utils/logging';

// ─── Helpers ───

function createClient(): TempMailClient {
  const apiKey = process.env.TEMP_MAIL_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('Error: TEMP_MAIL_API_KEY is not set. Add it to your .env file or export it as an environment variable.'));
    process.exit(1);
  }
  return new TempMailClient({
    apiKey,
    timeout: parseInt(process.env.TEMP_MAIL_REQUEST_TIMEOUT || '10000', 10),
    maxRetries: parseInt(process.env.TEMP_MAIL_MAX_RETRIES || '3', 10),
    retryBaseDelay: parseInt(process.env.TEMP_MAIL_RETRY_BASE_DELAY || '1000', 10),
  });
}

function createStore(): SessionStore {
  return new SessionStore(process.env.TEMP_MAIL_SESSION_FILE);
}

// ─── generate ───

export async function generateCommand(
  count: number = 1,
  options: { domain?: string; ttl?: number; label?: string; app?: string } = {}
): Promise<void> {
  const client = createClient();
  const store = createStore();
  const manager = new InboxManager(client, store);

  if (count === 1) {
    const spinner = ora('Creating temporary email...').start();
    try {
      const result = await manager.createInbox({
        domain: options.domain,
        ttl: options.ttl,
        label: options.label,
        application: options.app,
      });
      spinner.succeed('Temporary email created!');

      console.log();
      console.log(chalk.bold('Email:       ') + chalk.cyan(result.email));
      console.log(chalk.bold('Status:      ') + chalk.green('Active'));
      console.log(chalk.bold('Created:     ') + new Date().toISOString());
      console.log(chalk.bold('TTL:         ') + `${result.ttl}s (${Math.floor(result.ttl / 3600)}h ${Math.floor((result.ttl % 3600) / 60)}m)`);
      if (result.label) console.log(chalk.bold('Label:       ') + result.label);
      if (result.application) console.log(chalk.bold('Application: ') + result.application);
      console.log();
    } catch (error) {
      spinner.fail('Failed to create temporary email');
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  } else {
    const spinner = ora(`Creating ${count} temporary emails...`).start();
    try {
      const results = await manager.createMultipleInboxes(count, {
        domain: options.domain,
        ttl: options.ttl,
        label: options.label,
        application: options.app,
      });
      spinner.succeed(`Created ${results.length}/${count} temporary emails`);

      const table = new Table({
        head: [chalk.bold('#'), chalk.bold('Email'), chalk.bold('TTL'), chalk.bold('Label')],
        colWidths: [5, 40, 12, 20],
      });

      results.forEach((r, i) => {
        table.push([String(i + 1), chalk.cyan(r.email), `${r.ttl}s`, r.label || '-']);
      });

      console.log(table.toString());
    } catch (error) {
      spinner.fail('Failed to create temporary emails');
      console.error(chalk.red((error as Error).message));
      process.exit(1);
    }
  }
}

// ─── inbox ───

export async function inboxCommand(email: string): Promise<void> {
  const client = createClient();
  const spinner = ora(`Fetching messages for ${email}...`).start();

  try {
    const result = await client.getMessages(email);
    const messages = result.messages || [];
    spinner.succeed(`Found ${messages.length} message(s)`);

    if (messages.length === 0) {
      console.log(chalk.yellow('No messages found.'));
      return;
    }

    const table = new Table({
      head: [chalk.bold('ID'), chalk.bold('From'), chalk.bold('Subject'), chalk.bold('Received')],
      colWidths: [38, 30, 40, 22],
    });

    messages.forEach((m) => {
      table.push([
        chalk.gray(m.id.substring(0, 8) + '...'),
        m.from.substring(0, 28),
        m.subject.substring(0, 38),
        m.created_at,
      ]);
    });

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to fetch messages');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ─── wait ───

export async function waitCommand(
  email: string,
  options: { interval?: number; maxAttempts?: number } = {}
): Promise<void> {
  const client = createClient();
  const store = createStore();
  const manager = new InboxManager(client, store);

  const spinner = ora(`Waiting for new message on ${email}...`).start();

  try {
    const messages = await manager.pollForMessages(email, {
      interval: options.interval || parseInt(process.env.TEMP_MAIL_POLL_INTERVAL || '3000', 10),
      maxAttempts: options.maxAttempts || parseInt(process.env.TEMP_MAIL_MAX_POLL_ATTEMPTS || '60', 10),
      onPoll: (attempt) => {
        spinner.text = `Waiting for new message... (attempt ${attempt})`;
      },
    });

    if (messages.length === 0) {
      spinner.warn('No new messages received within the polling window.');
      return;
    }

    spinner.succeed(`New message received!`);

    for (const msg of messages) {
      console.log();
      console.log(chalk.bold('Message ID:  ') + msg.id);
      console.log(chalk.bold('From:        ') + msg.from);
      console.log(chalk.bold('Subject:     ') + msg.subject);
      console.log(chalk.bold('Received:    ') + msg.created_at);
    }
  } catch (error) {
    spinner.fail('Polling failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ─── read ───

export async function readCommand(messageId: string): Promise<void> {
  const client = createClient();
  const spinner = ora(`Fetching message ${messageId}...`).start();

  try {
    const message = await client.getMessage(messageId);
    spinner.succeed('Message retrieved');

    console.log();
    console.log(chalk.bold('═'.repeat(60)));
    console.log(chalk.bold('From:        ') + message.from);
    console.log(chalk.bold('To:          ') + message.to);
    console.log(chalk.bold('Subject:     ') + message.subject);
    console.log(chalk.bold('Date:        ') + message.created_at);
    if (message.attachments?.length > 0) {
      console.log(chalk.bold('Attachments: ') + message.attachments.map((a) => `${a.name} (${a.size} bytes)`).join(', '));
    }
    console.log(chalk.bold('═'.repeat(60)));
    console.log();

    const text = getMessageText(message);
    console.log(text);
    console.log();
  } catch (error) {
    spinner.fail('Failed to read message');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ─── extract-code ───

export async function extractCodeCommand(email: string): Promise<void> {
  const client = createClient();
  const spinner = ora(`Extracting verification codes from ${email}...`).start();

  try {
    const codes = await extractCodesFromInbox(client, email);

    if (codes.length === 0) {
      spinner.warn('No verification codes found in recent messages.');
      return;
    }

    spinner.succeed(`Found ${codes.length} verification code(s)`);

    const table = new Table({
      head: [chalk.bold('Code'), chalk.bold('Pattern'), chalk.bold('Subject')],
      colWidths: [15, 25, 50],
    });

    codes.forEach((c) => {
      table.push([chalk.green(chalk.bold(c.code)), chalk.gray(c.pattern), c.subject.substring(0, 48)]);
    });

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to extract codes');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ─── extract-link ───

export async function extractLinkCommand(email: string, options: { all?: boolean } = {}): Promise<void> {
  const client = createClient();
  const spinner = ora(`Extracting links from ${email}...`).start();

  try {
    const links = await extractLinksFromInbox(client, email, { all: options.all });

    if (links.length === 0) {
      spinner.warn('No verification links found in recent messages.');
      return;
    }

    spinner.succeed(`Found ${links.length} link(s)`);

    const table = new Table({
      head: [chalk.bold('Type'), chalk.bold('URL'), chalk.bold('Subject')],
      colWidths: [15, 70, 30],
    });

    links.forEach((l) => {
      table.push([
        chalk.cyan(l.type),
        l.url.length > 68 ? l.url.substring(0, 65) + '...' : l.url,
        l.subject.substring(0, 28),
      ]);
    });

    console.log(table.toString());
  } catch (error) {
    spinner.fail('Failed to extract links');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ─── delete ───

export async function deleteCommand(email: string): Promise<void> {
  const client = createClient();
  const store = createStore();
  const spinner = ora(`Deleting inbox ${email}...`).start();

  try {
    await client.deleteEmail(email);
    store.removeInbox(email);
    spinner.succeed(`Inbox ${email} deleted`);
  } catch (error) {
    spinner.fail('Failed to delete inbox');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ─── list ───

export async function listCommand(): Promise<void> {
  const store = createStore();
  const inboxes = store.getInboxes();

  if (inboxes.length === 0) {
    console.log(chalk.yellow('No active test inboxes in current session.'));
    console.log(chalk.gray('Use "temp-mail generate" to create one.'));
    return;
  }

  const table = new Table({
    head: [chalk.bold('#'), chalk.bold('Email'), chalk.bold('TTL'), chalk.bold('Created'), chalk.bold('App'), chalk.bold('Label')],
    colWidths: [5, 35, 10, 22, 15, 15],
  });

  inboxes.forEach((inbox, i) => {
    table.push([
      String(i + 1),
      chalk.cyan(inbox.email),
      `${inbox.ttl}s`,
      inbox.createdAt.substring(0, 19),
      inbox.application || '-',
      inbox.label || '-',
    ]);
  });

  console.log(table.toString());
  console.log(chalk.gray(`Session: ${inboxes.length} inbox(es)`));
}

// ─── cleanup ───

export async function cleanupCommand(): Promise<void> {
  const client = createClient();
  const store = createStore();
  const manager = new InboxManager(client, store);
  const spinner = ora('Cleaning up all inboxes...').start();

  try {
    const result = await manager.cleanupAll();
    spinner.succeed(`Cleanup complete: ${result.deleted.length} deleted, ${result.failed.length} failed`);

    if (result.failed.length > 0) {
      console.log(chalk.yellow('Failed to delete:'));
      result.failed.forEach((e) => console.log(`  - ${e}`));
    }
  } catch (error) {
    spinner.fail('Cleanup failed');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ─── domains ───

export async function domainsCommand(): Promise<void> {
  const client = createClient();
  const spinner = ora('Fetching available domains...').start();

  try {
    const result = await client.getDomains();
    spinner.succeed(`Available domains: ${result.domains.length}`);

    result.domains.forEach((d) => console.log(`  ${chalk.cyan(d)}`));
  } catch (error) {
    spinner.fail('Failed to fetch domains');
    console.error(chalk.red((error as Error).message));
    process.exit(1);
  }
}

// ─── ratelimit ───

export async function rateLimitCommand(): Promise<void> {
  const client = createClient();

  try {
    // Make a lightweight request to get rate-limit headers
    await client.getDomains();
    const info = client.getRateLimitInfo();

    console.log(chalk.bold('Rate Limit Status:'));
    console.log(`  Limit:     ${info.limit ?? 'N/A'}`);
    console.log(`  Remaining: ${info.remaining ?? 'N/A'}`);
    console.log(`  Used:      ${info.used ?? 'N/A'}`);
    console.log(`  Reset:     ${info.reset ? new Date(info.reset * 1000).toISOString() : 'N/A'}`);
  } catch (error) {
    console.error(chalk.red('Failed to check rate limit:'), (error as Error).message);
    process.exit(1);
  }
}

// ─── check (alias for inbox) ───

export async function checkCommand(email: string): Promise<void> {
  return inboxCommand(email);
}
