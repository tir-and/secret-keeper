'use strict';

const { neon, neonConfig } = require('@neondatabase/serverless');

neonConfig.fetchConnectionCache = true;

function getDb() {
  return neon(process.env.DATABASE_URL);
}

let tableReady = false;

async function ensureTable() {
  if (tableReady) return;
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id               SERIAL PRIMARY KEY,
      title            TEXT NOT NULL,
      p1_secret        TEXT NOT NULL,
      p1_email         TEXT NOT NULL,
      p2_email         TEXT NOT NULL,
      observer_emails  TEXT[] NOT NULL DEFAULT '{}',
      notify_observers BOOLEAN NOT NULL DEFAULT false,
      p2_token         TEXT NOT NULL UNIQUE,
      log_token        TEXT UNIQUE,
      status           TEXT NOT NULL DEFAULT 'awaiting',
      p2_secret        TEXT,
      p1_submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      p2_submitted_at  TIMESTAMPTZ,
      revealed_at      TIMESTAMPTZ,
      expires_at       TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
      log_expires_at   TIMESTAMPTZ
    )
  `;
  tableReady = true;
}

async function createSession({ title, p1Secret, p1Email, p2Email, observerEmails, notifyObservers }) {
  await ensureTable();
  const { randomBytes } = require('crypto');
  const p2Token = randomBytes(32).toString('hex');
  const sql = getDb();
  const rows = await sql`
    INSERT INTO sessions
      (title, p1_secret, p1_email, p2_email, observer_emails, notify_observers, p2_token)
    VALUES
      (${title}, ${p1Secret}, ${p1Email}, ${p2Email}, ${observerEmails}, ${notifyObservers}, ${p2Token})
    RETURNING *
  `;
  return rows[0];
}

async function getSessionByP2Token(p2Token) {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`
    SELECT id, title, p2_email, expires_at
    FROM sessions
    WHERE p2_token = ${p2Token}
      AND status = 'awaiting'
      AND expires_at > NOW()
  `;
  return rows[0] ?? null;
}

async function revealSession({ p2Token, p2Secret, p2Email }) {
  await ensureTable();
  const { randomBytes } = require('crypto');
  const { Pool } = require('@neondatabase/serverless');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM sessions WHERE p2_token = $1 FOR UPDATE`,
      [p2Token]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'not_found' };
    }

    const session = rows[0];

    if (session.status !== 'awaiting') {
      await client.query('ROLLBACK');
      return { error: 'already_used' };
    }

    if (new Date(session.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return { error: 'expired' };
    }

    const logToken = randomBytes(32).toString('hex');

    const { rows: updated } = await client.query(
      `UPDATE sessions
       SET status          = 'revealed',
           p2_secret       = $1,
           p2_email        = $2,
           p2_submitted_at = NOW(),
           revealed_at     = NOW(),
           log_token       = $3,
           log_expires_at  = NOW() + INTERVAL '14 days'
       WHERE id = $4
       RETURNING *`,
      [p2Secret, p2Email, logToken, session.id]
    );

    await client.query('COMMIT');
    return { session: updated[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

async function getSessionByLogToken(logToken) {
  await ensureTable();
  const sql = getDb();
  const rows = await sql`
    SELECT title, p1_email, p2_email, p1_secret, p2_secret,
           p1_submitted_at, p2_submitted_at, revealed_at
    FROM sessions
    WHERE log_token = ${logToken}
      AND status = 'revealed'
      AND log_expires_at > NOW()
  `;
  return rows[0] ?? null;
}

async function cleanupExpired() {
  const sql = getDb();
  await sql`
    DELETE FROM sessions
    WHERE (status = 'awaiting' AND expires_at < NOW())
       OR (status = 'revealed' AND log_expires_at < NOW())
  `;
}

module.exports = {
  createSession,
  getSessionByP2Token,
  revealSession,
  getSessionByLogToken,
  cleanupExpired,
};
  tableReady = true;
}

async function createSession({ title, p1Secret, p1Email, p2Email, observerEmails, notifyObservers }) {
  await ensureTable();
  const p2Token = randomBytes(32).toString('hex');
  const client = await db.connect();
  try {
    const { rows } = await client.query(
      `INSERT INTO sessions
         (title, p1_secret, p1_email, p2_email, observer_emails, notify_observers, p2_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [title, p1Secret, p1Email, p2Email, observerEmails, notifyObservers, p2Token]
    );
    return rows[0];
  } finally {
    client.release();
  }
}

async function getSessionByP2Token(p2Token) {
  await ensureTable();
  const { rows } = await sql`
    SELECT id, title, p2_email, expires_at
    FROM sessions
    WHERE p2_token = ${p2Token}
      AND status = 'awaiting'
      AND expires_at > NOW()
  `;
  return rows[0] ?? null;
}

async function revealSession({ p2Token, p2Secret, p2Email }) {
  await ensureTable();
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM sessions WHERE p2_token = $1 FOR UPDATE`,
      [p2Token]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return { error: 'not_found' };
    }

    const session = rows[0];

    if (session.status !== 'awaiting') {
      await client.query('ROLLBACK');
      return { error: 'already_used' };
    }

    if (new Date(session.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return { error: 'expired' };
    }

    const logToken = randomBytes(32).toString('hex');

    const { rows: updated } = await client.query(
      `UPDATE sessions
       SET status          = 'revealed',
           p2_secret       = $1,
           p2_email        = $2,
           p2_submitted_at = NOW(),
           revealed_at     = NOW(),
           log_token       = $3,
           log_expires_at  = NOW() + INTERVAL '14 days'
       WHERE id = $4
       RETURNING *`,
      [p2Secret, p2Email, logToken, session.id]
    );

    await client.query('COMMIT');
    return { session: updated[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getSessionByLogToken(logToken) {
  await ensureTable();
  const { rows } = await sql`
    SELECT title, p1_email, p2_email, p1_secret, p2_secret,
           p1_submitted_at, p2_submitted_at, revealed_at
    FROM sessions
    WHERE log_token = ${logToken}
      AND status = 'revealed'
      AND log_expires_at > NOW()
  `;
  return rows[0] ?? null;
}

async function cleanupExpired() {
  await sql`
    DELETE FROM sessions
    WHERE (status = 'awaiting' AND expires_at < NOW())
       OR (status = 'revealed' AND log_expires_at < NOW())
  `;
}

module.exports = {
  createSession,
  getSessionByP2Token,
  revealSession,
  getSessionByLogToken,
  cleanupExpired,
};
