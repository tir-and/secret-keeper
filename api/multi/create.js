'use strict';

const { createMultiSession, cleanupExpiredMulti } = require('../../lib/storage-multi');
const { sendMultiPlayerInvite } = require('../../lib/email');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, creatorEmail, creatorSecret, emails } = req.body ?? {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Session title is required.' });
  }
  if (!creatorSecret || typeof creatorSecret !== 'string' || !creatorSecret.trim()) {
    return res.status(400).json({ error: 'Your secret is required.' });
  }
  if (!creatorEmail || typeof creatorEmail !== 'string' || !creatorEmail.trim()) {
    return res.status(400).json({ error: 'Your email address is required.' });
  }
  const cleanedCreator = creatorEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(cleanedCreator)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (!Array.isArray(emails) || emails.length < 1) {
    return res.status(400).json({ error: 'At least one other player email is required.' });
  }
  if (emails.length > 19) {
    return res.status(400).json({ error: 'Maximum 20 players per session.' });
  }

  const cleanedOthers = emails.map(e => (typeof e === 'string' ? e.trim().toLowerCase() : ''));

  for (let i = 0; i < cleanedOthers.length; i++) {
    if (!cleanedOthers[i]) {
      return res.status(400).json({ error: `Player ${i + 2} email is required.` });
    }
    if (!EMAIL_RE.test(cleanedOthers[i])) {
      return res.status(400).json({ error: `Player ${i + 2} has an invalid email address.` });
    }
  }

  const allEmails = [cleanedCreator, ...cleanedOthers];
  const seen = new Set();
  for (const email of allEmails) {
    if (seen.has(email)) {
      return res.status(400).json({ error: `Duplicate email: ${email}` });
    }
    seen.add(email);
  }

  cleanupExpiredMulti().catch(() => {});

  let session, participants;
  try {
    ({ session, participants } = await createMultiSession({
      title:         title.trim(),
      emails:        allEmails,
      creatorSecret: creatorSecret.trim(),
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
