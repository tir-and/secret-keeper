'use strict';

const { neon, Pool } = require('@neondatabase/serverless');
const { randomBytes } = require('crypto');

function getDb() {
  return neon(process.env.DATABASE_URL);
}

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS multi_sessions (
      id             SERIAL PRIMARY KEY,
      title          TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'awaiting',
      log_token      TEXT UNIQUE,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
      log_expires_at TIMESTAMPTZ
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS multi_participants (
      id           SERIAL PRIMARY KEY,
      session_id   INTEGER NOT NULL REFERENCES multi_sessions(id),
      email        TEXT NOT NULL,
      token        TEXT NOT NULL UNIQUE,
      secret       TEXT,
      submitted_at TIMESTAMPTZ,
      position     INTEGER NOT NULL
    )
  `;
  tableReady = true;
}

function garbleEmail(email) {
  const [local] = email.split('@');
  return `${local}@xxxxxx`;
}

async function createMultiSession({ title, emails, creatorSecret }) {
  await ensureTable();
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
  await ensureTable();
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
  await ensureTable();
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
  await ensureTable();
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
  await ensureTable();
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
      email: p.email,
      secret: p.secret,
      submittedAt: p.submitted_at,
      position: p.position,
    })),
  };
}

async function cleanupExpiredMulti() {
  await ensureTable();
  const sql = getDb();
  await sql`
    DELETE FROM multi_sessions
    WHERE (status = 'awaiting' AND expires_at < NOW())
       OR (status = 'revealed' AND log_expires_at < NOW())
  `;
}

module.exports = {
  createMultiSession,
  getParticipantByToken,
  getSessionStatus,
  submitMultiSecret,
  getMultiSessionByLogToken,
  cleanupExpiredMulti,
  garbleEmail,
};
