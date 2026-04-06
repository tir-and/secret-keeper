'use strict';

const { submitMultiSecret, garbleEmail } = require('../../lib/storage-multi');
const { sendMultiPlayerReveal } = require('../../lib/email');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, secret } = req.body ?? {};

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token is required.' });
  }
  if (!secret || typeof secret !== 'string' || !secret.trim()) {
    return res.status(400).json({ error: 'Your secret is required.' });
  }

  let result;
  try {
    result = await submitMultiSecret({ token, secret: secret.trim() });
  } catch (err) {
    console.error('submitMultiSecret error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  if (result.error === 'not_found')        return res.status(404).json({ error: 'Session not found.' });
  if (result.error === 'already_revealed') return res.status(410).json({ error: 'This session has already been revealed.' });
  if (result.error === 'expired')          return res.status(410).json({ error: 'This session has expired.' });
  if (result.error === 'already_submitted') return res.status(409).json({ error: 'You have already submitted your secret.' });

  if (result.revealed) {
    sendMultiPlayerReveal({
      participants: result.participants,
      title:        result.title,
      logToken:     result.logToken,
    }).catch(err => console.error('sendMultiPlayerReveal error:', err));
  }

  const submitted = result.participants.filter(p => p.submitted_at !== null).length;

  return res.status(200).json({
    ok: true,
    status: {
      title:    result.title,
      logToken: result.logToken,
      submitted,
      total:    result.participants.length,
      participants: result.participants.map(p => ({
        email:     garbleEmail(p.email),
        submitted: p.submitted_at !== null,
      })),
    },
  });
};
