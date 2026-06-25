'use strict';

const { getSessionStatus } = require('../../../lib/storage-multi');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  const status = await getSessionStatus(token).catch(err => {
    console.error('getSessionStatus error:', err);
    return null;
  });

  if (!status) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  return res.status(200).json(status);
};
