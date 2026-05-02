/* ═══════════════════════════════════════════════════════════════
   TASK FLOW — middleware/auth.js
   Protects routes — rejects requests if user is not logged in
   ═══════════════════════════════════════════════════════════════ */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
  next();
}

module.exports = requireAuth;
