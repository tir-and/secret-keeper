'use strict';

const { getSessionByP2Token, getRevealByP2Token } = require('../../lib/storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  // Check awaiting session first
  const session = await getSessionByP2Token(token).catch(err => {
    console.error('getSessionByP2Token error:', err);
    return null;
  });

  if (session) {
    return res.status(200).json({
      title:     session.title,
      p2Email:   session.p2_email,
      expiresAt: session.expires_at,
    });
  }

  // Check revealed session — allows magic link to show results after submission
  const reveal = await getRevealByP2Token(token).catch(err => {
    console.error('getRevealByP2Token error:', err);
    return null;
  });

  if (reveal) {
    return res.status(200).json({
      revealed:      true,
      title:         reveal.title,
      logToken:      reveal.log_token,
      p1Email:       reveal.p1_email,
      p1Secret:      reveal.p1_secret,
      p1SubmittedAt: reveal.p1_submitted_at,
      p2Email:       reveal.p2_email,
      p2Secret:      reveal.p2_secret,
      p2SubmittedAt: reveal.p2_submitted_at,
    });
  }

  return res.status(404).json({ error: 'Session not found or expired.' });
};
