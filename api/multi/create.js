'use strict';

const { createMultiSession, cleanupExpiredMulti } = require('../../lib/storage-multi');
const { sendMultiCreatorConfirmation, sendMultiPlayerInvite } = require('../../lib/email');
const { getClientIp, checkIpRateLimit, checkRecipientRateLimits, recordRateEvents, pruneOldRateEvents } = require('../../lib/ratelimit');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, creatorEmail, creatorSecret, emails } = req.body ?? {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Session title is required.' });
  }
  if (title.trim().length > 120) {
    return res.status(400).json({ error: 'Session title must be 120 characters or fewer.' });
  }
  if (!creatorSecret || typeof creatorSecret !== 'string' || !creatorSecret.trim()) {
    return res.status(400).json({ error: 'Your secret is required.' });
  }
  if (creatorSecret.trim().length > 2000) {
    return res.status(400).json({ error: 'Secret must be 2000 characters or fewer.' });
  }
  if (!creatorEmail || typeof creatorEmail !== 'string' || !creatorEmail.trim()) {
    return res.status(400).json({ error: 'Your email address is required.' });
  }
  if (creatorEmail.trim().length > 254) {
    return res.status(400).json({ error: 'Email address is too long.' });
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
    if (cleanedOthers[i].length > 254) {
      return res.status(400).json({ error: `Player ${i + 2} email address is too long.` });
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

  // Rate limiting
  const ip = getClientIp(req);
  if (await checkIpRateLimit(ip, 10)) {
    return res.status(429).json({ error: 'Too many sessions created from this address. Please try again tomorrow.' });
  }
  const blockedRecipient = await checkRecipientRateLimits(allEmails, 20);
  if (blockedRecipient) {
    return res.status(429).json({ error: 'Too many invites sent to one or more recipients. Please try again tomorrow.' });
  }

  cleanupExpiredMulti().catch(() => {});
  pruneOldRateEvents().catch(() => {});

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

  const sendResults = await Promise.allSettled(
    participants.map((p, i) =>
      i === 0
        ? sendMultiCreatorConfirmation(p.email, session.title, p.token, session.expires_at, participants.length, p.submitted_at)
        : sendMultiPlayerInvite(p.email, session.title, p.token, session.expires_at, participants.length)
    )
  );

  const emailFailures = sendResults
    .map((r, i) => r.status === 'rejected' ? participants[i].email : null)
    .filter(Boolean);

  if (emailFailures.length > 0) {
    console.error('sendMultiPlayerInvite failed for:', emailFailures);
  }

  // Record rate events after confirmed session creation
  recordRateEvents(ip, allEmails).catch(() => {});

  return res.status(200).json({
    playerCount: participants.length,
    emailFailures: emailFailures.length > 0 ? emailFailures : undefined,
  });
};
