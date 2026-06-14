/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — server.js  (Entry Point)
   ═══════════════════════════════════════════════════════════════ */

require('dotenv').config({
  path: require('path').join(__dirname, '.env'),
  override: true
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

if (isProduction && !process.env.SESSION_SECRET) {
  console.error('');
  console.error('  ❌  SESSION_SECRET is required when NODE_ENV=production.');
  console.error('      Set it in Railway/host env vars.');
  console.error('');
  process.exit(1);
}

if (isProduction || process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

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
  secret: process.env.SESSION_SECRET || (!isProduction ? 'taskflow-secret-key-fyp-dev' : ''),
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

// ── Serve static frontend files ───────────────────────────────────
app.use(express.static(path.join(__dirname, '..')));

// ── Auth Routes ───────────────────────────────────────────────────
app.use('/auth', googleAuthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/categories', categoryRoutes);

// ── Health check ──────────────────────────────────────────────────
app.get('/api/ping', (req, res) => {
  res.json({ status: 'ok', message: 'Task Flow server is running 🚀' });
});

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

  app.listen(PORT, () => {
    console.log('');
    console.log('  ✅  Task Flow Server Running');
    console.log(`  🌐  Open: http://localhost:${PORT}  (landing page)`);
    console.log('  📡  API: http://localhost:' + PORT + '/api/ping');
    console.log('');
  });
}

start();
