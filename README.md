# Secret Keeper

A lightweight web app that solves the simultaneous reveal problem in play-by-email (PBEM) board games. Two players commit to a hidden secret independently — neither can see the other's secret until both have submitted. Secrets are revealed simultaneously by email.

No accounts. No passwords. All access via magic links.

**Live:** https://secretkeeper.vercel.app

---

## How it works

1. **Player 1** visits the app, enters a session title, their secret, and both players' email addresses, then submits
2. Player 1's secret is **escrowed immediately** — locked and immutable
3. **Player 2** receives a magic link by email and has 7 days to submit their secret
4. The moment Player 2 submits, both secrets are **revealed simultaneously** and emailed to all participants
5. A **verification log** is available for 14 days proving neither secret was altered after submission

If Player 2 does not respond within 7 days, the session is deleted and no reveal occurs.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Static HTML/CSS/JS (`/public`) |
| API | Serverless functions (`/api`) |
| Storage | Vercel Postgres |
| Email | Resend |
| Hosting | Vercel |

---

## Project structure

```
/api
  create.js           — POST: create session, escrow P1 secret, send P2 invite
  submit.js           — POST: P2 submits secret, triggers atomic reveal
  secret/[token].js   — GET:  load session info for P2 submit page
  log/[logToken].js   — GET:  load verification log
/lib
  storage.js          — Vercel Postgres queries and transactions
  email.js            — Resend email sending (4 email types)
/public
  index.html          — Session creation form (Player 1)
  submit.html         — Secret submission form (Player 2)
  success.html        — Confirmation page after P1 submits
  complete.html       — Confirmation page after P2 submits
  expired.html        — Shown when a magic link is invalid or expired
  log.html            — Verification log viewer
  style.css           — Shared styles
```

---

## Environment variables

Set these in the Vercel dashboard under Project → Settings → Environment Variables.

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_URL` | Yes | Set automatically by Vercel Postgres |
| `RESEND_API_KEY` | Yes | API key from resend.com |
| `FROM_EMAIL` | Yes | Sender address, e.g. `noreply@yourdomain.com` |
| `SITE_URL` | Yes | Canonical URL, e.g. `https://secretkeeper.vercel.app` |

> **Note on `FROM_EMAIL`:** until a custom domain is configured, use Resend's default sending domain. See Resend docs for details.

> **Note on `SITE_URL`:** this ensures magic links in emails always point to the production URL, not a preview deployment URL.

---

## Local development

```bash
npm install
npx vercel dev
```

Requires the [Vercel CLI](https://vercel.com/docs/cli) and a `.env.local` file with the environment variables listed above.

---

## Deployment

The app deploys automatically when you push to `main` via the Vercel GitHub integration.

Manual deploy:
```bash
npx vercel --prod
```

---

## Design decisions

- **Atomic reveal:** the two-phase commit is implemented as a Postgres transaction with `FOR UPDATE` row locking — the reveal is all-or-nothing
- **No in-memory state:** all session data is in Postgres; serverless functions are stateless between invocations
- **14-day log retention:** revealed sessions are kept for 14 days for verification, then deleted
- **7-day submission window:** sessions expire if Player 2 does not respond; cleanup runs non-blocking on each API request
- **No accounts:** all access is via cryptographically random magic link tokens (`crypto.randomBytes(32)`)
