'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.FROM_EMAIL;

function baseUrl() {
  // SITE_URL should be set in Vercel env vars to the canonical URL
  // e.g. https://secretkeeper.vercel.app — avoids VERCEL_URL returning
  // a preview deployment URL on non-production deploys
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const url = process.env.VERCEL_URL;
  if (!url) return 'http://localhost:3000';
  return url.startsWith('localhost') ? `http://${url}` : `https://${url}`;
}

async function sendP1Confirmation(p1Email, title, p1SubmittedAt) {
  const ts = new Date(p1SubmittedAt).toUTCString();
  await resend.emails.send({
    from: FROM,
    to: p1Email,
    subject: `Secret escrowed — ${title}`,
    text: [
      `Your secret for "${title}" has been escrowed.`,
      '',
      `Committed: ${ts}`,
      '',
      `Your secret is locked and cannot be changed. You will receive the full reveal once the respondent submits their secret.`,
    ].join('\n'),
  });
}

async function sendP2InviteTo(p2Email, title, p2Token, expiresAt) {
  const link = `${baseUrl()}/submit.html?token=${p2Token}`;
  const expires = new Date(expiresAt).toDateString();
  await resend.emails.send({
    from: FROM,
    to: p2Email,
    subject: `Submit your secret — ${title}`,
    text: [
      `You've been invited to submit your secret for "${title}".`,
      '',
      `Submit your secret here:`,
      link,
      '',
      `This link expires on ${expires}. After that, the session will be deleted.`,
    ].join('\n'),
  });
}

async function sendObserverNotification(observerEmails, title) {
  if (!observerEmails || observerEmails.length === 0) return;
  const sends = observerEmails.map((email) =>
    resend.emails.send({
      from: FROM,
      to: email,
      subject: `New Secret Keeper session — ${title}`,
      text: [
        `A new Secret Keeper session has been created: "${title}".`,
        '',
        `You are listed as an observer. You will receive the full reveal once both players have submitted their secrets.`,
      ].join('\n'),
    })
  );
  await Promise.allSettled(sends);
}

async function sendFinalReveal({ p1Email, p2Email, observerEmails, title, p1Secret, p2Secret, logToken, p1SubmittedAt, p2SubmittedAt }) {
  const logUrl = `${baseUrl()}/log.html?token=${logToken}`;
  const p1ts = new Date(p1SubmittedAt).toUTCString();
  const p2ts = new Date(p2SubmittedAt).toUTCString();

  const body = [
    `Both secrets for "${title}" have been revealed.`,
    '',
    `Player 1 (${p1Email}) — submitted ${p1ts}:`,
    p1Secret,
    '',
    `Player 2 (${p2Email}) — submitted ${p2ts}:`,
    p2Secret,
    '',
    `Verification log (available for 14 days):`,
    logUrl,
  ].join('\n');

  const recipients = [p1Email, p2Email, ...(observerEmails || [])].filter(Boolean);
  const sends = recipients.map((email) =>
    resend.emails.send({
      from: FROM,
      to: email,
      subject: `Secrets revealed — ${title}`,
      text: body,
    })
  );
  await Promise.allSettled(sends);
}

module.exports = { sendP1Confirmation, sendP2InviteTo, sendObserverNotification, sendFinalReveal };
