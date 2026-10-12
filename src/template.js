// {{variable}} substitution + HTML sanitising. The client has a matching copy in client/src/lib/vars.js.
import sanitizeHtml from 'sanitize-html';

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const normalizeKey = (k) => String(k).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

export function renderTemplate(str, vars, { html = false } = {}) {
  return str.replace(VAR_RE, (_, key) => {
    const v = String(vars[key.toLowerCase()] ?? '').replace(/[\r\n]+/g, ' ');
    return html ? escapeHtml(v) : v;
  });
}

export function recipientVars(r, senderName) {
  const extra = {};
  for (const [k, v] of Object.entries(r.data || {})) extra[normalizeKey(k)] = v;
  return { ...extra, name: r.name, email: r.email, company: r.company, position: r.position, sender_name: senderName };
}

export function sanitizeBody(html) {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'blockquote'],
    allowedAttributes: { a: ['href', 'target', 'rel'], '*': ['style'] },
    allowedStyles: { '*': { 'text-align': [/^(left|right|center|justify)$/] } },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
  });
}

export function htmlToText(html) {
  const withBreaks = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-3]|blockquote)>/gi, '\n');
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}
