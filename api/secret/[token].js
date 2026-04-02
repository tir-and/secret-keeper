'use strict';

const { getSessionByP2Token } = require('../../lib/storage');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  const session = await getSessionByP2Token(token).catch((err) => {
    console.error('getSessionByP2Token error:', err);
    return null;
  });

  if (!session) {
    return res.status(404).json({ error: 'Session not found or expired.' });
  }

  return res.status(200).json({
    title: session.title,
    expiresAt: session.expires_at,
  });
};
