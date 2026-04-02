'use strict';

const { revealSession, cleanupExpired } = require('../lib/storage');
const { sendFinalReveal } = require('../lib/email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, p2Secret, p2Email } = req.body ?? {};

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token is required.' });
  }
  if (!p2Secret || typeof p2Secret !== 'string' || !p2Secret.trim()) {
    return res.status(400).json({ error: 'Your secret is required.' });
  }
  if (!p2Email || typeof p2Email !== 'string' || !p2Email.trim()) {
    return res.status(400).json({ error: 'Your email address is required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p2Email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // Non-blocking cleanup
  cleanupExpired().catch(() => {});

  let result;
  try {
    result = await revealSession({
      p2Token: token,
      p2Secret: p2Secret.trim(),
      p2Email: p2Email.trim(),
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

  // Send final reveal to all parties — non-blocking, reveal is already committed
  sendFinalReveal({
    p1Email:       s.p1_email,
    p2Email:       s.p2_email,
    observerEmails: s.observer_emails,
    title:         s.title,
    p1Secret:      s.p1_secret,
    p2Secret:      s.p2_secret,
    logToken:      s.log_token,
    p1SubmittedAt: s.p1_submitted_at,
    p2SubmittedAt: s.p2_submitted_at,
  }).catch(() => {});

  return res.status(200).json({ ok: true });
};
