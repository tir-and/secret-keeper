'use strict';

const { getMultiSessionByLogToken, garbleEmail } = require('../../../lib/storage-multi');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { logToken } = req.query;
  if (!logToken) {
    return res.status(400).json({ error: 'Log token is required.' });
  }

  const session = await getMultiSessionByLogToken(logToken).catch(err => {
    console.error('getMultiSessionByLogToken error:', err);
    return null;
  });

  if (!session) {
    return res.status(404).json({ error: 'This log is unavailable or has expired.' });
  }

  return res.status(200).json({
    title: session.title,
    participants: session.participants.map(p => ({
      ...p,
      email: garbleEmail(p.email),
    })),
  });
};
