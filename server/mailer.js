'use strict';

const nodemailer = require('nodemailer');

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Email is optional. With no SMTP settings the mailer is a no-op that says so
 * in the log, and the site hides features that depend on it.
 */
function createMailer(config) {
  if (!config.mail.enabled) {
    return {
      enabled: false,
      async send(message) {
        console.warn(`[mail] SMTP is not configured, so no email was sent to ${message.to}`);
        return false;
      }
    };
  }

  const transport = nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined
  });

  return {
    enabled: true,
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from: config.mail.from, to, subject, text, html });
      return true;
    }
  };
}

function formatNgn(kobo) {
  return '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function receiptEmail({ name, modName, amountKobo, reference, historyUrl }) {
  const amount = formatNgn(amountKobo);
  const text = [
    `Hi ${name},`,
    '',
    `Thanks for your purchase! Here is your receipt.`,
    '',
    `Item: ${modName}`,
    `Amount paid: ${amount}`,
    `Reference: ${reference}`,
    '',
    `You can download your file any time from your purchase history:`,
    historyUrl,
    '',
    '- Casual_DAViD'
  ].join('\n');

  const html = `
    <p>Hi ${esc(name)},</p>
    <p>Thanks for your purchase! Here is your receipt.</p>
    <table cellpadding="6" style="border-collapse:collapse">
      <tr><td><strong>Item</strong></td><td>${esc(modName)}</td></tr>
      <tr><td><strong>Amount paid</strong></td><td>${esc(amount)}</td></tr>
      <tr><td><strong>Reference</strong></td><td>${esc(reference)}</td></tr>
    </table>
    <p>You can download your file any time from your
      <a href="${esc(historyUrl)}">purchase history</a>.</p>
    <p>- Casual_DAViD</p>`;

  return { subject: `Your receipt for ${modName}`, text, html };
}

function resetEmail({ name, link }) {
  const text = [
    `Hi ${name},`,
    '',
    'Someone asked to reset the password on your Casual_DAViD account.',
    'If that was you, open this link within 1 hour:',
    link,
    '',
    'If it was not you, you can ignore this email. Your password has not changed.',
    '',
    '- Casual_DAViD'
  ].join('\n');

  const html = `
    <p>Hi ${esc(name)},</p>
    <p>Someone asked to reset the password on your Casual_DAViD account.
       If that was you, use the link below within 1 hour:</p>
    <p><a href="${esc(link)}">Reset my password</a></p>
    <p>If it was not you, you can ignore this email. Your password has not changed.</p>
    <p>- Casual_DAViD</p>`;

  return { subject: 'Reset your Casual_DAViD password', text, html };
}

module.exports = { createMailer, receiptEmail, resetEmail };
