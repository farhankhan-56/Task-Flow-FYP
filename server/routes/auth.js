/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — routes/auth.js
   Handles: Signup, Login, Logout, Get current user (PostgreSQL)
   ═══════════════════════════════════════════════════════════════ */

const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');

const router = express.Router();

const forgotPasswordFlowLimiter = rateLimit({
  windowMs: Number(process.env.FORGOT_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.FORGOT_RATELIMIT_MAX ?? 60),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' }
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

function safeUser(row) {
  return { id: String(row.id), name: row.name, email: row.email };
}

router.post('/signup', signupLoginLimiter, async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
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
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name.trim(), normalizedEmail, passwordHash]
    );
    const user = result.rows[0];
    const sessionUser = safeUser(user);
    req.session.user = sessionUser;
    res.status(201).json({ message: 'Account created successfully!', user: sessionUser });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered.' });
    }
    console.error('[auth/signup]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/login', signupLoginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (!isValidEmail(normalizedEmail)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  try {
    const result = await query(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const row = result.rows[0];
    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const sessionUser = safeUser(row);
    req.session.user = sessionUser;
    res.json({ message: `Welcome back, ${row.name}!`, user: sessionUser });
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

/** Step 1: does this email have an account? (used to reveal password fields in UI) */
router.post('/forgot-password/check-email', forgotPasswordFlowLimiter, async (req, res) => {
  const raw = typeof req.body?.email === 'string' ? req.body.email : '';
  const email = raw.toLowerCase().trim();

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.', exists: false });
  }

  try {
    const result = await query('SELECT 1 FROM users WHERE email = $1 LIMIT 1', [email]);
    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    console.error('[auth/forgot-password/check-email]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

/** Step 2: set a new password if that email exists (no email magic link). */
router.post('/forgot-password/set-password', forgotPasswordFlowLimiter, async (req, res) => {
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
  const { password } = req.body || {};
  const email = rawEmail.toLowerCase().trim();

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const lookup = await query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
    if (lookup.rows.length === 0) {
      return res.status(404).json({ error: 'No account found for this email.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await query(`UPDATE users SET password_hash = $1 WHERE email = $2`, [passwordHash, email]);

    res.json({ message: 'Password updated. You can log in now.' });
  } catch (err) {
    console.error('[auth/forgot-password/set-password]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
