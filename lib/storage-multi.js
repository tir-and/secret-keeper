'use strict';

const { neon, Pool } = require('@neondatabase/serverless');
const { randomBytes } = require('crypto');
const { garbleEmail } = require('./garble');

function getDb() {
  return neon(process.env.DATABASE_URL);
}

async function createMultiSession({ title, emails, creatorSecret }) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [session] } = await client.query(
      `INSERT INTO multi_sessions (title) VALUES ($1) RETURNING *`,
      [title]
    );

    const participants = [];
    for (let i = 0; i < emails.length; i++) {
      const token = randomBytes(32).toString('hex');
      // Position 1 (i === 0) is the creator — pre-commit their secret immediately
      const isCreator = i === 0 && creatorSecret;
      const { rows: [p] } = isCreator
        ? await client.query(
            `INSERT INTO multi_participants (session_id, email, token, position, secret, submitted_at)
             VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
            [session.id, emails[i], token, i + 1, creatorSecret]
          )
        : await client.query(
            `INSERT INTO multi_participants (session_id, email, token, position)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [session.id, emails[i], token, i + 1]
          );
      participants.push(p);
    }

    await client.query('COMMIT');
    return { session, participants };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function getParticipantByToken(token) {
  const sql = getDb();
  const rows = await sql`
    SELECT p.id, p.email, p.token, p.submitted_at, p.position,
           s.id            AS session_id,
           s.title,
           s.status,
           s.expires_at,
           s.log_token,
           s.log_expires_at
    FROM multi_participants p
    JOIN multi_sessions s ON s.id = p.session_id
    WHERE p.token = ${token}
  `;
  return rows[0] ?? null;
}

async function getSessionStatus(token) {
  const sql = getDb();

  const rows = await sql`
    SELECT s.id, s.title, s.status, s.log_token
    FROM multi_sessions s
    JOIN multi_participants p ON p.session_id = s.id
    WHERE p.token = ${token}
  `;
  if (!rows[0]) return null;
  const session = rows[0];

  const participants = await sql`
    SELECT email, submitted_at, position
    FROM multi_participants
    WHERE session_id = ${session.id}
    ORDER BY position
  `;

  const submitted = participants.filter(p => p.submitted_at !== null).length;

  return {
    title: session.title,
    logToken: session.log_token,
    submitted,
    total: participants.length,
    participants: participants.map(p => ({
      email: garbleEmail(p.email),
      submitted: p.submitted_at !== null,
    })),
  };
}

async function submitMultiSecret({ token, secret }) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE locks both participant and session rows — prevents double-submit
    // and serialises the "last one triggers reveal" check
    const { rows } = await client.query(
      `SELECT p.id AS pid, p.email, p.submitted_at, p.position,
              s.id AS sid, s.title, s.status, s.expires_at
       FROM multi_participants p
       JOIN multi_sessions s ON s.id = p.session_id
       WHERE p.token = $1
       FOR UPDATE`,
      [token]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'not_found' };
    }

    const row = rows[0];

    if (row.status !== 'awaiting') {
      await client.query('ROLLBACK');
      return { error: 'already_revealed' };
    }

    if (new Date(row.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return { error: 'expired' };
    }

    if (row.submitted_at !== null) {
      await client.query('ROLLBACK');
      return { error: 'already_submitted' };
    }

    await client.query(
      `UPDATE multi_participants SET secret = $1, submitted_at = NOW() WHERE token = $2`,
      [secret, token]
    );

    // Count remaining unsubmitted (this participant is now submitted)
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*) AS cnt FROM multi_participants
       WHERE session_id = $1 AND submitted_at IS NULL`,
      [row.sid]
    );
    const remaining = parseInt(countRows[0].cnt, 10);

    let logToken = null;

    if (remaining === 0) {
      logToken = randomBytes(32).toString('hex');
      await client.query(
        `UPDATE multi_sessions
         SET status = 'revealed', log_token = $1, log_expires_at = NOW() + INTERVAL '14 days'
         WHERE id = $2`,
        [logToken, row.sid]
      );
    }

    // Fetch all participants (needed for reveal email and status response)
    const { rows: allParticipants } = await client.query(
      `SELECT email, secret, submitted_at, position
       FROM multi_participants
       WHERE session_id = $1
       ORDER BY position`,
      [row.sid]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      revealed: remaining === 0,
      logToken,
      title: row.title,
      participants: allParticipants,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function getMultiSessionByLogToken(logToken) {
  const sql = getDb();

  const rows = await sql`
    SELECT id, title
    FROM multi_sessions
    WHERE log_token = ${logToken}
      AND status = 'revealed'
      AND log_expires_at > NOW()
  `;
  if (!rows[0]) return null;
  const session = rows[0];

  const participants = await sql`
    SELECT email, secret, submitted_at, position
    FROM multi_participants
    WHERE session_id = ${session.id}
    ORDER BY position
  `;

  return {
    title: session.title,
    participants: participants.map(p => ({
      email: garbleEmail(p.email),
      secret: p.secret,
      submittedAt: p.submitted_at,
      position: p.position,
    })),
  };
}

// Claims expired awaiting multi-sessions for notification. Returns an array of sessions,
// each with a `participants` array showing who submitted and who didn't.
// Uses DELETE ... RETURNING so each session is processed exactly once.
async function claimExpiredMultiSessions() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: sessions } = await client.query(`
      DELETE FROM multi_sessions
      WHERE status = 'awaiting' AND expires_at < NOW()
      RETURNING id, title
    `);

    if (sessions.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    // Participants are already deleted by CASCADE; fetch them before the parent delete
    // by querying within the same transaction (rows are still visible until COMMIT).
    // Actually, since we DELETEd sessions first and CASCADE fires immediately,
    // participants are gone. We need to fetch participants before deleting sessions.
    // Restructure: SELECT participants first, then DELETE sessions.
    await client.query('ROLLBACK');

    // Redo without delete-first: lock, fetch, then delete.
    await client.query('BEGIN');
    const { rows: expiredSessions } = await client.query(`
      SELECT id, title FROM multi_sessions
      WHERE status = 'awaiting' AND expires_at < NOW()
      FOR UPDATE
    `);

    if (expiredSessions.length === 0) {
      await client.query('COMMIT');
      return [];
    }

    const sessionIds = expiredSessions.map(s => s.id);

    const { rows: allParticipants } = await client.query(`
      SELECT session_id, email, submitted_at
      FROM multi_participants
      WHERE session_id = ANY($1)
      ORDER BY position
    `, [sessionIds]);

    await client.query(`DELETE FROM multi_sessions WHERE id = ANY($1)`, [sessionIds]);

    await client.query('COMMIT');

    return expiredSessions.map(s => ({
      title: s.title,
      participants: allParticipants
        .filter(p => p.session_id === s.id)
        .map(p => ({ email: p.email, submitted: p.submitted_at !== null })),
    }));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function cleanupExpiredMulti() {
  const sql = getDb();
  // Only delete revealed sessions past retention; cron handles awaiting-expired (with notification email).
  // ON DELETE CASCADE on multi_participants.session_id handles child rows automatically.
  await sql`
    DELETE FROM multi_sessions
    WHERE status = 'revealed' AND log_expires_at < NOW()
  `;
}

module.exports = {
  createMultiSession,
  claimExpiredMultiSessions,
  getParticipantByToken,
  getSessionStatus,
  submitMultiSecret,
  getMultiSessionByLogToken,
  cleanupExpiredMulti,
};
