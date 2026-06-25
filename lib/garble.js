'use strict';

// Garbles an email for display: first and last chars of each part visible, middle replaced with ***.
// e.g. john.doe@example.com → j***e@e***e.com
function garbleEmail(email) {
  const [local, domain] = email.split('@');
  return `${garblePart(local)}@${garblePart(domain)}`;
}

function garblePart(s) {
  if (!s) return '***';
  if (s.length <= 2) return s[0] + '***';
  return s[0] + '***' + s[s.length - 1];
}

module.exports = { garbleEmail };
