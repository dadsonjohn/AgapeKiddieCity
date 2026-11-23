const express = require('express');

module.exports = ({ run, get, all }) => {
  const router = express.Router();

  // GET attendance records with optional date and section filter
  router.get('/', (req, res) => {
    try {
      let sql = `
        SELECT a.*, p.full_name AS pupil_name, p.section AS pupil_section
        FROM attendance a
        JOIN pupils p ON a.pupil_id = p.id
      `;
      const params = [];
      const conditions = [];

      if (req.query.date) {
        conditions.push('a.attendance_date = ?');
        params.push(req.query.date);
      }
      if (req.query.section) {
        conditions.push('p.section = ?');
        params.push(req.query.section);
      }
      if (req.query.class_level) {
        conditions.push('p.class_level = ?');
        params.push(req.query.class_level);
      }

      if (conditions.length > 0) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }
      sql += ' ORDER BY a.attendance_date DESC, p.full_name ASC';

      const records = all(sql, params);
      res.json(records);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch attendance' });
    }
  });

  // GET attendance for a specific date
  router.get('/date/:date', (req, res) => {
    try {
      const records = all(`
        SELECT a.*, p.full_name AS pupil_name, p.section AS pupil_section
        FROM attendance a
        JOIN pupils p ON a.pupil_id = p.id
        WHERE a.attendance_date = ?
        ORDER BY p.full_name ASC
      `, [req.params.date]);
      res.json(records);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch attendance for date' });
    }
  });

  // MARK attendance for every pupil in a group (upsert)
  router.post('/bulk', (req, res) => {
    try {
      const { pupil_ids, attendance_date, status } = req.body;

      if (!Array.isArray(pupil_ids) || pupil_ids.length === 0 || !attendance_date || !status) {
        return res.status(400).json({ error: 'pupil_ids, attendance_date, and status are required' });
      }

      const validStatuses = ['Present', 'Absent', 'Late'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Status must be Present, Absent, or Late' });
      }

      let saved = 0;
      pupil_ids.forEach(pupilId => {
        const existing = get(
          'SELECT id FROM attendance WHERE pupil_id = ? AND attendance_date = ?',
          [pupilId, attendance_date]
        );

        if (existing) {
          run('UPDATE attendance SET status = ? WHERE id = ?', [status, existing.id]);
        } else {
          run(
            'INSERT INTO attendance (pupil_id, attendance_date, status) VALUES (?, ?, ?)',
            [pupilId, attendance_date, status]
          );
        }
        saved += 1;
      });

      res.json({ saved, attendance_date, status });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to save attendance' });
    }
  });

  // MARK attendance for a pupil on a date (upsert)
  router.post('/', (req, res) => {
    try {
      const { pupil_id, attendance_date, status } = req.body;

      if (!pupil_id || !attendance_date || !status) {
        return res.status(400).json({ error: 'pupil_id, attendance_date, and status are required' });
      }

      const validStatuses = ['Present', 'Absent', 'Late'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Status must be Present, Absent, or Late' });
      }

      const pupil = get('SELECT id FROM pupils WHERE id = ?', [pupil_id]);
      if (!pupil) {
        return res.status(404).json({ error: 'Pupil not found' });
      }

      const existing = get('SELECT id FROM attendance WHERE pupil_id = ? AND attendance_date = ?', [pupil_id, attendance_date]);

      let result;
      if (existing) {
        run('UPDATE attendance SET status = ? WHERE id = ?', [status, existing.id]);
        result = get('SELECT * FROM attendance WHERE id = ?', [existing.id]);
      } else {
        const info = run(`
          INSERT INTO attendance (pupil_id, attendance_date, status)
          VALUES (?, ?, ?)
        `, [pupil_id, attendance_date, status]);
        result = get('SELECT * FROM attendance WHERE id = ?', [info.lastInsertRowid]);
      }

      res.json(result);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to mark attendance' });
    }
  });

  // GET attendance summary by section and date
  router.get('/summary/:date', (req, res) => {
    try {
      const date = req.params.date;
      const sections = ['Crèche', 'Kindergarten', 'Primary'];
      const summary = [];

      for (const section of sections) {
        const stats = get(`
          SELECT
            COUNT(a.id) as total_marked,
            SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) as present,
            SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as absent,
            SUM(CASE WHEN a.status = 'Late' THEN 1 ELSE 0 END) as late
          FROM attendance a
          JOIN pupils p ON a.pupil_id = p.id
          WHERE a.attendance_date = ? AND p.section = ?
        `, [date, section]);

        const totalPupilsInSection = get('SELECT COUNT(*) as count FROM pupils WHERE section = ?', [section]);

        summary.push({
          section,
          total_pupils: totalPupilsInSection ? totalPupilsInSection.count : 0,
          total_marked: stats.total_marked || 0,
          present: stats.present || 0,
          absent: stats.absent || 0,
          late: stats.late || 0
        });
      }

      res.json({ date, summary });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch attendance summary' });
    }
  });

  // DELETE attendance record
  router.delete('/:id', (req, res) => {
    try {
      const existing = get('SELECT id FROM attendance WHERE id = ?', [req.params.id]);
      if (!existing) {
        return res.status(404).json({ error: 'Attendance record not found' });
      }

      run('DELETE FROM attendance WHERE id = ?', [req.params.id]);
      res.json({ message: 'Attendance record deleted successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete attendance record' });
    }
  });

  return router;
};
