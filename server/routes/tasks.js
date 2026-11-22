/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — routes/tasks.js  (PostgreSQL)
   ═══════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();
const requireAuth = require('../middleware/auth');
const { query } = require('../db');
const { isUuid } = require('../utils/validators');

const VALID_STATUSES = ['pending', 'complete'];
const VALID_PRIORITIES = ['high', 'medium', 'low'];
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

const isValidStatus = (s) => VALID_STATUSES.includes(s);
const isValidPriority = (p) => VALID_PRIORITIES.includes(p);

async function isOwnCategory(categoryId, userId) {
  if (!isUuid(categoryId)) return false;
  const result = await query('SELECT 1 FROM categories WHERE id = $1 AND user_id = $2', [categoryId, userId]);
  return result.rows.length > 0;
}

function taskTextError(title, description) {
  if (typeof title !== 'string' || title.trim() === '') return 'Task title is required.';
  if (title.trim().length > MAX_TITLE_LENGTH) return `Task title must be ${MAX_TITLE_LENGTH} characters or fewer.`;
  if (description && typeof description !== 'string') return 'Description must be text.';
  if (description && description.trim().length > MAX_DESCRIPTION_LENGTH) return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
  return null;
}

function formatDateOnly(val) {
  if (!val) return null;
  if (val instanceof Date) return [val.getFullYear(), val.getMonth() + 1, val.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
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

router.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return res.status(404).json({ error: 'Task not found.' });
  next();
});

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

  const textError = taskTextError(title, description);
  if (textError) {
    return res.status(400).json({ error: textError });
  }
  if (priority && !isValidPriority(priority)) {
    return res.status(400).json({ error: 'Invalid priority. Must be "high", "medium" or "low".' });
  }

  const pri = priority && isValidPriority(priority) ? priority : 'medium';
  const due = dueDate && String(dueDate).trim() !== '' ? String(dueDate).slice(0, 10) : null;
  const catId = category && String(category).trim() !== '' ? category : null;

  try {
    if (catId && !(await isOwnCategory(catId, userId))) {
      return res.status(400).json({ error: 'Invalid category.' });
    }
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
    if (err.code === '22007' || err.code === '22008') {
      return res.status(400).json({ error: 'Invalid due date.' });
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

    const textError = taskTextError(title === undefined ? task.title : title, description);
    if (textError) {
      return res.status(400).json({ error: textError });
    }
    if (priority !== undefined && !isValidPriority(priority)) {
      return res.status(400).json({ error: 'Invalid priority. Must be "high", "medium" or "low".' });
    }

    if (title !== undefined) task.title = title.trim();
    if (description !== undefined) task.description = (description || '').trim();
    if (dueDate !== undefined) {
      task.due_date = dueDate && String(dueDate).trim() !== '' ? String(dueDate).slice(0, 10) : null;
    }
    if (priority !== undefined && isValidPriority(priority)) task.priority = priority;
    if (category !== undefined) {
      task.category_id = category && String(category).trim() !== '' ? category : null;
      if (task.category_id && !(await isOwnCategory(task.category_id, userId))) {
        return res.status(400).json({ error: 'Invalid category.' });
      }
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
    if (err.code === '22007' || err.code === '22008') {
      return res.status(400).json({ error: 'Invalid due date.' });
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
