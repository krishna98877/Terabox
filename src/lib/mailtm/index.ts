export { getDomains, createAccount, getToken, getMessages, getMessage, deleteMessage, deleteAccount, createTempEmail } from './client';
export type { MailTmDomain, MailTmAccount, MailTmMessageSummary, MailTmMessageDetail } from './client';
export { extractVerificationCode, extractVerificationLink, htmlToPlainText } from './extractors';
