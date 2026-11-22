/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — server.js  (Entry Point)
   ═══════════════════════════════════════════════════════════════ */

require('dotenv').config({
  path: require('path').join(__dirname, '.env'),
  override: process.env.NODE_ENV !== 'production'
});

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const passport = require('passport');

const authRoutes = require('./routes/auth');
const googleAuthRoutes = require('./routes/google-auth');
const taskRoutes = require('./routes/tasks');
const categoryRoutes = require('./routes/categories');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  console.error('');
  console.error('  ❌  SESSION_SECRET is missing.');
  console.error('      Set it in server/.env (and in Railway/host env vars for production).');
  console.error('');
  process.exit(1);
}

if (isProduction || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  next();
});

// ── CORS (explicit list + extra env + private LAN HTTP in development)
const corsAllowList = new Set(['http://localhost:3000', 'http://127.0.0.1:3000', 'https://task-flow-fyp-production.up.railway.app']);
(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
  .forEach((o) => corsAllowList.add(o));

function privateLanDevOrigin(origin) {
  if (!origin || isProduction) return false;
  try {
    const u = new URL(origin);
    if (u.protocol !== 'http:') return false;
    const { hostname } = u;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    return /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
      || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname);
  } catch {
    return false;
  }
}

app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin) return callback(null, true); // Same-origin tools / omit header
    if (corsAllowList.has(origin) || privateLanDevOrigin(origin)) {
      return callback(null, origin); // Reflect allowed origin for credentialed cookies
    }
    return callback(null, false);
  }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24
  }
}));

app.use(passport.initialize());

// ── Landing page at root (before static so index.html is not default)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'landing.html'));
});

// ── Serve static frontend files (whitelist: pages, css, js only) ──
const projectRoot = path.join(__dirname, '..');
const publicPages = ['landing', 'index', 'signup', 'dashboard', 'pending', 'complete', 'stats', 'forgot-password', 'reset-password'];
app.use('/css', express.static(path.join(projectRoot, 'css')));
app.use('/js', express.static(path.join(projectRoot, 'js')));
publicPages.forEach((page) => {
  app.get(`/${page}.html`, (req, res) => res.sendFile(path.join(projectRoot, `${page}.html`)));
});
// ── Auth Routes ───────────────────────────────────────────────────
app.use('/auth', googleAuthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/categories', categoryRoutes);

// ── Health check ──────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', message: 'Task Flow server is running 🚀' });
});

// ── Error handler (must stay after all routes) ───────────────────
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: 'Invalid request.' });
  }
  console.error('[server error]', err);
  res.status(500).json({ error: 'Server error.' });
});

// ── Remove expired verification tokens and reset codes ───────────
async function purgeExpiredCodes() {
  const { query } = require('./db');
  try {
    await query('DELETE FROM email_verifications WHERE expires_at < now()');
    await query('DELETE FROM otp_resets WHERE expires_at < now()');
  } catch (err) {
    console.error('[cleanup] Could not purge expired codes:', err.message);
  }
}

// ── Start Server ────────────────────────────────────────────────────
async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('');
    console.error('  ❌  DATABASE_URL is missing.');
    console.error('      Copy server/.env.example to server/.env and set your PostgreSQL URL.');
    console.error('');
    process.exit(1);
  }
  try {
    const { pool } = require('./db');
    await pool.query('SELECT 1');
    console.log('  📦  PostgreSQL connected');
  } catch (err) {
    console.error('');
    console.error('  ❌  PostgreSQL connection failed:', err.message);
    console.error('      Check DATABASE_URL in server/.env and that PostgreSQL is running.');
    console.error('');
    process.exit(1);
  }

  purgeExpiredCodes();
  setInterval(purgeExpiredCodes, 60 * 60 * 1000).unref();

  app.listen(PORT, () => {
    console.log('');
    console.log('  ✅  Task Flow Server Running');
    console.log(`  🌐  Open: http://localhost:${PORT}  (landing page)`);
    console.log('  📡  API: http://localhost:' + PORT + '/api/ping');
    console.log('');
  });
}

start();
