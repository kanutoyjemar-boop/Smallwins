const nodemailer = require('nodemailer');

let transporter;

function isConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.APP_URL);
}

function getTransporter() {
  if (!isConfigured()) {
    throw new Error('SMTP_HOST, SMTP_FROM, and APP_URL are required to send account email.');
  }
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('SMTP_PORT must be a valid TCP port.');
    }
    const options = {
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
    };
    if (process.env.SMTP_USER || process.env.SMTP_PASS) {
      if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        throw new Error('SMTP_USER and SMTP_PASS must be configured together.');
      }
      options.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };
    }
    transporter = nodemailer.createTransport(options);
  }
  return transporter;
}

function validateAppUrl() {
  const appUrl = new URL(process.env.APP_URL);
  const localHttpAllowed = process.env.NODE_ENV !== 'production'
    && ['localhost', '127.0.0.1'].includes(appUrl.hostname);
  if (appUrl.protocol !== 'https:' && !localHttpAllowed) {
    throw new Error('APP_URL must use HTTPS except for local development.');
  }
  return appUrl;
}

function validateConfig() {
  const smtpRequested = Boolean(
    process.env.SMTP_HOST || process.env.SMTP_FROM || process.env.SMTP_USER || process.env.SMTP_PASS
  );
  if (!smtpRequested) return;
  if (!isConfigured()) {
    throw new Error('SMTP_HOST, SMTP_FROM, and APP_URL are required to enable account email.');
  }
  validateAppUrl();
  getTransporter();
}

async function sendPasswordReset(to, resetUrl) {
  validateAppUrl();
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: 'Reset your Small Wins password',
    text: `Use this link within one hour to reset your Small Wins password:\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
  });
}

module.exports = { isConfigured, sendPasswordReset, validateConfig };
