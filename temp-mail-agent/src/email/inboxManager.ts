/**
 * Inbox manager — create, track, poll, and delete temporary email inboxes.
 */

import { TempMailClient, CreateEmailResponse, MessageSummary, MessageDetail } from '../api';
import { logger } from '../utils/logging';
import { sleep } from '../utils/retry';
import { SessionStore } from '../storage/sessionStore';

export interface CreateInboxOptions {
  domain?: string;
  ttl?: number;
  label?: string;
  application?: string;
}

export interface PollOptions {
  interval?: number;       // ms between polls (default: 3000)
  maxAttempts?: number;    // max poll attempts (default: 60)
  onPoll?: (attempt: number) => void;
}

export class InboxManager {
  private client: TempMailClient;
  private store: SessionStore;

  constructor(client: TempMailClient, store: SessionStore) {
    this.client = client;
    this.store = store;
  }

  /**
   * Create a single temporary inbox and register it in the session.
   */
  async createInbox(options: CreateInboxOptions = {}): Promise<CreateEmailResponse & { label?: string; application?: string }> {
    const result = await this.client.createEmail({
      domain: options.domain,
      ttl: options.ttl,
    });

    // Register in session store
    this.store.addInbox({
      email: result.email,
      ttl: result.ttl,
      createdAt: new Date().toISOString(),
      label: options.label,
      application: options.application,
    });

    return {
      ...result,
      label: options.label,
      application: options.application,
    };
  }

  /**
   * Create multiple temporary inboxes with optional delay between requests
   * to respect rate limits.
   */
  async createMultipleInboxes(
    count: number,
    options: CreateInboxOptions = {},
    delayMs: number = 500
  ): Promise<(CreateEmailResponse & { label?: string; application?: string })[]> {
    const results: (CreateEmailResponse & { label?: string; application?: string })[] = [];

    for (let i = 0; i < count; i++) {
      try {
        const label = options.label ? `${options.label}-${i + 1}` : undefined;
        const result = await this.createInbox({ ...options, label });
        results.push(result);

        if (i < count - 1) {
          await sleep(delayMs);
        }
      } catch (error) {
        logger.error(`Failed to create inbox ${i + 1}/${count}: ${(error as Error).message}`);
        // Continue with remaining inboxes even if one fails
      }
    }

    logger.info(`Created ${results.length}/${count} temporary inboxes`);
    return results;
  }

  /**
   * Get messages for an inbox.
   */
  async getInboxMessages(email: string): Promise<MessageSummary[]> {
    const result = await this.client.getMessages(email);
    return result.messages || [];
  }

  /**
   * Poll an inbox until a new message arrives (or timeout).
   * Returns the list of messages when at least one is found.
   */
  async pollForMessages(
    email: string,
    options: PollOptions = {}
  ): Promise<MessageSummary[]> {
    const interval = options.interval || 3000;
    const maxAttempts = options.maxAttempts || 60;
    const seen = new Set<string>();

    // First, get existing messages so we can detect NEW ones
    const initial = await this.client.getMessages(email);
    for (const msg of initial.messages || []) {
      seen.add(msg.id);
    }

    logger.info(`Polling ${email} for new messages (interval: ${interval}ms, max: ${maxAttempts} attempts)`);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (options.onPoll) options.onPoll(attempt);

      await sleep(interval);

      try {
        const result = await this.client.getMessages(email);
        const messages = result.messages || [];

        // Find new messages (not in the initial set)
        const newMessages = messages.filter((m) => !seen.has(m.id));
        if (newMessages.length > 0) {
          logger.info(`Found ${newMessages.length} new message(s) for ${email}`);
          return newMessages;
        }

        logger.debug(`Poll ${attempt}/${maxAttempts}: no new messages yet`);
      } catch (error) {
        logger.warn(`Poll ${attempt}/${maxAttempts} failed: ${(error as Error).message}`);
      }
    }

    logger.warn(`Polling timed out after ${maxAttempts} attempts for ${email}`);
    return [];
  }

  /**
   * Get a specific message by ID (with optional caching in session store).
   */
  async getMessage(messageId: string): Promise<MessageDetail> {
    // Check cache first
    const cached = this.store.getMessage(messageId);
    if (cached) {
      logger.debug(`Message ${messageId} served from cache`);
      return cached;
    }

    const message = await this.client.getMessage(messageId);
    this.store.cacheMessage(message);
    return message;
  }

  /**
   * Delete a temporary inbox and remove it from the session.
   */
  async deleteInbox(email: string): Promise<void> {
    await this.client.deleteEmail(email);
    this.store.removeInbox(email);
  }

  /**
   * List all active inboxes in the current session.
   */
  listInboxes() {
    return this.store.getInboxes();
  }

  /**
   * Clean up all inboxes in the current session.
   */
  async cleanupAll(): Promise<{ deleted: string[]; failed: string[] }> {
    const inboxes = this.store.getInboxes();
    const deleted: string[] = [];
    const failed: string[] = [];

    logger.info(`Cleaning up ${inboxes.length} inboxes...`);

    for (const inbox of inboxes) {
      try {
        await this.client.deleteEmail(inbox.email);
        deleted.push(inbox.email);
        await sleep(300); // small delay to avoid hammering
      } catch (error) {
        logger.warn(`Failed to delete ${inbox.email}: ${(error as Error).message}`);
        failed.push(inbox.email);
      }
    }

    // Clear session store
    if (failed.length === 0) {
      this.store.clear();
    } else {
      // Remove only successfully deleted inboxes
      for (const email of deleted) {
        this.store.removeInbox(email);
      }
    }

    logger.info(`Cleanup complete: ${deleted.length} deleted, ${failed.length} failed`);
    return { deleted, failed };
  }
}
