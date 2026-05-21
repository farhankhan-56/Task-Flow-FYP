const nodemailer = require('nodemailer');

const host = process.env.EMAIL_HOST;
const port = Number(process.env.EMAIL_PORT || 587);
const user = process.env.EMAIL_USER;
const pass = process.env.EMAIL_PASSWORD;
const from = process.env.EMAIL_FROM || user;

if (!host || !port || !user || !pass) {
  console.warn('[email] Missing email configuration in .env. Verification emails will not be sent.');
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: {
    user,
    pass
  }
});

async function sendMail({ to, subject, text, html }) {
  if (!host || !port || !user || !pass) {
    throw new Error('Email service is not configured. Check EMAIL_HOST, EMAIL_PORT, EMAIL_USER, and EMAIL_PASSWORD in .env.');
  }

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html
  });
  return info;
}

module.exports = { sendMail };
