/**
 * Type definitions for the Temp Mail API.
 */

// ─── Email ───

export interface CreateEmailResponse {
  email: string;
  ttl: number;
}

// ─── Messages ───

export interface MessageSummary {
  id: string;
  from: string;
  subject: string;
  created_at: string;
}

export interface MessagesListResponse {
  messages: MessageSummary[];
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
}

export interface MessageDetail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body_text: string;
  body_html: string;
  created_at: string;
  attachments: Attachment[];
}

// ─── Domains ───

export interface DomainsResponse {
  domains: string[];
}

// ─── Errors ───

export interface ApiError {
  error: {
    type: string;
    code: string;
    detail: string;
  };
  meta: {
    request_id: string;
  };
}

// ─── Rate Limit ───

export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  used: number | null;
  reset: number | null;
}

// ─── Session ───

export interface InboxRecord {
  email: string;
  ttl: number;
  createdAt: string;
  label?: string;        // optional user label (e.g. "terabox-test-1")
  application?: string;  // which app/site this inbox is for
}

export interface SessionData {
  version: number;
  createdAt: string;
  updatedAt: string;
  inboxes: InboxRecord[];
  messageCache: Record<string, MessageDetail>; // messageId → message
}

// ─── Extracted ───

export interface ExtractedCode {
  code: string;
  source: string;       // which message id
  subject: string;
  pattern: string;      // which regex matched
}

export interface ExtractedLink {
  url: string;
  source: string;       // which message id
  subject: string;
  type: string;         // "verification" | "confirmation" | "reset" | "unsubscribe" | "other"
}
