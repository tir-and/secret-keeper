'use strict';

const { neon } = require('@neondatabase/serverless');

function getDb() {
  return neon(process.env.DATABASE_URL);
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

async function checkIpRateLimit(ip, limit) {
  const sql = getDb();
  const rows = await sql`
    SELECT COUNT(*) AS cnt FROM rate_events
    WHERE kind = 'ip' AND key = ${ip}
      AND created_at > NOW() - INTERVAL '24 hours'
  `;
  return parseInt(rows[0].cnt, 10) >= limit;
}

// Returns the first email that is over the limit, or null if all are under.
async function checkRecipientRateLimits(emails, limit) {
  if (emails.length === 0) return null;
  const sql = getDb();
  const rows = await sql`
    SELECT key FROM rate_events
    WHERE kind = 'recipient' AND key = ANY(${emails})
      AND created_at > NOW() - INTERVAL '24 hours'
    GROUP BY key
    HAVING COUNT(*) >= ${limit}
    LIMIT 1
  `;
  return rows[0]?.key ?? null;
}

async function recordRateEvents(ip, recipientEmails) {
  const sql = getDb();
  await Promise.all([
    sql`INSERT INTO rate_events (kind, key) VALUES ('ip', ${ip})`,
    ...recipientEmails.map(e => sql`INSERT INTO rate_events (kind, key) VALUES ('recipient', ${e})`),
  ]);
}

async function pruneOldRateEvents() {
  const sql = getDb();
  await sql`DELETE FROM rate_events WHERE created_at < NOW() - INTERVAL '24 hours'`;
}

module.exports = { getClientIp, checkIpRateLimit, checkRecipientRateLimits, recordRateEvents, pruneOldRateEvents };
