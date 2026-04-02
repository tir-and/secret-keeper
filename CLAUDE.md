# PBEM Secret Keeper

## What this project is
A lightweight web app for simultaneous secret reveals in play-by-email board games.
Two players commit to a secret independently — neither sees the other's until both have submitted.
Hosted on Vercel. No user accounts; all access via magic links.

## Stack
- Frontend: static HTML/CSS/JS in `/public` — no framework
- API: Vercel serverless functions in `/api`
- Storage: Vercel Postgres via `@vercel/postgres`
- Email: Resend via `resend` npm package
- Font: Calibri / Segoe UI — keep it simple, no web fonts

## Commands
- Dev server: `vercel dev`
- Deploy: `vercel --prod`

## Core rules — do not break these
- P1 secret is written once at session creation and is NEVER mutated or deleted
- The reveal in `/api/submit.js` MUST use a Postgres transaction (BEGIN/COMMIT/ROLLBACK)
- Sessions are NOT deleted on reveal — they persist for 14 days via log_token
- Session timeout is 7 days; log retention is 14 days after reveal
- Cleanup is lazy — call `cleanupExpired()` opportunistically, never block on it

## API endpoints (the only three that should exist)
- POST `/api/create` — create session, escrow P1 secret, send emails
- GET  `/api/secret/[token]` — return session title for magic link page load
- POST `/api/submit` — atomic reveal via Postgres transaction
- GET  `/api/log/[logToken]` — return verification log data

## What is done
- `public/index.html` — P1 create session form
- `public/style.css` — shared stylesheet used by all pages
- `public/submit.html` — P2 submits secret (magic link target)
- `public/success.html` — shown to P1 after session creation
- `public/complete.html` — shown to P2 after submission
- `public/expired.html` — shown for invalid, already-used, or expired links
- `public/log.html` — verification log viewer
- `CLAUDE.md` — this file

## What still needs to be built

### Backend
- `package.json` — dependencies: @vercel/postgres, resend. devDependencies: vercel
- `vercel.json` — functions maxDuration: 10, nothing else
- `lib/storage.js` — all Postgres operations; createSession, getSessionByP2Token,
  revealSession (atomic transaction), getSessionByLogToken, cleanupExpired
- `lib/email.js` — four Resend send functions: sendP1Confirmation, sendP2InviteTo,
  sendObserverNotification, sendFinalReveal (includes log URL in reveal email)
- `api/create.js` — POST; validates input, calls createSession, sends three emails
- `api/secret/[token].js` — GET; returns title and expiresAt for valid awaiting sessions
- `api/submit.js` — POST; calls revealSession (atomic), sends final reveal emails
- `api/log/[logToken].js` — GET; returns reveal data for valid non-expired logs

## Design decisions
- Style matches Claude.ai chat UI — use CSS variables (--color-background-primary etc.)
- index.html has CSS embedded in a <style> block — extract this into style.css,
  then all other pages link to style.css with <link rel="stylesheet" href="/style.css">
- Font: Calibri / Segoe UI — no Google Fonts or web fonts
- Keep UI minimal — no animations, no decorative elements
- Error messages go in a `.error-box` div, shown/hidden with a `.visible` class
- Submit buttons show a CSS spinner while fetch is in flight
- All forms use fetch + JSON, not native HTML form POST

## Environment variables (set in Vercel dashboard)
- `RESEND_API_KEY` — Resend API key
- `FROM_EMAIL` — verified sender address
- `VERCEL_URL` — auto-set by Vercel, do not override
- `POSTGRES_*` — auto-injected by Vercel when Postgres is linked
