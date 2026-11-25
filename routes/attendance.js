const express = require('express');
const { SECTIONS, CLASS_ORDER, sectionForClass } = require('../constants');
const { fail, parseId } = require('./helpers');

const ATTENDANCE_SELECT = '*, pupil:pupils!inner(full_name, section, class_level)';

function mapRecord(row) {
  const { pupil, ...record } = row;
  return {
    ...record,
    pupil_name: pupil ? pupil.full_name : 'Unknown pupil',
    pupil_section: pupil ? pupil.section : '',
    pupil_class: pupil && pupil.class_level ? pupil.class_level : (pupil ? pupil.section : '')
  };
}

function classForPupil(pupil) {
  return pupil.class_level || pupil.section;
}

module.exports = ({ supabase }) => {
  const router = express.Router();

  async function fetchAttendance(filters = {}) {
    let query = supabase
      .from('attendance')
      .select(ATTENDANCE_SELECT)
      .order('attendance_date', { ascending: false });

    if (filters.date) {
      query = query.eq('attendance_date', filters.date);
    }

    const { data, error } = await query;
    if (error) throw error;

    let records = (data || []).map(mapRecord);

    if (filters.section) {
      records = records.filter(record => record.pupil_section === filters.section);
    }
    if (filters.classLevel) {
      records = records.filter(record => record.pupil_class === filters.classLevel);
    }

    records.sort((a, b) => {
      if (a.attendance_date !== b.attendance_date) {
        return String(b.attendance_date).localeCompare(String(a.attendance_date));
      }
      return String(a.pupil_name).localeCompare(String(b.pupil_name));
    });

    return records;
  }

  // GET attendance records with optional date and section/class filter
  router.get('/', async (req, res) => {
    try {
      const records = await fetchAttendance({
        date: req.query.date,
        section: req.query.section,
        classLevel: req.query.class_level
      });
      res.json(records);
    } catch (err) {
      fail(res, err, 'Failed to fetch attendance');
    }
  });

  // GET attendance for a specific date
  router.get('/date/:date', async (req, res) => {
    try {
      const records = await fetchAttendance({ date: req.params.date });
      res.json(records);
    } catch (err) {
      fail(res, err, 'Failed to fetch attendance for date');
    }
  });

  // GET daily attendance analytics for the last N days.
  router.get('/analytics', async (req, res) => {
    try {
      const requested = Number(req.query.days);
      const days = Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), 90)
        : 14;

      const since = new Date();
      since.setDate(since.getDate() - (days - 1));
      const sinceISO = since.toISOString().slice(0, 10);

      const [attendanceResult, pupilResult] = await Promise.all([
        supabase
          .from('attendance')
          .select('attendance_date, status')
          .gte('attendance_date', sinceISO)
          .order('attendance_date', { ascending: false }),
        supabase.from('pupils').select('id')
      ]);

      if (attendanceResult.error) throw attendanceResult.error;
      if (pupilResult.error) throw pupilResult.error;

      const byDate = {};
      (attendanceResult.data || []).forEach(record => {
        const date = record.attendance_date;
        if (!byDate[date]) {
          byDate[date] = { date, present: 0, absent: 0, late: 0, marked: 0 };
        }
        const entry = byDate[date];
        entry.marked += 1;
        if (record.status === 'Present') entry.present += 1;
        else if (record.status === 'Absent') entry.absent += 1;
        else if (record.status === 'Late') entry.late += 1;
      });

      const history = Object.values(byDate)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))
        .map(entry => ({
          ...entry,
          percent_present: entry.marked
            ? Math.round((entry.present / entry.marked) * 100)
            : 0
        }));

      res.json({
        days: history,
        total_pupils: (pupilResult.data || []).length,
        window_days: days
      });
    } catch (err) {
      fail(res, err, 'Failed to load attendance analytics');
    }
  });

  // MARK attendance for every pupil in a group (upsert)
  router.post('/bulk', async (req, res) => {
    try {
      const { pupil_ids, attendance_date, status } = req.body;

      if (!Array.isArray(pupil_ids) || pupil_ids.length === 0 || !attendance_date || !status) {
        return res.status(400).json({ error: 'pupil_ids, attendance_date, and status are required' });
      }

      const validStatuses = ['Present', 'Absent', 'Late'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Status must be Present, Absent, or Late' });
      }

      const ids = [...new Set(pupil_ids.map(parseId).filter(Boolean))];
      if (ids.length === 0) {
        return res.status(400).json({ error: 'No valid pupil ids were provided' });
      }

      const rows = ids.map(pupilId => ({
        pupil_id: pupilId,
        attendance_date,
        status
      }));

      const { data, error } = await supabase
        .from('attendance')
        .upsert(rows, { onConflict: 'pupil_id,attendance_date' })
        .select('id');

      if (error) throw error;
      res.json({ saved: (data || []).length, attendance_date, status });
    } catch (err) {
      fail(res, err, 'Failed to save attendance');
    }
  });

  // MARK attendance for a pupil on a date (upsert)
  router.post('/', async (req, res) => {
    try {
      const pupilId = parseId(req.body.pupil_id);
      const { attendance_date, status } = req.body;

      if (!pupilId || !attendance_date || !status) {
        return res.status(400).json({ error: 'pupil_id, attendance_date, and status are required' });
      }

      const validStatuses = ['Present', 'Absent', 'Late'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Status must be Present, Absent, or Late' });
      }

      const { data: pupil, error: pupilError } = await supabase
        .from('pupils')
        .select('id')
        .eq('id', pupilId)
        .maybeSingle();
      if (pupilError) throw pupilError;
      if (!pupil) return res.status(404).json({ error: 'Pupil not found' });

      const { data, error } = await supabase
        .from('attendance')
        .upsert(
          { pupil_id: pupilId, attendance_date, status },
          { onConflict: 'pupil_id,attendance_date' }
        )
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      fail(res, err, 'Failed to mark attendance');
    }
  });

  // GET attendance summary by section and class for a date
  router.get('/summary/:date', async (req, res) => {
    try {
      const date = req.params.date;

      const [pupilResult, attendanceResult] = await Promise.all([
        supabase.from('pupils').select('section, class_level'),
        supabase
          .from('attendance')
          .select('status, pupil:pupils!inner(section, class_level)')
          .eq('attendance_date', date)
      ]);

      if (pupilResult.error) throw pupilResult.error;
      if (attendanceResult.error) throw attendanceResult.error;

      const pupils = pupilResult.data || [];
      const records = attendanceResult.data || [];

      const summary = SECTIONS.map(section => {
        const totalPupils = pupils.filter(pupil => pupil.section === section).length;
        const sectionRecords = records.filter(record => record.pupil && record.pupil.section === section);

        return {
          section,
          total_pupils: totalPupils,
          total_marked: sectionRecords.length,
          present: sectionRecords.filter(record => record.status === 'Present').length,
          absent: sectionRecords.filter(record => record.status === 'Absent').length,
          late: sectionRecords.filter(record => record.status === 'Late').length
        };
      });

      const classes = CLASS_ORDER.map(className => {
        const totalPupils = pupils.filter(pupil => classForPupil(pupil) === className).length;
        const classRecords = records.filter(record => record.pupil && classForPupil(record.pupil) === className);

        return {
          class_level: className,
          section: sectionForClass(className),
          total_pupils: totalPupils,
          total_marked: classRecords.length,
          present: classRecords.filter(record => record.status === 'Present').length,
          absent: classRecords.filter(record => record.status === 'Absent').length,
          late: classRecords.filter(record => record.status === 'Late').length
        };
      });

      res.json({ date, summary, classes });
    } catch (err) {
      fail(res, err, 'Failed to fetch attendance summary');
    }
  });

  // DELETE attendance record
  router.delete('/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Attendance record not found' });

      const { data, error } = await supabase
        .from('attendance')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        return res.status(404).json({ error: 'Attendance record not found' });
      }

      res.json({ message: 'Attendance record deleted successfully' });
    } catch (err) {
      fail(res, err, 'Failed to delete attendance record');
    }
  });

  return router;
};
