'use strict';

const { claimExpiredSessions, cleanupExpired } = require('../../lib/storage');
const { claimExpiredMultiSessions, cleanupExpiredMulti } = require('../../lib/storage-multi');
const { sendExpiryNoticeTwoPlayer, sendExpiryNoticeMulti } = require('../../lib/email');

module.exports = async function handler(req, res) {
  // Vercel Cron authenticates requests with CRON_SECRET in the Authorization header.
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = { twoPlayer: 0, multi: 0, errors: [] };

  // --- 2-player expired sessions ---
  let expiredSessions = [];
  try {
    expiredSessions = await claimExpiredSessions();
  } catch (err) {
    console.error('claimExpiredSessions error:', err);
    results.errors.push('claim_2player_failed');
  }

  for (const s of expiredSessions) {
    try {
      await sendExpiryNoticeTwoPlayer({
        p1Email:       s.p1_email,
        p2Email:       s.p2_email,
        title:         s.title,
        p1SubmittedAt: s.p1_submitted_at,
      });
      results.twoPlayer++;
    } catch (err) {
      // Row is already deleted — log and move on; the session is gone regardless.
      console.error('sendExpiryNoticeTwoPlayer error for', s.title, err);
      results.errors.push(`expiry_email_2player:${s.title}`);
    }
  }

  // --- Multi-player expired sessions ---
  let expiredMulti = [];
  try {
    expiredMulti = await claimExpiredMultiSessions();
  } catch (err) {
    console.error('claimExpiredMultiSessions error:', err);
    results.errors.push('claim_multi_failed');
  }

  for (const s of expiredMulti) {
    try {
      await sendExpiryNoticeMulti({ participants: s.participants, title: s.title });
      results.multi++;
    } catch (err) {
      console.error('sendExpiryNoticeMulti error for', s.title, err);
      results.errors.push(`expiry_email_multi:${s.title}`);
    }
  }

  // --- Delete revealed sessions past log retention ---
  cleanupExpired().catch(err => console.error('cleanupExpired error:', err));
  cleanupExpiredMulti().catch(err => console.error('cleanupExpiredMulti error:', err));

  return res.status(200).json(results);
};
