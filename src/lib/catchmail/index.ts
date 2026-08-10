/**
 * CatchMail.io — Free disposable email API.
 * No account creation, no tokens. Just pick an address and poll.
 */
export {
  listMessages,
  getMessage,
  deleteMessage,
  createTempEmail,
  getDomains,
  pollForMessages,
} from './client';

export type {
  CatchMailMessageSummary,
  CatchMailMessageDetail,
  CatchMailInbox,
} from './client';

export {
  extractVerificationCode,
  extractOtpFromHtml,
  extractVerificationLink,
  htmlToPlainText,
} from './extractors';
