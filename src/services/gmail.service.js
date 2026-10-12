// Gmail API sending on behalf of a user's connected Google account (OAuth 2.0).
// Tokens never leave the server. Only the refresh token is stored, encrypted; access tokens live in memory.
// Gmail decides the real sender identity: the From address is always the connected account.
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { encrypt, decrypt } from '../crypto.js';

export const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  // Needed only to learn WHICH Gmail address was connected (gmail.send cannot read the profile).
  // "openid email" are non-sensitive scopes and give no access to mail.
  'openid',
  'email',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export class GmailError extends Error {
  /** userMessage is safe to show to users. fatal: every further send will fail too, so stop the campaign. */
  constructor(userMessage, { status, fatal = false, retryable = false, detail, retryAfter = 0 } = {}) {
    super(userMessage);
    this.userMessage = userMessage;
    this.status = status;
    this.fatal = fatal;
    this.retryable = retryable;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

export const isOAuthConfigured = () => Boolean(config.google.clientId && config.google.clientSecret && config.google.redirectUri && config.encryptionKey);

const b64url = (buf) => Buffer.from(buf).toString('base64url');
export const newPkce = () => {
  const verifier = b64url(crypto.randomBytes(32));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
};

export function buildAuthUrl({ state, challenge, loginHint }) {
  const q = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline', // we need a refresh token
    prompt: 'consent', // Google only returns a refresh token when consent is shown
    include_granted_scopes: 'false',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(loginHint && { login_hint: loginHint }),
  });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(params) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    throw new GmailError('Could not reach Google. Please try again.', { retryable: true, detail: e.cause?.code || e.message });
  }
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

// Exchanges the authorization code and returns { refreshToken, accessToken, expiresIn, email }.
export async function exchangeCode(code, verifier) {
  const { res, body } = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: config.google.redirectUri, code_verifier: verifier });
  if (!res.ok) throw new GmailError('Google rejected the authorization code. Please try connecting again.', { status: res.status, detail: body.error });
  if (!body.refresh_token) throw new GmailError('Google did not grant offline access. Remove this app at myaccount.google.com/permissions and connect again.', { detail: 'no refresh_token' });
  if (!String(body.scope || '').includes('gmail.send')) throw new GmailError('Permission to send email was not granted. Please connect again and tick the sending permission.', { detail: `missing gmail.send scope; granted: ${body.scope}` });
  // id_token came straight from Google's token endpoint over TLS, so reading its claims without re-verifying the signature is acceptable.
  const claims = JSON.parse(Buffer.from(String(body.id_token || '').split('.')[1] || '', 'base64url').toString() || '{}');
  if (!claims.email || claims.email_verified === false) throw new GmailError('Could not read the Gmail address from Google.', { detail: 'no email claim' });
  return { refreshToken: body.refresh_token, accessToken: body.access_token, expiresIn: body.expires_in, email: String(claims.email).toLowerCase() };
}

export async function revokeToken(token) {
  try {
    await fetch(REVOKE_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) });
  } catch { /* best effort: the local credentials are deleted regardless */ }
}

// ---- access tokens (in memory only) ----
const accessCache = new Map(); // userId -> { token, expiresAt }
export const forgetAccessToken = (userId) => accessCache.delete(userId);

async function getAccessToken(conn) {
  const hit = accessCache.get(conn.userId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const { res, body } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(conn.refreshTokenEnc) });
  if (!res.ok) {
    if (body.error === 'invalid_grant' || body.error === 'unauthorized_client') {
      // Revoked by the user, or expired (refresh tokens last ~7 days while the Google app is in Testing mode)
      await prisma.gmailConnection.update({ where: { userId: conn.userId }, data: { status: 'needs_reconnect' } });
      accessCache.delete(conn.userId);
      throw new GmailError('Your Gmail connection has expired or was revoked. Reconnect Gmail in Settings.', { status: res.status, fatal: true, detail: body.error });
    }
    throw new GmailError('Could not refresh Gmail access. Please try again.', { status: res.status, retryable: res.status >= 500, detail: body.error });
  }
  accessCache.set(conn.userId, { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 });
  return body.access_token;
}

// ---- MIME ----
const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
const q = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`); // RFC 2047 for non-ASCII
const noCtl = (s) => String(s ?? '').replace(/[\r\n\0]+/g, ' ').trim(); // header-injection guard
const addr = ({ email, name }) => {
  const n = noCtl(name);
  if (!n) return noCtl(email);
  // Encoded-words must not sit inside a quoted-string (RFC 2047), so only quote plain ASCII names
  return `${/^[\x20-\x7e]*$/.test(n) ? `"${n.replace(/(["\\])/g, '\\$1')}"` : q(n)} <${noCtl(email)}>`;
};
const wrap76 = (b64) => b64.replace(/.{76}(?=.)/g, '$&\r\n');
const part = (type, text) => `Content-Type: ${type}; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(Buffer.from(text, 'utf8').toString('base64'))}`;

export function buildMime({ from, to, replyTo, subject, html, text, attachments = [] }) {
  const id = crypto.randomBytes(12).toString('hex');
  const alt = `alt_${id}`;
  const mixed = `mix_${id}`;
  const headers = [
    `From: ${addr(from)}`,
    `To: ${addr(to)}`,
    ...(replyTo ? [`Reply-To: ${addr(replyTo)}`] : []),
    `Subject: ${q(noCtl(subject))}`,
    'MIME-Version: 1.0',
  ];
  const altBody = `--${alt}\r\n${part('text/plain', crlf(text))}\r\n--${alt}\r\n${part('text/html', crlf(html))}\r\n--${alt}--`;
  if (!attachments.length) {
    return [...headers, `Content-Type: multipart/alternative; boundary="${alt}"`, '', altBody].join('\r\n');
  }
  const files = attachments.map((a) => {
    const name = q(noCtl(a.filename)).replace(/"/g, "'");
    return `--${mixed}\r\nContent-Type: application/octet-stream; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(a.content.toString('base64'))}`;
  });
  return [...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}\r\nContent-Type: multipart/alternative; boundary="${alt}"\r\n\r\n${altBody}`, ...files, `--${mixed}--`].join('\r\n');
}

function classify(status, body, retryAfter) {
  const err = body?.error || {};
  const reason = err.errors?.[0]?.reason || err.status || '';
  const detail = `${status} ${reason} ${err.message ?? ''}`.trim();
  const E = (m, o) => new GmailError(m, { status, detail, retryAfter, ...o });
  if (/dailyLimitExceeded|quota/i.test(reason + err.message) && status !== 429) return E('Gmail daily sending limit reached. Try again tomorrow (about 500 emails/day for personal Gmail).', { fatal: true });
  if (status === 401) return E('Your Gmail connection is no longer valid. Reconnect Gmail in Settings.', { fatal: true, reauth: true });
  if (status === 403 && /insufficient|scope|accessNotConfigured/i.test(reason + err.message)) return E('Gmail sending permission is missing. Reconnect Gmail in Settings, or enable the Gmail API for your Google Cloud project.', { fatal: true });
  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded/i.test(reason)) return E('Gmail is rate limiting sends. Slowing down and retrying.', { retryable: true });
  if (status >= 500) return E('Gmail is having temporary problems. Please retry shortly.', { retryable: true });
  if (status === 400 && /recipient|address|invalid to/i.test(err.message || '')) return E('Invalid recipient address.');
  if (status === 413) return E('The message or its attachments are too large for Gmail.');
  return E('Gmail could not accept this email.');
}

export async function getConnection(userId) {
  return prisma.gmailConnection.findUnique({ where: { userId } });
}

/** Sends ONE email to ONE recipient from the user's own connected Gmail. Returns Gmail's message id. */
export async function sendEmail({ userId, to, subject, html, text, attachments = [], replyTo, fromName }) {
  const conn = await getConnection(userId); // always looked up by the server-side authenticated user id
  if (!conn) throw new GmailError('Connect your Gmail account in Settings before sending.', { fatal: true });
  if (conn.status !== 'active') throw new GmailError('Your Gmail connection has expired or was revoked. Reconnect Gmail in Settings.', { fatal: true });

  const raw = Buffer.from(buildMime({ from: { email: conn.gmailAddress, name: fromName }, to, replyTo, subject, html, text, attachments })).toString('base64url');

  for (let attempt = 0; ; attempt++) {
    try {
      const token = await getAccessToken(conn);
      let res;
      try {
        res = await fetch(SEND_URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ raw }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        throw new GmailError('Network error while contacting Gmail.', { retryable: true, detail: e.cause?.code || e.message });
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = classify(res.status, body, Number(res.headers.get('retry-after')) || 0);
        if (res.status === 401) forgetAccessToken(userId);
        if (res.status === 401 && attempt === 0) { err.retryable = true; err.fatal = false; } // one retry with a fresh token
        throw err;
      }
      return body.id ?? null;
    } catch (e) {
      console.error(`[gmail] send failed (attempt ${attempt + 1}): ${e.detail || e.message}`);
      if (!(e instanceof GmailError) || !e.retryable || attempt >= 2) {
        if (e instanceof GmailError && e.status === 401) { e.fatal = true; }
        throw e;
      }
      await new Promise((r) => setTimeout(r, Math.min(e.retryAfter * 1000 || 2 ** attempt * 1000, 10_000)));
    }
  }
}
