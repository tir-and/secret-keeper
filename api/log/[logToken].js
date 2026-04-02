'use strict';

const { getSessionByLogToken } = require('../../lib/storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { logToken } = req.query;

  if (!logToken) {
    return res.status(400).json({ error: 'Log token is required.' });
  }

  const session = await getSessionByLogToken(logToken).catch((err) => {
    console.error('getSessionByLogToken error:', err);
    return null;
  });

  if (!session) {
    return res.status(404).json({ error: 'This log is unavailable or has expired.' });
  }

  return res.status(200).json({
    title:         session.title,
    revealedAt:    session.revealed_at,
    p1Email:       session.p1_email,
    p1SubmittedAt: session.p1_submitted_at,
    p1Secret:      session.p1_secret,
    p2Email:       session.p2_email,
    p2SubmittedAt: session.p2_submitted_at,
    p2Secret:      session.p2_secret,
  });
};
