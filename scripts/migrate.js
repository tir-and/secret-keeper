'use strict';

// Run with: npm run migrate
// Requires DATABASE_URL in environment (set in .env or export before running).
// WARNING: drops and recreates all tables — dev use only until real migrations are needed.

const { neon } = require('@neondatabase/serverless');

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  const sql = neon(url);

  console.log('Dropping existing tables...');
  await sql`DROP TABLE IF EXISTS multi_participants CASCADE`;
  await sql`DROP TABLE IF EXISTS multi_sessions CASCADE`;
  await sql`DROP TABLE IF EXISTS sessions CASCADE`;
  await sql`DROP TABLE IF EXISTS rate_events CASCADE`;

  console.log('Creating sessions...');
  await sql`
    CREATE TABLE sessions (
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

  console.log('Creating multi_sessions...');
  await sql`
    CREATE TABLE multi_sessions (
      id             SERIAL PRIMARY KEY,
      title          TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'awaiting',
      log_token      TEXT UNIQUE,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
      log_expires_at TIMESTAMPTZ
    )
  `;

  console.log('Creating multi_participants...');
  await sql`
    CREATE TABLE multi_participants (
      id           SERIAL PRIMARY KEY,
      session_id   INTEGER NOT NULL REFERENCES multi_sessions(id) ON DELETE CASCADE,
      email        TEXT NOT NULL,
      token        TEXT NOT NULL UNIQUE,
      secret       TEXT,
      submitted_at TIMESTAMPTZ,
      position     INTEGER NOT NULL
    )
  `;

  console.log('Creating rate_events...');
  await sql`
    CREATE TABLE rate_events (
      id         SERIAL PRIMARY KEY,
      kind       TEXT NOT NULL,
      key        TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX ON rate_events (kind, key, created_at)`;

  console.log('Migration complete.');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
