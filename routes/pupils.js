const express = require('express');
const { CLASS_LEVELS, normalizeClassLevel } = require('../constants');
const { fail, parseId, comparePupils, isMissingTable, isMissingColumn } = require('./helpers');

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').trim();
}

function isValidPhone(value) {
  return /^\d{10}$/.test(normalizePhone(value));
}

// Returns null for an empty birthday, undefined for an invalid one, and the
// ISO date string (YYYY-MM-DD) for a valid one.
function normalizeBirthday(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    return undefined;
  }

  return text;
}

// A pupil name must be unique across the school. This is intentionally strict:
// the same child entered twice with a different phone, guardian, or class is
// still a duplicate. Use the full name (including middle names) to tell two
// genuine namesakes apart.
async function findDuplicatePupil(supabase, { fullName, excludeId }) {
  const name = normalizeName(fullName);
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('pupils')
      .select('id, full_name')
      .range(from, from + pageSize - 1);
    if (error) throw error;

    for (const pupil of data || []) {
      if (excludeId && Number(pupil.id) === Number(excludeId)) continue;
      if (normalizeName(pupil.full_name) === name) return pupil;
    }

    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return null;
}

function duplicateMessage(fullName) {
  return `A pupil named "${fullName}" is already registered. If this is a different child, use their full name including any middle names.`;
}

async function findPendingRequest(supabase, pupilId) {
  const { data, error } = await supabase
    .from('pupil_delete_requests')
    .select('*')
    .eq('pupil_id', pupilId)
    .eq('status', 'Pending')
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) return null;
    throw error;
  }

  return data || null;
}

function setupRequired(res) {
  return res.status(503).json({
    error: 'Delete requests are not set up in the database yet. Run supabase/apply-updates.sql in the Supabase SQL Editor.'
  });
}

module.exports = ({ supabase, requireAdmin }) => {
  const router = express.Router();

  // GET all pupils, with optional section/class filter and search
  router.get('/', async (req, res) => {
    try {
      let query = supabase.from('pupils').select('*');

      if (req.query.section) {
        query = query.eq('section', req.query.section);
      }
      if (req.query.class_level) {
        query = query.eq('class_level', req.query.class_level);
      }
      if (req.query.search) {
        const term = String(req.query.search).replace(/[%,()]/g, ' ').trim();
        if (term) {
          const pattern = `%${term}%`;
          query = query.or(`full_name.ilike.${pattern},guardian_name.ilike.${pattern}`);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      res.json((data || []).sort(comparePupils));
    } catch (err) {
      fail(res, err, 'Failed to fetch pupils');
    }
  });

  // GET delete requests. Administrators see every request; teachers only see
  // the requests they made.
  router.get('/delete-requests', async (req, res) => {
    try {
      let query = supabase
        .from('pupil_delete_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (req.user.role !== 'admin') {
        query = query.eq('requested_by_id', req.user.id);
      }
      if (req.query.status) {
        query = query.eq('status', req.query.status);
      }

      const { data, error } = await query;
      if (error) {
        if (isMissingTable(error)) {
          return res.json({ requests: [], setupRequired: true });
        }
        throw error;
      }

      res.json({ requests: data || [] });
    } catch (err) {
      fail(res, err, 'Failed to load delete requests');
    }
  });

  // Admin-only: approve a delete request and delete the pupil.
  router.post('/delete-requests/:id/approve', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Delete request not found' });

      const { data: request, error } = await supabase
        .from('pupil_delete_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }
      if (!request) return res.status(404).json({ error: 'Delete request not found' });
      if (request.status !== 'Pending') {
        return res.status(400).json({ error: `This request was already ${String(request.status).toLowerCase()}.` });
      }

      if (request.pupil_id) {
        const { error: deleteError } = await supabase
          .from('pupils')
          .delete()
          .eq('id', request.pupil_id);
        if (deleteError) throw deleteError;
      }

      const { data: updated, error: updateError } = await supabase
        .from('pupil_delete_requests')
        .update({
          status: 'Approved',
          reviewed_by_name: req.user.full_name || req.user.email,
          reviewed_by_email: req.user.email,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      res.json({ message: 'Pupil deleted and request approved.', request: updated });
    } catch (err) {
      fail(res, err, 'Failed to approve delete request');
    }
  });

  // Admin-only: reject a delete request.
  router.post('/delete-requests/:id/reject', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Delete request not found' });

      const { data: request, error } = await supabase
        .from('pupil_delete_requests')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }
      if (!request) return res.status(404).json({ error: 'Delete request not found' });
      if (request.status !== 'Pending') {
        return res.status(400).json({ error: `This request was already ${String(request.status).toLowerCase()}.` });
      }

      const { data: updated, error: updateError } = await supabase
        .from('pupil_delete_requests')
        .update({
          status: 'Rejected',
          reviewed_by_name: req.user.full_name || req.user.email,
          reviewed_by_email: req.user.email,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (updateError) throw updateError;

      res.json({ message: 'Delete request rejected.', request: updated });
    } catch (err) {
      fail(res, err, 'Failed to reject delete request');
    }
  });

  // GET single pupil by id
  router.get('/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Pupil not found' });

      const { data, error } = await supabase.from('pupils').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Pupil not found' });

      res.json(data);
    } catch (err) {
      fail(res, err, 'Failed to fetch pupil');
    }
  });

  // CREATE a new pupil. Teachers can add pupils; editing and deleting are
  // still administrator-only.
  router.post('/', async (req, res) => {
    try {
      const fullName = String(req.body.full_name || '').trim().replace(/\s+/g, ' ');
      const section = req.body.section;
      const guardianName = String(req.body.guardian_name || '').trim().replace(/\s+/g, ' ');
      const guardianPhone = normalizePhone(req.body.guardian_phone);
      const enrollmentStatus = req.body.enrollment_status || 'Active';
      const birthday = normalizeBirthday(req.body.date_of_birth);

      if (!fullName || !section || !guardianName || !guardianPhone) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      if (!CLASS_LEVELS[section]) {
        return res.status(400).json({ error: 'Section must be Crèche, Kindergarten, or Primary' });
      }
      if (!isValidPhone(guardianPhone)) {
        return res.status(400).json({ error: 'Guardian phone must be exactly 10 digits (numbers only).' });
      }
      if (birthday === undefined) {
        return res.status(400).json({ error: 'Birthday must be a valid date.' });
      }

      const classLevel = normalizeClassLevel(section, req.body.class_level);
      const duplicate = await findDuplicatePupil(supabase, { fullName });
      if (duplicate) {
        return res.status(409).json({ error: duplicateMessage(fullName) });
      }

      const payload = {
        full_name: fullName,
        section,
        class_level: classLevel,
        guardian_name: guardianName,
        guardian_phone: guardianPhone,
        enrollment_status: enrollmentStatus
      };
      if (birthday) payload.date_of_birth = birthday;

      let { data, error } = await supabase
        .from('pupils')
        .insert(payload)
        .select()
        .single();

      let warning;
      if (error && isMissingColumn(error, 'date_of_birth')) {
        // Keep pupil creation working before the database update is applied.
        delete payload.date_of_birth;
        ({ data, error } = await supabase
          .from('pupils')
          .insert(payload)
          .select()
          .single());
        warning = 'Pupil saved, but birthdays are not set up in the database yet. Run supabase/apply-updates.sql.';
      }

      if (error) {
        // The database trigger or unique index may reject a duplicate that
        // slipped past the check above (for example during simultaneous requests).
        if (error.code === '23505') {
          return res.status(409).json({ error: duplicateMessage(fullName) });
        }
        throw error;
      }

      res.status(201).json(warning ? { ...data, warning } : data);
    } catch (err) {
      fail(res, err, 'Failed to create pupil');
    }
  });

  // UPDATE a pupil (admin only)
  router.put('/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Pupil not found' });

      const fullName = String(req.body.full_name || '').trim().replace(/\s+/g, ' ');
      const section = req.body.section;
      const guardianName = String(req.body.guardian_name || '').trim().replace(/\s+/g, ' ');
      const guardianPhone = normalizePhone(req.body.guardian_phone);
      const enrollmentStatus = req.body.enrollment_status || 'Active';
      const birthday = normalizeBirthday(req.body.date_of_birth);

      if (!fullName || !section || !guardianName || !guardianPhone) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      if (!CLASS_LEVELS[section]) {
        return res.status(400).json({ error: 'Section must be Crèche, Kindergarten, or Primary' });
      }
      if (!isValidPhone(guardianPhone)) {
        return res.status(400).json({ error: 'Guardian phone must be exactly 10 digits (numbers only).' });
      }
      if (birthday === undefined) {
        return res.status(400).json({ error: 'Birthday must be a valid date.' });
      }

      const classLevel = normalizeClassLevel(section, req.body.class_level);
      const duplicate = await findDuplicatePupil(supabase, { fullName, excludeId: id });
      if (duplicate) {
        return res.status(409).json({ error: duplicateMessage(fullName) });
      }

      const payload = {
        full_name: fullName,
        section,
        class_level: classLevel,
        guardian_name: guardianName,
        guardian_phone: guardianPhone,
        enrollment_status: enrollmentStatus,
        date_of_birth: birthday
      };

      let { data, error } = await supabase
        .from('pupils')
        .update(payload)
        .eq('id', id)
        .select()
        .maybeSingle();

      let warning;
      if (error && isMissingColumn(error, 'date_of_birth')) {
        delete payload.date_of_birth;
        ({ data, error } = await supabase
          .from('pupils')
          .update(payload)
          .eq('id', id)
          .select()
          .maybeSingle());
        warning = 'Pupil saved, but birthdays are not set up in the database yet. Run supabase/apply-updates.sql.';
      }

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: duplicateMessage(fullName) });
        }
        throw error;
      }
      if (!data) return res.status(404).json({ error: 'Pupil not found' });

      res.json(warning ? { ...data, warning } : data);
    } catch (err) {
      fail(res, err, 'Failed to update pupil');
    }
  });

  // REQUEST a pupil deletion. Any signed-in user may request one, but only an
  // administrator can approve it.
  router.post('/:id/delete-request', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Pupil not found' });

      const { data: pupil, error: pupilError } = await supabase
        .from('pupils')
        .select('id, full_name, section, class_level')
        .eq('id', id)
        .maybeSingle();
      if (pupilError) throw pupilError;
      if (!pupil) return res.status(404).json({ error: 'Pupil not found' });

      const pending = await findPendingRequest(supabase, id);
      if (pending) {
        return res.status(409).json({ error: 'A delete request for this pupil is already waiting for an administrator.' });
      }

      const reason = String(req.body.reason || '').trim().slice(0, 500) || null;
      const { data, error } = await supabase
        .from('pupil_delete_requests')
        .insert({
          pupil_id: pupil.id,
          pupil_name: pupil.full_name,
          pupil_class: pupil.class_level || pupil.section,
          requested_by_id: req.user.id,
          requested_by_name: req.user.full_name || req.user.email,
          requested_by_email: req.user.email,
          reason
        })
        .select()
        .single();

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        if (error.code === '23505') {
          return res.status(409).json({ error: 'A delete request for this pupil is already waiting for an administrator.' });
        }
        throw error;
      }

      res.status(201).json({
        request: data,
        message: 'Delete request sent to an administrator for approval.'
      });
    } catch (err) {
      fail(res, err, 'Failed to send delete request');
    }
  });

  // DELETE a pupil (admin only). Any pending request for the pupil is marked
  // approved so teachers do not see a stale request.
  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Pupil not found' });

      const { error: requestError } = await supabase
        .from('pupil_delete_requests')
        .update({
          status: 'Approved',
          reviewed_by_name: req.user.full_name || req.user.email,
          reviewed_by_email: req.user.email,
          reviewed_at: new Date().toISOString()
        })
        .eq('pupil_id', id)
        .eq('status', 'Pending');
      if (requestError && !isMissingTable(requestError)) throw requestError;

      const { data, error } = await supabase.from('pupils').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data || data.length === 0) {
        return res.status(404).json({ error: 'Pupil not found' });
      }

      res.json({ message: 'Pupil deleted successfully' });
    } catch (err) {
      fail(res, err, 'Failed to delete pupil');
    }
  });

  return router;
};
