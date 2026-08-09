/**
 * Session store — persist active inboxes and message cache to a JSON file.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { InboxRecord, SessionData, MessageDetail } from '../api/types';
import { logger } from '../utils/logging';

const DEFAULT_SESSION_FILE = '.temp-mail-session.json';

export class SessionStore {
  private filePath: string;
  private data: SessionData;

  constructor(filePath?: string) {
    this.filePath = filePath || DEFAULT_SESSION_FILE;
    this.data = this.load();
  }

  /**
   * Load session data from disk, or initialize empty.
   */
  private load(): SessionData {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw) as SessionData;
        logger.debug(`Session loaded from ${this.filePath} (${parsed.inboxes?.length || 0} inboxes)`);
        return parsed;
      }
    } catch (error) {
      logger.warn(`Failed to load session from ${this.filePath}: ${(error as Error).message}`);
    }

    return {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inboxes: [],
      messageCache: {},
    };
  }

  /**
   * Persist session data to disk.
   */
  private save(): void {
    try {
      this.data.updatedAt = new Date().toISOString();
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
      logger.debug(`Session saved to ${this.filePath}`);
    } catch (error) {
      logger.warn(`Failed to save session to ${this.filePath}: ${(error as Error).message}`);
    }
  }

  // ─── Inboxes ───

  addInbox(inbox: InboxRecord): void {
    // Prevent duplicates
    const exists = this.data.inboxes.find((i) => i.email === inbox.email);
    if (!exists) {
      this.data.inboxes.push(inbox);
      this.save();
    }
  }

  removeInbox(email: string): void {
    this.data.inboxes = this.data.inboxes.filter((i) => i.email !== email);
    this.save();
  }

  getInboxes(): InboxRecord[] {
    return [...this.data.inboxes];
  }

  getInbox(email: string): InboxRecord | undefined {
    return this.data.inboxes.find((i) => i.email === email);
  }

  // ─── Message Cache ───

  cacheMessage(message: MessageDetail): void {
    this.data.messageCache[message.id] = message;
    this.save();
  }

  getMessage(messageId: string): MessageDetail | undefined {
    return this.data.messageCache[messageId];
  }

  clearMessageCache(): void {
    this.data.messageCache = {};
    this.save();
  }

  // ─── Session ───

  clear(): void {
    this.data = {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      inboxes: [],
      messageCache: {},
    };
    this.save();
  }

  /**
   * Get session file path.
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Get session summary.
   */
  getSummary(): { inboxCount: number; cachedMessages: number; createdAt: string; updatedAt: string } {
    return {
      inboxCount: this.data.inboxes.length,
      cachedMessages: Object.keys(this.data.messageCache).length,
      createdAt: this.data.createdAt,
      updatedAt: this.data.updatedAt,
    };
  }
}
