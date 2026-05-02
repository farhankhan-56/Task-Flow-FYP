/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — routes/tasks.js  (PostgreSQL)
   ═══════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { query } = require('../db');

const VALID_STATUSES = ['pending', 'complete'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];

const isValidStatus = (s) => VALID_STATUSES.includes(s);
const isValidPriority = (p) => VALID_PRIORITIES.includes(p);

function formatDateOnly(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'string') return val.slice(0, 10);
  return null;
}

function rowToTask(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: row.title,
    description: row.description || '',
    dueDate: formatDateOnly(row.due_date),
    priority: row.priority,
    category: row.category_id ? String(row.category_id) : null,
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
  };
}

router.use(requireAuth);

router.get('/', async (req, res) => {
  const userId = req.session.user.id;
  try {
    const result = await query(
      `SELECT id, user_id, category_id, title, description, due_date, priority, status, created_at, completed_at
       FROM tasks WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ tasks: result.rows.map(rowToTask) });
  } catch (err) {
    console.error('[tasks GET]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.post('/', async (req, res) => {
  const { title, description, dueDate, priority, category } = req.body;
  const userId = req.session.user.id;

  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Task title is required.' });
  }

  const pri = priority && isValidPriority(priority) ? priority : 'medium';
  const due = dueDate && String(dueDate).trim() !== '' ? String(dueDate).slice(0, 10) : null;
  const catId = category && String(category).trim() !== '' ? category : null;

  try {
    const result = await query(
      `INSERT INTO tasks (user_id, category_id, title, description, due_date, priority, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, user_id, category_id, title, description, due_date, priority, status, created_at, completed_at`,
      [userId, catId, title.trim(), (description && description.trim()) || '', due, pri]
    );
    res.status(201).json({ message: 'Task created!', task: rowToTask(result.rows[0]) });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid category.' });
    }
    console.error('[tasks POST]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.put('/:id', async (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;

  try {
    const existing = await query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [id, userId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    const task = existing.rows[0];
    const { title, description, dueDate, priority, category } = req.body;

    if (title !== undefined) task.title = title.trim();
    if (description !== undefined) task.description = description.trim();
    if (dueDate !== undefined) {
      task.due_date = dueDate && String(dueDate).trim() !== '' ? String(dueDate).slice(0, 10) : null;
    }
    if (priority !== undefined && isValidPriority(priority)) task.priority = priority;
    if (category !== undefined) {
      task.category_id = category && String(category).trim() !== '' ? category : null;
    }

    const result = await query(
      `UPDATE tasks SET
         title = $1,
         description = $2,
         due_date = $3,
         priority = $4,
         category_id = $5
       WHERE id = $6 AND user_id = $7
       RETURNING id, user_id, category_id, title, description, due_date, priority, status, created_at, completed_at`,
      [task.title, task.description, task.due_date, task.priority, task.category_id, id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    res.json({ message: 'Task updated!', task: rowToTask(result.rows[0]) });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Invalid category.' });
    }
    console.error('[tasks PUT]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.patch('/:id/status', async (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;
  const { status } = req.body;

  if (!isValidStatus(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be "pending" or "complete".' });
  }

  try {
    const result = await query(
      `UPDATE tasks
       SET status = $1,
           completed_at = CASE WHEN $1 = 'complete' THEN now() ELSE NULL END
       WHERE id = $2 AND user_id = $3
       RETURNING id, user_id, category_id, title, description, due_date, priority, status, created_at, completed_at`,
      [status, id, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    res.json({ message: 'Task status updated!', task: rowToTask(result.rows[0]) });
  } catch (err) {
    console.error('[tasks PATCH status]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = req.session.user.id;
  const { id } = req.params;

  try {
    const result = await query('DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    res.json({ message: 'Task deleted!' });
  } catch (err) {
    console.error('[tasks DELETE]', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
