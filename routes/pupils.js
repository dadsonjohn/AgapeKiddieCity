const express = require('express');
const { CLASS_LEVELS, normalizeClassLevel } = require('../constants');
const { fail, parseId, comparePupils } = require('./helpers');

module.exports = ({ supabase }) => {
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

  // CREATE a new pupil
  router.post('/', async (req, res) => {
    try {
      const { full_name, section, class_level, guardian_name, guardian_phone, enrollment_status } = req.body;

      if (!full_name || !section || !guardian_name || !guardian_phone) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      if (!CLASS_LEVELS[section]) {
        return res.status(400).json({ error: 'Section must be Crèche, Kindergarten, or Primary' });
      }

      const { data, error } = await supabase
        .from('pupils')
        .insert({
          full_name,
          section,
          class_level: normalizeClassLevel(section, class_level),
          guardian_name,
          guardian_phone,
          enrollment_status: enrollment_status || 'Active'
        })
        .select()
        .single();

      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      fail(res, err, 'Failed to create pupil');
    }
  });

  // UPDATE a pupil
  router.put('/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Pupil not found' });

      const { full_name, section, class_level, guardian_name, guardian_phone, enrollment_status } = req.body;
      if (!CLASS_LEVELS[section]) {
        return res.status(400).json({ error: 'Section must be Crèche, Kindergarten, or Primary' });
      }

      const { data, error } = await supabase
        .from('pupils')
        .update({
          full_name,
          section,
          class_level: normalizeClassLevel(section, class_level),
          guardian_name,
          guardian_phone,
          enrollment_status: enrollment_status || 'Active'
        })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Pupil not found' });

      res.json(data);
    } catch (err) {
      fail(res, err, 'Failed to update pupil');
    }
  });

  // DELETE a pupil
  router.delete('/:id', async (req, res) => {
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
