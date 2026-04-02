'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.FROM_EMAIL;

const FOOTER = [
  '',
  '---',
  'Secret Keeper — play-by-email helper for simultaneous secret reveal.',
  'Both players commit to a hidden secret independently. Neither sees the other\'s until both have submitted.',
  'No accounts, no passwords. All access via magic links. secretkeeper.win',
].join('\n');

function baseUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const url = process.env.VERCEL_URL;
  if (!url) return 'http://localhost:3000';
  return url.startsWith('localhost') ? `http://${url}` : `https://${url}`;
}

function isoTs(date) {
  return new Date(date).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

async function sendP1Confirmation(p1Email, title, p1SubmittedAt) {
  await resend.emails.send({
    from: FROM,
    to: p1Email,
    subject: `Secret sealed — ${title}`,
    text: [
      `Your secret for "${title}" has been sealed.`,
      '',
      `Sealed: ${isoTs(p1SubmittedAt)}`,
      '',
      `Your secret is locked and cannot be changed. You will receive the full reveal once the respondent submits their secret.`,
      FOOTER,
    ].join('\n'),
  });
}

async function sendP2InviteTo(p2Email, title, p2Token, expiresAt) {
  const link = `${baseUrl()}/submit.html?token=${p2Token}`;
  const expires = new Date(expiresAt).toISOString().slice(0, 10);
  await resend.emails.send({
    from: FROM,
    to: p2Email,
    subject: `Submit your secret — ${title}`,
    text: [
      `You've been invited to submit your secret for "${title}".`,
      '',
      `Click the link below to submit your secret. No account or password needed — the link is your access.`,
      '',
      link,
      '',
      `This link expires on ${expires}. After that, the session will be deleted.`,
      FOOTER,
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
        FOOTER,
      ].join('\n'),
    })
  );
  await Promise.allSettled(sends);
}

async function sendFinalReveal({ p1Email, p2Email, observerEmails, title, p1Secret, p2Secret, logToken, p1SubmittedAt, p2SubmittedAt }) {
  const logUrl = `${baseUrl()}/log.html?token=${logToken}`;

  const body = [
    `Both secrets for "${title}" have been revealed.`,
    '',
    `Player 1 (${p1Email}) — sealed ${isoTs(p1SubmittedAt)}:`,
    p1Secret,
    '',
    `Player 2 (${p2Email}) — sealed ${isoTs(p2SubmittedAt)}:`,
    p2Secret,
    '',
    `Verification log (available for 14 days):`,
    logUrl,
    FOOTER,
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
