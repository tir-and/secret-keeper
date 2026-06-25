# Secret Keeper

A lightweight web app that solves the simultaneous reveal problem in play-by-email (PBEM) board games. Two players commit to a hidden secret independently — neither can see the other's secret until both have submitted. Secrets are revealed simultaneously by email.

Also supports **multi-player mode** (up to 20 players) with the same atomic-reveal guarantee: no one sees anything until everyone has submitted.

No accounts. No passwords. All access via magic links.

**Live:** https://secretkeeper.win
**Repo:** https://github.com/tir-and/secret-keeper

---

## How it works

### 2-player
1. **Player 1** enters a session title, their secret, and both players' email addresses
2. Player 1's secret is **escrowed immediately** — locked and immutable
3. **Player 2** receives a magic link by email and has 7 days to submit their secret
4. The moment Player 2 submits, both secrets are **revealed simultaneously** and emailed to all participants
5. A **verification log** is available for 14 days proving neither secret was altered after submission

If Player 2 does not respond within 7 days, the session expires: Player 1 receives an expiry notice showing who did and didn't respond (no secrets are revealed), and all data is deleted.

### Multi-player (up to 20)
1. **Creator** enters session title, their secret, their email, and emails of 1–19 other players
2. Creator's secret is escrowed immediately
3. Each player receives a unique magic link and must submit their secret within 7 days
4. The moment the **last player** submits, all secrets are **revealed simultaneously** by email
5. Participants can track who has submitted (emails garbled for privacy) via a live status page
6. Verification log is available for 14 days

If the session expires before all players submit, everyone who did respond receives an expiry notice showing the full participant list and who didn't respond (no secrets revealed), then all data is deleted.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Static HTML/CSS/JS (`/public`) |
| API | Serverless functions (`/api`) |
| Storage | Neon Postgres via `@neondatabase/serverless` |
| Email | Resend |
| Hosting | Vercel |

---

## Project structure

```
/api
  create.js                    — POST: 2-player session creation
  submit.js                    — POST: 2-player atomic reveal
  secret/[token].js            — GET:  load 2-player session info
  log/[logToken].js            — GET:  2-player verification log
  multi/create.js              — POST: multi-player session creation
  multi/submit.js              — POST: multi-player atomic submission
  multi/secret/[token].js      — GET:  load multi-player participant info
  multi/status/[token].js      — GET:  multi-player submission status (polling)
  multi/log/[logToken].js      — GET:  multi-player verification log
  cron/expire.js               — GET:  daily expiry cron (Vercel Cron, 02:00 UTC)
/lib
  storage.js                   — 2-player Postgres queries and transactions
  storage-multi.js             — multi-player Postgres queries and transactions
  email.js                     — Resend email sending (9 email types)
  garble.js                    — PII email garbling (first/last chars, middle ***)
  ratelimit.js                 — IP and per-recipient rate limiting via rate_events table
/public
  index.html                   — 2-player session creation form
  submit.html                  — 2-player secret submission + inline reveal view
  success.html                 — Confirmation after 2-player session created
  expired.html                 — Shown when a magic link is invalid or expired
  log.html                     — 2-player verification log viewer
  multi.html                   — Multi-player session creation form
  multi-submit.html            — Multi-player submit + status polling + reveal
  multi-success.html           — Confirmation after multi-player session created
  multi-log.html               — Multi-player verification log viewer
  style.css                    — Shared styles
/scripts
  migrate.js                   — Drop-and-recreate schema; run once on first deploy
```

---

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set environment variables
Copy to `.env` for local dev (Vercel CLI picks this up automatically):
```
DATABASE_URL=...
RESEND_API_KEY=...
FROM_EMAIL=noreply@yourdomain.com
SITE_URL=https://secretkeeper.win
CRON_SECRET=some-random-secret
```

### 3. Run the database migration
```bash
npm run migrate
```
This drops and recreates all tables. Safe to re-run during development. In future, extend `scripts/migrate.js` into proper numbered migrations before running against a live database.

### 4. Start dev server
```bash
vercel dev
```

### 5. Deploy
```bash
vercel --prod
```

---

## Environment variables

Set these in the Vercel dashboard under Project → Settings → Environment Variables.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon connection string |
| `RESEND_API_KEY` | Yes | API key from resend.com |
| `FROM_EMAIL` | Yes | Verified sender address, e.g. `noreply@yourdomain.com` |
| `SITE_URL` | Yes | Canonical URL, e.g. `https://secretkeeper.win` |
| `CRON_SECRET` | Yes | Random secret; Vercel sends it automatically to authenticate cron requests |

> **`VERCEL_URL`** is set automatically by Vercel — do not override it. `SITE_URL` takes precedence for email links so they always point to the production domain rather than a preview deployment URL.

---

## Design decisions

- **Atomic reveal:** implemented as a Postgres transaction with `FOR UPDATE` row locking — all-or-nothing, race-safe
- **Expiry cron:** Vercel Cron runs daily at 02:00 UTC; emails participants on expiry then deletes all data — no silent data loss
- **Rate limiting:** 10 sessions per IP per 24h; 20 invites per recipient per 24h — prevents email-relay abuse
- **Input limits:** title 120 chars, secret 2000 chars, email 254 chars — enforced server-side and in the HTML
- **No in-memory state:** all session data is in Postgres; serverless functions are stateless between invocations
- **14-day log retention:** revealed sessions persist for 14 days for verification, then deleted by the cron
- **No accounts:** all access via cryptographically random magic link tokens (`crypto.randomBytes(32)`)
- **PII garbling:** emails in logs and status pages show only first/last characters of each part (e.g. `j***n@e***e.com`) — implemented once in `lib/garble.js`
- **Schema management:** `scripts/migrate.js` owns all DDL — no `CREATE TABLE IF NOT EXISTS` in the request path
- **Plaintext secrets:** by design — in board games opponents see each other's moves; no encryption is needed or expected
