'use strict';

const { revealSession, getSessionByP2Token, cleanupExpired } = require('../lib/storage');
const { sendFinalReveal } = require('../lib/email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, p2Secret } = req.body ?? {};

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token is required.' });
  }
  if (!p2Secret || typeof p2Secret !== 'string' || !p2Secret.trim()) {
    return res.status(400).json({ error: 'Your secret is required.' });
  }

  // Non-blocking cleanup
  cleanupExpired().catch(() => {});

  // Look up the session to get p2_email — it was set when P1 created the session
  const session = await getSessionByP2Token(token).catch(() => null);
  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  let result;
  try {
    result = await revealSession({
      p2Token: token,
      p2Secret: p2Secret.trim(),
      p2Email: session.p2_email,
    });
  } catch (err) {
    console.error('revealSession error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  if (result.error === 'not_found') {
    return res.status(404).json({ error: 'Session not found.' });
  }
  if (result.error === 'already_used') {
    return res.status(410).json({ error: 'This link has already been used.' });
  }
  if (result.error === 'expired') {
    return res.status(410).json({ error: 'This link has expired.' });
  }

  const s = result.session;

  let emailWarning = false;
  try {
    await sendFinalReveal({
      p1Email:        s.p1_email,
      p2Email:        s.p2_email,
      observerEmails: s.observer_emails,
      title:          s.title,
      p1Secret:       s.p1_secret,
      p2Secret:       s.p2_secret,
      logToken:       s.log_token,
      p1SubmittedAt:  s.p1_submitted_at,
      p2SubmittedAt:  s.p2_submitted_at,
    });
  } catch (err) {
    console.error('sendFinalReveal error:', err);
    emailWarning = true;
  }

  return res.status(200).json({
    ok: true,
    emailWarning,
    reveal: {
      title:         s.title,
      logToken:      s.log_token,
      p1Email:       s.p1_email,
      p1Secret:      s.p1_secret,
      p1SubmittedAt: s.p1_submitted_at,
      p2Email:       s.p2_email,
      p2Secret:      s.p2_secret,
      p2SubmittedAt: s.p2_submitted_at,
    },
  });
};
