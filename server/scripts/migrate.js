/**
 * Applies sql/schema.sql to the database named in DATABASE_URL.
 * Usage (from server folder): npm run db:migrate
 */
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '..', '.env');
// override: true — if Windows has an empty DATABASE_URL set globally, .env still wins
require('dotenv').config({ path: envPath, override: true });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(process.cwd(), '.env'), override: true });
}

const { Client } = require('pg');

/** Fallback if dotenv skips a line (e.g. BOM / encoding quirks on Windows). */
function loadDatabaseUrlManual(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const m = raw.match(/^\s*DATABASE_URL\s*=\s*(.+)$/m);
  if (!m) return;
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  if (v) process.env.DATABASE_URL = v;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    loadDatabaseUrlManual(envPath);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Missing DATABASE_URL after loading .env');
    console.error('Looked for:', envPath);
    console.error('File exists:', fs.existsSync(envPath));
    console.error('Tip: Use DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/taskflow (no quotes).');
    process.exit(1);
  }
  const sqlPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Migration OK:', sqlPath);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
