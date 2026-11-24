const express = require('express');
const {
  authClient,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin
} = require('../auth');
const { fail } = require('./helpers');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function mapUser(user) {
  const metadata = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || '',
    full_name: metadata.full_name || user.email || '',
    role: metadata.role === 'admin' ? 'admin' : 'teacher',
    created_at: user.created_at || null,
    last_sign_in_at: user.last_sign_in_at || null
  };
}

async function listAllUsers(supabase) {
  const users = [];
  let page = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    const batch = data.users || [];
    users.push(...batch);

    if (!data.nextPage || batch.length === 0) break;
    page = data.nextPage;
  }

  return users;
}

module.exports = ({ supabase }) => {
  const router = express.Router();

  // Create an account. The first account becomes the administrator; every
  // later sign-up is a teacher.
  router.post('/signup', async (req, res) => {
    try {
      const fullName = normaliseName(req.body.full_name);
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');

      if (!fullName) {
        return res.status(400).json({ error: 'Please enter your full name.' });
      }
      if (!EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      if (password.length > 72) {
        return res.status(400).json({ error: 'Password must be 72 characters or fewer.' });
      }

      const { data: existing, error: listError } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1
      });
      if (listError) throw listError;

      const userCount = typeof existing.total === 'number'
        ? existing.total
        : (existing.users || []).length;
      const role = userCount === 0 ? 'admin' : 'teacher';

      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, role }
      });

      if (error) {
        const message = /already|registered|exists/i.test(error.message || '')
          ? 'An account with this email already exists.'
          : error.message || 'Could not create the account.';
        return res.status(400).json({ error: message });
      }

      const user = { id: data.user.id, email, full_name: fullName, role };
      setSessionCookie(res, user, req);
      res.status(201).json({ user });
    } catch (err) {
      fail(res, err, 'Failed to create account');
    }
  });

  // Log in with email and password.
  router.post('/login', async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const password = String(req.body.password || '');

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const { data, error } = await authClient.auth.signInWithPassword({ email, password });
      if (error || !data || !data.user) {
        return res.status(401).json({ error: 'Incorrect email or password.' });
      }

      const user = mapUser(data.user);
      setSessionCookie(res, user, req);
      res.json({ user });
    } catch (err) {
      fail(res, err, 'Failed to log in');
    }
  });

  router.post('/logout', (req, res) => {
    clearSessionCookie(res, req);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
  });

  // Admin-only: list accounts.
  router.get('/users', requireAdmin, async (req, res) => {
    try {
      const users = await listAllUsers(supabase);
      res.json({ users: users.map(mapUser) });
    } catch (err) {
      fail(res, err, 'Failed to load accounts');
    }
  });

  // Admin-only: promote/demote an account.
  router.patch('/users/:id', requireAdmin, async (req, res) => {
    try {
      const role = String(req.body.role || '');
      if (!['admin', 'teacher'].includes(role)) {
        return res.status(400).json({ error: 'Role must be admin or teacher.' });
      }
      if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'You cannot change your own role.' });
      }

      const users = await listAllUsers(supabase);
      const target = users.find(user => user.id === req.params.id);
      if (!target) return res.status(404).json({ error: 'Account not found.' });

      const targetRole = target.user_metadata && target.user_metadata.role === 'admin'
        ? 'admin'
        : 'teacher';
      const adminCount = users.filter(user => user.user_metadata && user.user_metadata.role === 'admin').length;

      if (targetRole === 'admin' && role !== 'admin' && adminCount <= 1) {
        return res.status(400).json({ error: 'At least one administrator is required.' });
      }

      const { data, error } = await supabase.auth.admin.updateUserById(target.id, {
        user_metadata: { ...(target.user_metadata || {}), role }
      });
      if (error) throw error;

      res.json({ user: mapUser(data.user) });
    } catch (err) {
      fail(res, err, 'Failed to update account');
    }
  });

  // Admin-only: remove an account.
  router.delete('/users/:id', requireAdmin, async (req, res) => {
    try {
      if (req.params.id === req.user.id) {
        return res.status(400).json({ error: 'You cannot delete your own account.' });
      }

      const users = await listAllUsers(supabase);
      const target = users.find(user => user.id === req.params.id);
      if (!target) return res.status(404).json({ error: 'Account not found.' });

      const targetIsAdmin = target.user_metadata && target.user_metadata.role === 'admin';
      const adminCount = users.filter(user => user.user_metadata && user.user_metadata.role === 'admin').length;
      if (targetIsAdmin && adminCount <= 1) {
        return res.status(400).json({ error: 'At least one administrator is required.' });
      }

      const { error } = await supabase.auth.admin.deleteUser(target.id);
      if (error) throw error;

      res.json({ ok: true });
    } catch (err) {
      fail(res, err, 'Failed to delete account');
    }
  });

  return router;
};
