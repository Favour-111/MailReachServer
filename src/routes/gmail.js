// Connect / disconnect the logged-in user's Gmail account (Google OAuth 2.0, authorization-code flow + PKCE).
// This is NOT a login method: the app session still comes from the existing JWT cookie.
import crypto from 'node:crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { encrypt, decrypt } from '../crypto.js';
import { requireAuth } from '../middleware.js';
import { GmailError, buildAuthUrl, exchangeCode, forgetAccessToken, getConnection, isOAuthConfigured, newPkce, revokeToken } from '../services/gmail.service.js';

const router = Router();
const STATE_COOKIE = 'mr_gstate';
const back = (res, params) => res.redirect(`${config.clientUrl}/settings?${new URLSearchParams(params)}`);
const publicConn = (c) => (c ? { email: c.gmailAddress, status: c.status, connectedAt: c.createdAt } : null);

router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json({ oauthConfigured: isOAuthConfigured(), connection: publicConn(await getConnection(req.userId)) });
});

// Returns the Google consent URL. The browser then navigates to it.
router.post('/connect', async (req, res) => {
  if (!isOAuthConfigured()) return res.status(503).json({ error: 'Gmail connection is not configured on the server yet' });
  const state = crypto.randomBytes(24).toString('base64url');
  const { verifier, challenge } = newPkce();
  // State, PKCE verifier and the initiating user are sealed in a short-lived httpOnly cookie; the callback must match all three.
  res.cookie(STATE_COOKIE, jwt.sign({ sub: req.userId, state, verifier }, config.jwtSecret, { expiresIn: '10m' }), {
    httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 10 * 60_000, path: '/api/gmail',
  });
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } });
  res.json({ url: buildAuthUrl({ state, challenge, loginHint: user?.email }) });
});

router.get('/callback', async (req, res) => {
  const sealed = req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/api/gmail' });
  try {
    if (req.query.error) return back(res, { gmail: 'error', reason: req.query.error === 'access_denied' ? 'You cancelled the Google permission screen.' : 'Google returned an error.' });
    let sealedData;
    try { sealedData = jwt.verify(sealed || '', config.jwtSecret); } catch { sealedData = null; }
    const state = String(req.query.state || '');
    const ok = sealedData && sealedData.sub === req.userId && sealedData.state.length === state.length
      && crypto.timingSafeEqual(Buffer.from(sealedData.state), Buffer.from(state));
    if (!ok || !req.query.code) return back(res, { gmail: 'error', reason: 'The connection request expired or did not match your session. Please try again.' });

    const t = await exchangeCode(String(req.query.code), sealedData.verifier);
    const data = { gmailAddress: t.email, refreshTokenEnc: encrypt(t.refreshToken), status: 'active' };
    await prisma.gmailConnection.upsert({ where: { userId: req.userId }, create: { userId: req.userId, ...data }, update: data });
    forgetAccessToken(req.userId);
    back(res, { gmail: 'connected' });
  } catch (e) {
    console.error('[gmail] connect failed:', e.detail || e.message);
    back(res, { gmail: 'error', reason: e instanceof GmailError ? e.userMessage : 'Could not connect Gmail. Please try again.' });
  }
});

router.post('/disconnect', async (req, res) => {
  const conn = await getConnection(req.userId);
  if (conn) {
    await prisma.gmailConnection.delete({ where: { userId: req.userId } });
    forgetAccessToken(req.userId);
    try { await revokeToken(decrypt(conn.refreshTokenEnc)); } catch { /* already deleted locally */ }
  }
  res.json({ ok: true });
});

export default router;
