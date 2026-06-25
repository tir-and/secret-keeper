# PBEM Secret Keeper

## What this project is
A lightweight web app for simultaneous secret reveals in play-by-email board games.
Two players commit to a secret independently — neither sees the other's until both have submitted.
Also supports multi-player mode (up to 20 players) where all must submit before simultaneous reveal.
Hosted on Vercel. No user accounts; all access via magic links.

## Intentional design decisions
- **Secrets are stored and transmitted in plaintext** — by design. In board games opponents see each other's moves; there is no expectation of encryption. Do not add encryption without explicit instruction.

## Stack
- Frontend: static HTML/CSS/JS in `/public` — no framework
- API: Vercel serverless functions in `/api`
- Storage: Neon Postgres via `@neondatabase/serverless` — connects via `DATABASE_URL`
- Email: Resend via `resend` npm package
- Font: Calibri / Segoe UI — keep it simple, no web fonts

## Commands
- Dev server: `vercel dev`
- Deploy: `vercel --prod`
- Migrate DB (run once after first deploy, or after schema changes): `npm run migrate`

## Core rules — do not break these
- P1 secret is written once at session creation and is NEVER mutated or deleted
- The reveal in `/api/submit.js` MUST use a Postgres transaction (BEGIN/COMMIT/ROLLBACK)
- Revealed sessions persist for 14 days via `log_token`, then are deleted by the cron
- Session timeout is 7 days; on expiry the cron emails participants and then deletes all data
- Lazy cleanup (`cleanupExpired`, `cleanupExpiredMulti`) only deletes revealed-past-retention rows — it never touches awaiting-expired sessions (those are the cron's job)
- Multi-player reveals MUST use atomic transaction in `submitMultiSecret()`
- `claimExpiredSessions` / `claimExpiredMultiSessions` use `DELETE … RETURNING` — atomic, each session processed exactly once even under concurrent cron runs
- If sending the P2 invite email fails at session creation, the session is deleted so retries start clean (no orphaned sessions)

## Rate limiting
- `lib/ratelimit.js` checks `rate_events` table before allowing session creation
- IP cap: 10 sessions per IP per 24 hours
- Per-recipient cap: 20 invites per email address per 24 hours
- Events are recorded only after confirmed successful session creation (failed invites don't consume quota)
- Prune of old events fires opportunistically (fire-and-forget) on each create request

## Input limits (server-side + HTML maxlength)
- Title: 120 characters
- Secret: 2000 characters
- Email: 254 characters (RFC max)
- Observers: max 10 (2-player)

## API endpoints
### 2-player
- POST `/api/create` — create session, escrow P1 secret, send emails
- GET  `/api/secret/[token]` — return session title for magic link page load
- POST `/api/submit` — atomic reveal via Postgres transaction
- GET  `/api/log/[logToken]` — return verification log data (emails garbled)

### Multi-player
- POST `/api/multi/create` — create multi-player session, send invites
- POST `/api/multi/submit` — atomic multi-player secret submission
- GET  `/api/multi/secret/[token]` — load participant info for submit page
- GET  `/api/multi/status/[token]` — polling endpoint for submission status (emails garbled)
- GET  `/api/multi/log/[logToken]` — return multi-player verification log (emails garbled)

### Cron
- GET  `/api/cron/expire` — Vercel Cron, runs daily at 02:00 UTC; requires `Authorization: Bearer <CRON_SECRET>`

## Files (all implemented)

### Config
- `package.json` — dependencies: @neondatabase/serverless, resend. devDependencies: vercel. scripts: migrate
- `vercel.json` — functions maxDuration: 10; cron at 02:00 UTC → /api/cron/expire
- `.gitignore` — node_modules, .env, .vercel, *.log
- `scripts/migrate.js` — drops and recreates all tables; run with `npm run migrate`

### Backend
- `lib/storage.js` — 2-player Postgres operations: createSession, deleteSession, claimExpiredSessions, getSessionByP2Token, getRevealByP2Token, revealSession (atomic), getSessionByLogToken, cleanupExpired
- `lib/storage-multi.js` — multi-player Postgres operations: createMultiSession, claimExpiredMultiSessions, getParticipantByToken, getSessionStatus, submitMultiSecret (atomic), getMultiSessionByLogToken, cleanupExpiredMulti
- `lib/email.js` — 9 Resend send functions (2-player: sendP1Confirmation, sendP2InviteTo, sendObserverNotification, sendFinalReveal, sendExpiryNoticeTwoPlayer; multi-player: sendMultiCreatorConfirmation, sendMultiPlayerInvite, sendMultiPlayerReveal, sendExpiryNoticeMulti)
- `lib/garble.js` — canonical PII garbling: first/last char of each email part visible, middle replaced with `***`
- `lib/ratelimit.js` — getClientIp, checkIpRateLimit, checkRecipientRateLimits, recordRateEvents, pruneOldRateEvents
- `api/cron/expire.js` — daily expiry cron: claim expired awaiting sessions, email participants, delete data, clean up revealed-past-retention

### Frontend
- `public/index.html` — P1 create session form (2-player)
- `public/submit.html` — P2 submits secret (magic link target); inline reveal after submission
- `public/success.html` — shown to P1 after session creation
- `public/expired.html` — shown for invalid, already-used, or expired links
- `public/log.html` — verification log viewer (2-player)
- `public/multi.html` — multi-player session creation form
- `public/multi-submit.html` — multi-player submit + status polling (10 min) + reveal
- `public/multi-success.html` — shown after multi-player session creation
- `public/multi-log.html` — multi-player verification log viewer
- `public/style.css` — shared stylesheet used by all pages

## Design decisions
- Style matches Claude.ai chat UI — use CSS variables (--color-background-primary etc.)
- Font: Calibri / Segoe UI — no Google Fonts or web fonts
- Keep UI minimal — no animations, no decorative elements
- Error messages go in a `.error-box` div, shown/hidden with a `.visible` class
- Submit buttons show a CSS spinner while fetch is in flight
- All forms use fetch + JSON, not native HTML form POST
- Email addresses in logs and status are garbled via `lib/garble.js` (first/last chars visible, middle `***`)
- Multi-player status page polls every 10 minutes until all have submitted (PBEM is non-concurrent)
- Schema management lives in `scripts/migrate.js` — no DDL in the request path

## Environment variables (set in Vercel dashboard)
- `RESEND_API_KEY` — Resend API key
- `FROM_EMAIL` — verified sender address
- `SITE_URL` — set to `https://secretkeeper.win` so emails link to the custom domain
- `VERCEL_URL` — auto-set by Vercel, do not override
- `DATABASE_URL` — Neon connection string (set when Neon integration is linked)
- `CRON_SECRET` — secret token; Vercel sends it automatically to authenticate cron requests
