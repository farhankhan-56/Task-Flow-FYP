/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — routes/categories.js  (PostgreSQL)
   ═══════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { query } = require('../db');

const DEFAULT_CATEGORIES = [
  { name: 'Work', color: '#4A90E2' },
  { name: 'Office', color: '#1D5FA8' },
  { name: 'Personal', color: '#10B981' },
  { name: 'Health', color: '#F59E0B' }
];

function rowToCategory(row) {
  return { id: String(row.id), name: row.name, color: row.color };
}

router.use(requireAuth);

async function seedDefaultsIfEmpty(userId) {
  const count = await query('SELECT COUNT(*)::int AS n FROM categories WHERE user_id = $1', [userId]);
  if (count.rows[0].n > 0) return;
  for (const cat of DEFAULT_CATEGORIES) {
    await query(
      'INSERT INTO categories (user_id, name, color) VALUES ($1, $2, $3)',
      [userId, cat.name, cat.color]
    );
  }
}

router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  try {
    await seedDefaultsIfEmpty(userId);
    const result = await query(
      'SELECT id, name, color FROM categories WHERE user_id = $1 ORDER BY created_at ASC',
      [userId]
    );
    res.json({ categories: result.rows.map(rowToCategory) });
  } catch (err) {
    console.error('[categories GET]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/', async (req, res) => {
  const { name, color } = req.body;
  const userId = req.session.user.id;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Category name is required.' });
  }
  if (name.trim().length > 50) {
    return res.status(400).json({ error: 'Category name must be less than 50 characters.' });
  }

  try {
    const result = await query(
      `INSERT INTO categories (user_id, name, color) VALUES ($1, $2, $3)
       RETURNING id, name, color`,
      [userId, name.trim(), color || '#4A90E2']
    );
    res.status(201).json({ message: 'Category created!', category: rowToCategory(result.rows[0]) });
  } catch (err) {
    console.error('[categories POST]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;

  try {
    const result = await query('DELETE FROM categories WHERE id = $1 AND user_id = $2 RETURNING id', [
      id,
      userId
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Category not found.' });
    }
    res.json({ message: 'Category deleted!' });
  } catch (err) {
    console.error('[categories DELETE]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
