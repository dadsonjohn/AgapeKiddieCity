const express = require('express');
const { CLASS_LEVELS, normalizeClassLevel } = require('../constants');
const { fail, parseId, comparePupils } = require('./helpers');

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizePhone(value) {
  return String(value || '').trim();
}

function isValidPhone(value) {
  return /^\d{10}$/.test(normalizePhone(value));
}

// A pupil is a duplicate when the name matches and either the guardian phone
// matches, or the same guardian name and class match. The second rule catches
// repeated entries where the phone was mistyped.
async function findDuplicatePupil(supabase, { fullName, guardianName, guardianPhone, section, classLevel, excludeId }) {
  const { data, error } = await supabase
    .from('pupils')
    .select('id, full_name, guardian_name, guardian_phone, section, class_level');
  if (error) throw error;

  const name = normalizeName(fullName);
  const phone = normalizePhone(guardianPhone);
  const guardian = normalizeName(guardianName);

  for (const pupil of data || []) {
    if (excludeId && Number(pupil.id) === Number(excludeId)) continue;
    if (normalizeName(pupil.full_name) !== name) continue;

    if (normalizePhone(pupil.guardian_phone) === phone) {
      return { reason: 'phone', pupil };
    }

    const sameGuardian = normalizeName(pupil.guardian_name) === guardian;
    const sameClass = pupil.section === section
      && (pupil.class_level || pupil.section) === (classLevel || section);

    if (sameGuardian && sameClass) {
      return { reason: 'class', pupil };
    }
  }

  return null;
}

function duplicateMessage(duplicate) {
  return duplicate.reason === 'phone'
    ? 'This pupil is already registered with the same name and guardian phone.'
    : 'This pupil is already registered in the same class with the same guardian name.';
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

  // CREATE a new pupil (admin only)
  router.post('/', requireAdmin, async (req, res) => {
    try {
      const fullName = String(req.body.full_name || '').trim().replace(/\s+/g, ' ');
      const section = req.body.section;
      const guardianName = String(req.body.guardian_name || '').trim().replace(/\s+/g, ' ');
      const guardianPhone = normalizePhone(req.body.guardian_phone);
      const enrollmentStatus = req.body.enrollment_status || 'Active';

      if (!fullName || !section || !guardianName || !guardianPhone) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      if (!CLASS_LEVELS[section]) {
        return res.status(400).json({ error: 'Section must be Crèche, Kindergarten, or Primary' });
      }
      if (!isValidPhone(guardianPhone)) {
        return res.status(400).json({ error: 'Guardian phone must be exactly 10 digits (numbers only).' });
      }

      const classLevel = normalizeClassLevel(section, req.body.class_level);
      const duplicate = await findDuplicatePupil(supabase, {
        fullName,
        guardianName,
        guardianPhone,
        section,
        classLevel
      });
      if (duplicate) {
        return res.status(409).json({ error: duplicateMessage(duplicate) });
      }

      const { data, error } = await supabase
        .from('pupils')
        .insert({
          full_name: fullName,
          section,
          class_level: classLevel,
          guardian_name: guardianName,
          guardian_phone: guardianPhone,
          enrollment_status: enrollmentStatus
        })
        .select()
        .single();

      if (error) {
        // A database-level unique index may reject a duplicate that slipped
        // past the check above (for example during simultaneous requests).
        if (error.code === '23505') {
          return res.status(409).json({ error: 'This pupil already exists.' });
        }
        throw error;
      }

      res.status(201).json(data);
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

      if (!fullName || !section || !guardianName || !guardianPhone) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      if (!CLASS_LEVELS[section]) {
        return res.status(400).json({ error: 'Section must be Crèche, Kindergarten, or Primary' });
      }
      if (!isValidPhone(guardianPhone)) {
        return res.status(400).json({ error: 'Guardian phone must be exactly 10 digits (numbers only).' });
      }

      const classLevel = normalizeClassLevel(section, req.body.class_level);
      const duplicate = await findDuplicatePupil(supabase, {
        fullName,
        guardianName,
        guardianPhone,
        section,
        classLevel,
        excludeId: id
      });
      if (duplicate) {
        return res.status(409).json({ error: duplicateMessage(duplicate) });
      }

      const { data, error } = await supabase
        .from('pupils')
        .update({
          full_name: fullName,
          section,
          class_level: classLevel,
          guardian_name: guardianName,
          guardian_phone: guardianPhone,
          enrollment_status: enrollmentStatus
        })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'This pupil already exists.' });
        }
        throw error;
      }
      if (!data) return res.status(404).json({ error: 'Pupil not found' });

      res.json(data);
    } catch (err) {
      fail(res, err, 'Failed to update pupil');
    }
  });

  // DELETE a pupil (admin only)
  router.delete('/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Pupil not found' });

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
