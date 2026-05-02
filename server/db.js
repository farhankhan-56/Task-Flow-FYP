const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || '';

if (!connectionString) {
  console.warn(
    '[db] DATABASE_URL is not set. Create server/.env with DATABASE_URL=postgresql://...'
  );
}

/** Local Postgres (no TLS) vs hosted DBs usually requiring SSL */
function resolveSsl(cs) {
  if (!cs) return false;
  if (process.env.PG_SSL === '0') return false;
  if (process.env.PG_SSL === '1') {
    return { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === '1' };
  }
  const localhost =
    /^postgres(?:ql)?:\/\/[^@\s]*@(?:localhost|127\.0\.0\.1)[:\/\s?]/i.test(cs);
  const sslInUrl =
    /sslmode\s*=\s*require|\?.*ssl\s*=\s*true|\&ssl\s*=\s*true/i.test(cs);
  if (localhost && !sslInUrl) return false;
  return { rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED === '1' };
}

const ssl = resolveSsl(connectionString);

const pool = new Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  ...(ssl !== false ? { ssl } : {})
});

function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
