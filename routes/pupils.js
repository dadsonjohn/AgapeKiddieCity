const express = require('express');

const CLASS_LEVELS = {
  'Crèche': ['Crèche'],
  'Kindergarten': ['Kindergarten 1', 'Kindergarten 2'],
  'Primary': ['Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6']
};

function normalizeClassLevel(section, classLevel) {
  const allowed = CLASS_LEVELS[section];
  if (!allowed) return null;
  return allowed.includes(classLevel) ? classLevel : allowed[0];
}

module.exports = ({ run, get, all }) => {
  const router = express.Router();

  // GET all pupils, with optional section/class filter and search
  router.get('/', (req, res) => {
    try {
      let sql = 'SELECT * FROM pupils';
      const params = [];
      const conditions = [];

      if (req.query.section) {
        conditions.push('section = ?');
        params.push(req.query.section);
      }
      if (req.query.class_level) {
        conditions.push('class_level = ?');
        params.push(req.query.class_level);
      }
      if (req.query.search) {
        conditions.push('(full_name LIKE ? OR guardian_name LIKE ?)');
        params.push(`%${req.query.search}%`, `%${req.query.search}%`);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      sql += `
        ORDER BY
          CASE section WHEN 'Crèche' THEN 1 WHEN 'Kindergarten' THEN 2 ELSE 3 END,
          class_level ASC,
          full_name ASC
      `;

      const pupils = all(sql, params);
      res.json(pupils);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch pupils' });
    }
  });

  // GET single pupil by id
  router.get('/:id', (req, res) => {
    try {
      const pupil = get('SELECT * FROM pupils WHERE id = ?', [req.params.id]);
      if (!pupil) {
        return res.status(404).json({ error: 'Pupil not found' });
      }
      res.json(pupil);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch pupil' });
    }
  });

  // CREATE a new pupil
  router.post('/', (req, res) => {
    try {
      const { full_name, section, class_level, guardian_name, guardian_phone, enrollment_status } = req.body;

      if (!full_name || !section || !guardian_name || !guardian_phone) {
        return res.status(400).json({ error: 'All fields are required' });
      }
      if (!CLASS_LEVELS[section]) {
        return res.status(400).json({ error: 'Section must be Crèche, Kindergarten, or Primary' });
      }

      const classLevel = normalizeClassLevel(section, class_level);

      const info = run(`
        INSERT INTO pupils (full_name, section, class_level, guardian_name, guardian_phone, enrollment_status)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [full_name, section, classLevel, guardian_name, guardian_phone, enrollment_status || 'Active']);

      const newPupil = get('SELECT * FROM pupils WHERE id = ?', [info.lastInsertRowid]);
      res.status(201).json(newPupil);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create pupil' });
    }
  });

  // UPDATE a pupil
  router.put('/:id', (req, res) => {
    try {
      const { full_name, section, class_level, guardian_name, guardian_phone, enrollment_status } = req.body;

      const existing = get('SELECT id FROM pupils WHERE id = ?', [req.params.id]);
      if (!existing) {
        return res.status(404).json({ error: 'Pupil not found' });
      }
      if (!CLASS_LEVELS[section]) {
        return res.status(400).json({ error: 'Section must be Crèche, Kindergarten, or Primary' });
      }

      const classLevel = normalizeClassLevel(section, class_level);

      run(`
        UPDATE pupils
        SET full_name = ?, section = ?, class_level = ?, guardian_name = ?, guardian_phone = ?, enrollment_status = ?
        WHERE id = ?
      `, [full_name, section, classLevel, guardian_name, guardian_phone, enrollment_status || 'Active', req.params.id]);

      const updated = get('SELECT * FROM pupils WHERE id = ?', [req.params.id]);
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to update pupil' });
    }
  });

  // DELETE a pupil
  router.delete('/:id', (req, res) => {
    try {
      const existing = get('SELECT id FROM pupils WHERE id = ?', [req.params.id]);
      if (!existing) {
        return res.status(404).json({ error: 'Pupil not found' });
      }

      run('DELETE FROM pupils WHERE id = ?', [req.params.id]);
      res.json({ message: 'Pupil deleted successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete pupil' });
    }
  });

  return router;
};
