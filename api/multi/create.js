'use strict';

const { createMultiSession, cleanupExpiredMulti } = require('../../lib/storage-multi');
const { sendMultiPlayerInvite } = require('../../lib/email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, emails } = req.body ?? {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Session title is required.' });
  }

  if (!Array.isArray(emails) || emails.length < 2) {
    return res.status(400).json({ error: 'At least two player emails are required.' });
  }

  if (emails.length > 20) {
    return res.status(400).json({ error: 'Maximum 20 players per session.' });
  }

  const cleaned = emails.map(e => (typeof e === 'string' ? e.trim().toLowerCase() : ''));

  for (let i = 0; i < cleaned.length; i++) {
    if (!cleaned[i]) {
      return res.status(400).json({ error: `Player ${i + 1} email is required.` });
    }
    if (!EMAIL_RE.test(cleaned[i])) {
      return res.status(400).json({ error: `Player ${i + 1} has an invalid email address.` });
    }
  }

  const seen = new Set();
  for (let i = 0; i < cleaned.length; i++) {
    if (seen.has(cleaned[i])) {
      return res.status(400).json({ error: `Duplicate email: ${emails[i]}` });
    }
    seen.add(cleaned[i]);
  }

  cleanupExpiredMulti().catch(() => {});

  let session, participants;
  try {
    ({ session, participants } = await createMultiSession({
      title: title.trim(),
      emails: cleaned,
    }));
  } catch (err) {
    console.error('createMultiSession error:', err);
    return res.status(500).json({ error: 'Failed to create session. Please try again.' });
  }

  for (const p of participants) {
    sendMultiPlayerInvite(p.email, session.title, p.token, session.expires_at, participants.length)
      .catch(err => console.error('sendMultiPlayerInvite error for', p.email, ':', err));
  }

  return res.status(200).json({ playerCount: participants.length });
};
