'use strict';

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.FROM_EMAIL;

function baseUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const url = process.env.VERCEL_URL;
  if (!url) return 'http://localhost:3000';
  return url.startsWith('localhost') ? `http://${url}` : `https://${url}`;
}

function footer() {
  return [
    '',
    '---',
    'Secret Keeper — play-by-email helper for simultaneous secret reveal.',
    'All players commit to their secret independently — nobody sees anyone else\'s until all have submitted.',
    `No accounts, no passwords. All access via magic links. ${baseUrl()}`,
  ].join('\n');
}

function isoTs(date) {
  return new Date(date).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

async function sendP1Confirmation(p1Email, title, p1SubmittedAt) {
  await resend.emails.send({
    from: FROM,
    to: p1Email,
    subject: `Your secret is sealed — ${title}`,
    text: [
      `Your secret for "${title}" has been sealed.`,
      '',
      `Sealed: ${isoTs(p1SubmittedAt)}`,
      '',
      `Your secret is locked and cannot be changed. You will receive the full reveal once the respondent submits their secret.`,
      footer(),
    ].join('\n'),
  });
}

async function sendP2InviteTo(p2Email, title, p2Token, expiresAt) {
  const link = `${baseUrl()}/submit.html?token=${p2Token}`;
  const expires = new Date(expiresAt).toISOString().slice(0, 10);
  await resend.emails.send({
    from: FROM,
    to: p2Email,
    subject: `Your turn to submit — ${title}`,
    text: [
      `You've been invited to submit your secret for "${title}".`,
      '',
      `Click the link below to submit your secret. No account or password needed — the link is your access.`,
      '',
      link,
      '',
      `After you submit, the same link shows you the full reveal — bookmark it.`,
      '',
      `This link expires on ${expires}. After that, the session will be deleted.`,
      footer(),
    ].join('\n'),
  });
}

async function sendObserverNotification(observerEmails, title) {
  if (!observerEmails || observerEmails.length === 0) return;
  const sends = observerEmails.map((email) =>
    resend.emails.send({
      from: FROM,
      to: email,
      subject: `You're an observer — ${title}`,
      text: [
        `A new Secret Keeper session has been created: "${title}".`,
        '',
        `You are listed as an observer. You will receive the full reveal once both players have submitted their secrets.`,
        footer(),
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
    footer(),
  ].join('\n');

  const recipients = [p1Email, p2Email, ...(observerEmails || [])].filter(Boolean);
  const sends = recipients.map((email) =>
    resend.emails.send({
      from: FROM,
      to: email,
      subject: `Reveal complete — ${title}`,
      text: body,
    })
  );
  await Promise.allSettled(sends);
}

async function sendMultiCreatorConfirmation(email, title, token, expiresAt, totalPlayers, sealedAt) {
  const link    = `${baseUrl()}/multi-submit.html?token=${token}`;
  const expires = new Date(expiresAt).toISOString().slice(0, 10);
  await resend.emails.send({
    from: FROM,
    to:   email,
    subject: `Your secret is sealed — ${title}`,
    text: [
      `Your secret for "${title}" has been sealed.`,
      '',
      `Sealed: ${isoTs(sealedAt)}`,
      '',
      `Invites have been sent to ${totalPlayers - 1} other player${totalPlayers - 1 === 1 ? '' : 's'}. Once everyone has submitted, the full reveal is sent to all participants automatically.`,
      '',
      `Track the session status using the link below — it will also show the reveal once all secrets are in.`,
      '',
      link,
      '',
      `This link expires on ${expires}.`,
      footer(),
    ].join('\n'),
  });
}

async function sendMultiPlayerInvite(email, title, token, expiresAt, totalPlayers) {
  const link    = `${baseUrl()}/multi-submit.html?token=${token}`;
  const expires = new Date(expiresAt).toISOString().slice(0, 10);
  await resend.emails.send({
    from: FROM,
    to:   email,
    subject: `Submit your secret — ${title}`,
    text: [
      `You have been invited to submit your secret for "${title}" (${totalPlayers}-player session).`,
      '',
      `Use the link below to submit your secret. No account or password needed — the link is your access.`,
      '',
      link,
      '',
      `After you submit, the same link shows you who has submitted and who is still waiting — bookmark it.`,
      `The reveal happens automatically once all ${totalPlayers} players have submitted.`,
      '',
      `This link expires on ${expires}.`,
      footer(),
    ].join('\n'),
  });
}

async function sendMultiPlayerReveal({ participants, title, logToken }) {
  const logUrl = `${baseUrl()}/multi-log.html?token=${logToken}`;

  const secretLines = participants.map(p =>
    `Player ${p.position} (${p.email}) — submitted ${isoTs(p.submitted_at)}:\n${p.secret}`
  ).join('\n\n');

  const body = [
    `All secrets for "${title}" have been revealed.`,
    '',
    secretLines,
    '',
    `Verification log (available for 14 days):`,
    logUrl,
    footer(),
  ].join('\n');

  const sends = participants.map(p =>
    resend.emails.send({
      from: FROM,
      to:   p.email,
      subject: `Reveal complete — ${title}`,
      text: body,
    })
  );
  await Promise.allSettled(sends);
}

module.exports = {
  sendP1Confirmation,
  sendP2InviteTo,
  sendObserverNotification,
  sendFinalReveal,
  sendMultiCreatorConfirmation,
  sendMultiPlayerInvite,
  sendMultiPlayerReveal,
};
