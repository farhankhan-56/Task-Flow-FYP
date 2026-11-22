/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — routes/auth.js
   Handles: Signup, Login, Logout, Email verification, OTP reset
   ═══════════════════════════════════════════════════════════════ */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { sendMail, escapeHtml } = require('../utils/email');

const router = express.Router();

const forgotPasswordFlowLimiter = rateLimit({
  windowMs: Number(process.env.FORGOT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.FORGOT_RATELIMIT_MAX ?? 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' }
});

const forgotPasswordEmailLimiter = rateLimit({
  windowMs: Number(process.env.FORGOT_WINDOW_MS || 15 * 60 * 1000),
  max: 8,
  keyGenerator: (req) => String(req.body?.email || '').toLowerCase().trim() || 'no-email',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts for this email. Try again in a few minutes.' }
});

const signupLoginLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATELIMIT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(
    process.env.AUTH_RATELIMIT_MAX ?? (process.env.NODE_ENV === 'production' ? 40 : 200)
  ),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a few minutes and try again.' }
});

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const makeOtp = () => String(crypto.randomInt(100000, 1000000));
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const VERIFICATION_EXPIRES_MINUTES = Number(process.env.EMAIL_VERIFICATION_EXPIRES_MINUTES || 60);
const OTP_EXPIRES_MINUTES = Number(process.env.OTP_EXPIRES_MINUTES || 15);
const RESET_CODE_MESSAGE = 'If this email is registered, a code has been sent.';

function safeUser(row) {
  return {
    id: String(row.id),
    name: row.name,
    email: row.email,
    profile_picture: row.profile_picture || null
  };
}

async function createEmailVerification(userId, email) {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRES_MINUTES * 60 * 1000);
  await query(
    `INSERT INTO email_verifications (user_id, verification_token, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET verification_token = EXCLUDED.verification_token, expires_at = EXCLUDED.expires_at`,
    [userId, token, expiresAt]
  );
  const verifyUrl = `${FRONTEND_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: 'Verify your Task Flow email',
    text: `Welcome to Task Flow! Verify your email: ${verifyUrl}`,
    html: `
      <p>Welcome to Task Flow!</p>
      <p>Click the button below to verify your email address and finish creating your account.</p>
      <p><a href="${verifyUrl}" style="display:inline-block;padding:12px 18px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:6px">Verify email</a></p>
      <p>If you did not sign up, ignore this email.</p>
    `
  });
  return token;
}

async function findUnverifiedAccount(email, password) {
  const result = await query(
    'SELECT id, name, email, password_hash, profile_picture FROM users WHERE email = $1 AND email_verified = FALSE',
    [email]
  );
  const row = result.rows[0];
  if (!row || !row.password_hash) return null;
  const match = await bcrypt.compare(password, row.password_hash);
  return match ? row : null;
}

router.post('/signup', signupLoginLimiter, async (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' || !name.trim() || !email || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format.' });
  }

  try {
    let user = await findUnverifiedAccount(normalizedEmail, password);
    if (!user) {
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await query(
        `INSERT INTO users (name, email, password_hash, auth_type, email_verified)
         VALUES ($1, $2, $3, 'email', FALSE)
         RETURNING id, name, email, profile_picture`,
        [name.trim(), normalizedEmail, passwordHash]
      );
      user = result.rows[0];
    }
    try {
      await createEmailVerification(user.id, normalizedEmail);
    } catch (mailErr) {
      console.error('[auth/signup email]', mailErr);
      return res.status(502).json({ error: 'Your account is saved, but the verification email could not be sent. Sign up again with the same details to try again.' });
    }
    return res.status(201).json({
      message: 'Account created! Check your email to verify your address.',
      user: safeUser(user),
      needsVerification: true
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    console.error('[auth/signup]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

router.get('/verify-email', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  if (!token) {
    return res.status(400).send('Verification link is invalid.');
  }

  try {
    const verification = await query(
      `SELECT user_id FROM email_verifications
       WHERE verification_token = $1 AND expires_at > now()` ,
      [token]
    );
    if (verification.rows.length === 0) {
      return res.status(400).send('Verification token is invalid or expired.');
    }

    const userId = verification.rows[0].user_id;
    await query('UPDATE users SET email_verified = TRUE WHERE id = $1', [userId]);
    await query('DELETE FROM email_verifications WHERE user_id = $1', [userId]);
    return res.redirect('/index.html?verified=1');
  } catch (err) {
    console.error('[auth/verify-email]', err);
    return res.status(500).send('Server error.');
  }
});

router.post('/login', signupLoginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!isValidEmail(normalizedEmail)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  try {
    const result = await query(
      'SELECT id, name, email, password_hash, email_verified, profile_picture FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const row = result.rows[0];
    if (!row.password_hash) {
      return res.status(401).json({ error: 'This account does not have a password. Please use Google login.' });
    }
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (!row.email_verified) {
      return res.status(403).json({ error: 'Please verify your email before logging in. Lost the link? Sign up again with the same details to get a new one.' });
    }
    const sessionUser = safeUser(row);
    req.session.regenerate((sessionErr) => {
      if (sessionErr) {
        console.error('[auth/login session]', sessionErr);
        return res.status(500).json({ error: 'Server error.' });
      }
      req.session.user = sessionUser;
      res.json({ message: `Welcome back, ${row.name}!`, user: sessionUser });
    });
  } catch (err) {
    console.error('[auth/login]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed.' });
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully.' });
  });
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not logged in.' });
  }
  res.json({ user: req.session.user });
});

router.post('/forgot-password/check-email', forgotPasswordFlowLimiter, forgotPasswordEmailLimiter, async (req, res) => {

  const raw = typeof req.body?.email === 'string' ? req.body.email : '';
  const email = raw.toLowerCase().trim();

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.', exists: false });
  }

  try {
    const result = await query('SELECT id, name FROM users WHERE email = $1 LIMIT 1', [email]);
    if (result.rows.length === 0) {
      return res.json({ message: RESET_CODE_MESSAGE });
    }

    const user = result.rows[0];
    const otp = makeOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MINUTES * 60 * 1000);

    await query('DELETE FROM otp_resets WHERE user_id = $1', [user.id]);
    await query(
      `INSERT INTO otp_resets (user_id, otp, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, otp, expiresAt]
    );

    sendMail({
      to: email,
      subject: 'Your Task Flow password reset code',
      text: `Your password reset code is ${otp}. It expires in ${OTP_EXPIRES_MINUTES} minutes.`,
      html: `
        <p>Hello ${escapeHtml(user.name)},</p>
        <p>Your Task Flow password reset code is:</p>
        <p style="font-size:22px;font-weight:700;margin:14px 0">${otp}</p>
        <p>This code expires in ${OTP_EXPIRES_MINUTES} minutes.</p>
      `
    }).catch((mailErr) => console.error('[auth/forgot-password/send]', mailErr.message));

    res.json({ message: RESET_CODE_MESSAGE });
  } catch (err) {
    console.error('[auth/forgot-password/check-email]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/forgot-password/reset', forgotPasswordFlowLimiter, forgotPasswordEmailLimiter, async (req, res) => {

  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
  const { otp, password } = req.body || {};
  const email = rawEmail.toLowerCase().trim();

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
    return res.status(400).json({ error: 'Enter the 6-digit code from your email.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const result = await query(
      `SELECT u.id AS user_id, u.email_verified, o.id AS otp_id
       FROM users u
       JOIN otp_resets o ON o.user_id = u.id
       WHERE u.email = $1
         AND o.otp = $2
         AND o.expires_at > now()
         AND o.verified = FALSE
       ORDER BY o.created_at DESC
       LIMIT 1`,
      [email, otp.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid code or expired OTP.' });
    }

    const row = result.rows[0];
    const passwordHash = await bcrypt.hash(password, 10);
    await query('UPDATE users SET password_hash = $1, email_verified = TRUE WHERE id = $2', [passwordHash, row.user_id]);
    await query('DELETE FROM otp_resets WHERE id = $1', [row.otp_id]);

    res.json({ message: 'Password reset successful. You can now log in.' });
  } catch (err) {
    console.error('[auth/forgot-password/reset]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
