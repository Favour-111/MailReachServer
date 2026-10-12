// Brevo transactional email (https://developers.brevo.com/reference/sendtransacemail).
// This is the only file that knows about Brevo; swap it out to change provider.
// The API key is read from the server environment and never leaves the backend.
import { config } from '../config.js';

export class BrevoError extends Error {
  /**
   * @param {string} userMessage safe to show to users
   * @param {{status?: number, fatal?: boolean, retryable?: boolean, detail?: string}} meta
   *   fatal: every further send will fail too (bad key, unverified sender) so stop the campaign
   */
  constructor(userMessage, { status, fatal = false, retryable = false, detail } = {}) {
    super(userMessage);
    this.userMessage = userMessage;
    this.status = status;
    this.fatal = fatal;
    this.retryable = retryable;
    this.detail = detail;
  }
}

export const isConfigured = () => Boolean(config.brevo.apiKey && config.brevo.senderEmail);
export const getSender = () => ({ email: config.brevo.senderEmail, name: config.brevo.senderName });

function classify(status, body) {
  const detail = `${status} ${body?.code ?? ''} ${body?.message ?? ''}`.trim();
  const msg = String(body?.message ?? '').toLowerCase();
  const E = (m, o) => new BrevoError(m, { status, detail, ...o });

  if (msg.includes('sender')) return E('Sender not verified in Brevo. Verify BREVO_SENDER_EMAIL (or its domain) in your Brevo account.', { fatal: true });
  if (status === 401 || status === 403) return E('Brevo rejected the API key or account access. Check BREVO_API_KEY and your Brevo security settings.', { fatal: true });
  if (status === 429) return E('Brevo rate limit reached. Please wait a moment and retry.', { retryable: true });
  if (status >= 500) return E('Brevo is having temporary problems. Please retry shortly.', { retryable: true });
  if (status === 413 || msg.includes('attachment')) return E('Attachment too large or not accepted by Brevo.');
  if (msg.includes('email') || msg.includes('recipient')) return E('Invalid recipient address.');
  return E('Brevo could not accept this email (invalid request).');
}

async function post(payload) {
  let res;
  try {
    res = await fetch(`${config.brevo.apiUrl}/smtp/email`, {
      method: 'POST',
      headers: { 'api-key': config.brevo.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new BrevoError('Network error while contacting Brevo.', { retryable: true, detail: e.cause ? `${e.message} (${e.cause.code || ''} ${e.cause.message})` : e.message });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = classify(res.status, body);
    err.retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw err;
  }
  return body.messageId ?? null;
}

/**
 * Sends ONE email to ONE recipient (so recipients never see each other).
 * attachments: [{ filename, content: Buffer }]
 * Returns Brevo's messageId. Retries rate limits / transient errors up to 2 times.
 */
export async function sendEmail({ to, subject, html, text, attachments = [], replyTo }) {
  if (!isConfigured()) throw new BrevoError('Email sending is not configured on the server.', { fatal: true });
  const payload = {
    sender: getSender(),
    to: [to.name ? { email: to.email, name: to.name } : { email: to.email }],
    subject,
    htmlContent: html,
    textContent: text,
    ...(replyTo && { replyTo }),
    ...(attachments.length && { attachment: attachments.map((a) => ({ name: a.filename, content: a.content.toString('base64') })) }),
  };

  for (let attempt = 0; ; attempt++) {
    try {
      return await post(payload);
    } catch (e) {
      console.error(`[brevo] send failed (attempt ${attempt + 1}): ${e.detail || e.message}`);
      if (!(e instanceof BrevoError) || !e.retryable || attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, Math.min(e.retryAfter || 2 ** attempt * 1000, 10_000)));
    }
  }
}
