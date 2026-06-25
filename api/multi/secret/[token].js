'use strict';

const { getParticipantByToken, getSessionStatus } = require('../../../lib/storage-multi');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Token is required.' });
  }

  const participant = await getParticipantByToken(token).catch(err => {
    console.error('getParticipantByToken error:', err);
    return null;
  });

  if (!participant) {
    return res.status(404).json({ error: 'Session not found.' });
  }

  const sessionRevealed  = participant.status === 'revealed';
  const alreadySubmitted = participant.submitted_at !== null;

  // Awaiting but past expiry
  if (!sessionRevealed && new Date(participant.expires_at) < new Date()) {
    return res.status(410).json({ error: 'This session has expired.' });
  }

  let status = null;
  if (alreadySubmitted || sessionRevealed) {
    status = await getSessionStatus(token).catch(() => null);
  }

  return res.status(200).json({
    title:          participant.title,
    expiresAt:      participant.expires_at,
    alreadySubmitted,
    sessionRevealed,
    status,
  });
};
