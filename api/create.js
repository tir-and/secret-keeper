'use strict';

const { createSession, cleanupExpired } = require('../lib/storage');
const { sendP1Confirmation, sendP2InviteTo, sendObserverNotification } = require('../lib/email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { title, p1Secret, p1Email, p2Email, observerEmailsRaw, notifyObservers } = req.body ?? {};

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Session title is required.' });
  }
  if (!p1Secret || typeof p1Secret !== 'string' || !p1Secret.trim()) {
    return res.status(400).json({ error: 'Your secret is required.' });
  }
  if (!p1Email || typeof p1Email !== 'string' || !p1Email.trim()) {
    return res.status(400).json({ error: 'Your email address is required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p1Email.trim())) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (!p2Email || typeof p2Email !== 'string' || !p2Email.trim()) {
    return res.status(400).json({ error: "Respondent's email address is required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p2Email.trim())) {
    return res.status(400).json({ error: "Please enter a valid email address for the respondent." });
  }
  if (p1Email.trim().toLowerCase() === p2Email.trim().toLowerCase()) {
    return res.status(400).json({ error: 'Your email and the respondent\'s email must be different.' });
  }

  const observerEmails = typeof observerEmailsRaw === 'string'
    ? observerEmailsRaw.split(',').map((e) => e.trim()).filter(Boolean)
    : [];

  // Non-blocking cleanup
  cleanupExpired().catch(() => {});

  let session;
  try {
    session = await createSession({
      title: title.trim(),
      p1Secret: p1Secret.trim(),
      p1Email: p1Email.trim(),
      p2Email: p2Email.trim(),
      observerEmails,
      notifyObservers: Boolean(notifyObservers),
    });
  } catch (err) {
    console.error('createSession error:', err);
    return res.status(500).json({ error: 'Failed to create session. Please try again.' });
  }

  // Send P2 invite — critical: surface failure to the user
  try {
    await sendP2InviteTo(session.p2_email, session.title, session.p2_token, session.expires_at);
  } catch (err) {
    console.error('sendP2InviteTo error:', err);
    return res.status(500).json({ error: 'Session created but failed to send invite email. Please try again.' });
  }

  // Non-critical emails: fire and forget
  sendP1Confirmation(session.p1_email, session.title, session.p1_submitted_at).catch(() => {});
  if (Boolean(notifyObservers) && observerEmails.length > 0) {
    sendObserverNotification(observerEmails, session.title).catch(() => {});
  }

  return res.status(200).json({
    respondentEmail: session.p2_email,
    observerCount: observerEmails.length,
  });
};
