const express = require('express');
const { sectionForClass } = require('../constants');
const { fail, parseId, isMissingTable } = require('./helpers');

const DEFAULT_COMPONENTS = [
  { name: 'Class Score', weight: 30, is_attendance: false },
  { name: 'Projects', weight: 10, is_attendance: false },
  { name: 'Attendance', weight: 10, is_attendance: true },
  { name: 'Exam', weight: 50, is_attendance: false }
];

const DEFAULT_GRADE_SCALE = [
  { grade: 'A', min_score: 80, remark: 'Excellent' },
  { grade: 'B', min_score: 70, remark: 'Very Good' },
  { grade: 'C', min_score: 60, remark: 'Good' },
  { grade: 'D', min_score: 50, remark: 'Credit' },
  { grade: 'E', min_score: 40, remark: 'Pass' },
  { grade: 'F', min_score: 0, remark: 'Fail' }
];

function text(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function termParams(source) {
  return {
    term: text(source.term, 60),
    academicYear: text(source.academic_year, 40)
  };
}

function sortByOrder(a, b) {
  return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
}

function gradeFor(score, scale) {
  const sorted = [...(scale || [])].sort((a, b) => Number(b.min_score) - Number(a.min_score));
  const found = sorted.find(item => Number(score) >= Number(item.min_score));
  if (found) return { grade: found.grade, remark: found.remark || '' };
  const last = sorted[sorted.length - 1];
  return last ? { grade: last.grade, remark: last.remark || '' } : { grade: '-', remark: '' };
}

function setupRequired(res) {
  return res.status(503).json({
    error: 'Scores are not set up in the database yet. Run supabase/apply-updates.sql in Supabase.',
    setupRequired: true
  });
}

module.exports = ({ supabase, requireAdmin }) => {
  const router = express.Router();

  async function getGradeScale() {
    const { data, error } = await supabase
      .from('grade_scales')
      .select('*')
      .order('min_score', { ascending: false });

    if (error) {
      if (isMissingTable(error)) return { scale: DEFAULT_GRADE_SCALE, missing: true };
      throw error;
    }

    if (!data || !data.length) return { scale: DEFAULT_GRADE_SCALE, missing: false };
    return { scale: data, missing: false };
  }

  async function getComponents(term, academicYear) {
    const { data, error } = await supabase
      .from('assessment_components')
      .select('*')
      .eq('term', term)
      .eq('academic_year', academicYear)
      .order('sort_order', { ascending: true });

    if (error) {
      if (isMissingTable(error)) return { components: [], missing: true };
      throw error;
    }

    return { components: (data || []).sort(sortByOrder), missing: false };
  }

  async function getPeriod(term, academicYear) {
    const { data, error } = await supabase
      .from('grading_periods')
      .select('*')
      .eq('term', term)
      .eq('academic_year', academicYear)
      .maybeSingle();

    if (error) {
      if (isMissingTable(error)) return null;
      throw error;
    }
    return data || null;
  }

  async function getAttendanceStats(pupilIds, period) {
    const stats = {};
    if (!pupilIds.length) return stats;

    let query = supabase
      .from('attendance')
      .select('pupil_id, status')
      .in('pupil_id', pupilIds);

    if (period && period.start_date) query = query.gte('attendance_date', period.start_date);
    if (period && period.end_date) query = query.lte('attendance_date', period.end_date);

    const { data, error } = await query;
    if (error) {
      if (isMissingTable(error)) return stats;
      throw error;
    }

    (data || []).forEach(row => {
      const entry = stats[row.pupil_id] || { present: 0, marked: 0 };
      entry.marked += 1;
      if (row.status === 'Present' || row.status === 'Late') entry.present += 1;
      stats[row.pupil_id] = entry;
    });

    return stats;
  }

  async function getClassSubjects(classLevel) {
    const { data, error } = await supabase
      .from('class_subjects')
      .select('subject_id, sort_order, subject:subjects!inner(id, name)')
      .eq('class_level', classLevel)
      .order('sort_order', { ascending: true });

    if (error) {
      if (isMissingTable(error)) return { subjects: [], missing: true };
      throw error;
    }

    return {
      subjects: (data || [])
        .filter(row => row.subject)
        .map(row => ({ id: row.subject.id, name: row.subject.name })),
      missing: false
    };
  }

  // -------------------------------------------------------------------------
  // Setup: components, grading scale, term dates, subjects
  // -------------------------------------------------------------------------

  // GET /api/scores/setup?term=&academic_year=
  router.get('/setup', async (req, res) => {
    try {
      const { term, academicYear } = termParams(req.query);
      if (!term || !academicYear) {
        return res.status(400).json({ error: 'Term and academic year are required.' });
      }

      const { components, missing } = await getComponents(term, academicYear);
      if (missing) return setupRequired(res);

      const { scale, missing: gradesMissing } = await getGradeScale();
      const period = await getPeriod(term, academicYear);

      res.json({
        term,
        academic_year: academicYear,
        components,
        has_components: components.length > 0,
        default_components: DEFAULT_COMPONENTS,
        grade_scale: scale,
        grade_scale_ready: !gradesMissing,
        period
      });
    } catch (err) {
      fail(res, err, 'Failed to load score setup');
    }
  });

  // PUT /api/scores/setup/components (admin)
  router.put('/setup/components', requireAdmin, async (req, res) => {
    try {
      const { term, academicYear } = termParams(req.body);
      if (!term || !academicYear) {
        return res.status(400).json({ error: 'Term and academic year are required.' });
      }

      const incoming = Array.isArray(req.body.components) ? req.body.components : [];
      if (!incoming.length) {
        return res.status(400).json({ error: 'Add at least one assessment component.' });
      }

      const clean = [];
      const seenNames = new Set();
      let attendanceCount = 0;

      for (const item of incoming) {
        const name = text(item.name, 60);
        const weight = number(item.weight);
        if (!name) return res.status(400).json({ error: 'Every component needs a name.' });
        if (weight === null || weight <= 0 || weight > 100) {
          return res.status(400).json({ error: `Enter a weight between 0 and 100 for "${name}".` });
        }
        const key = name.toLowerCase();
        if (seenNames.has(key)) {
          return res.status(400).json({ error: `"${name}" appears twice.` });
        }
        seenNames.add(key);

        const isAttendance = Boolean(item.is_attendance);
        if (isAttendance) attendanceCount += 1;

        clean.push({
          id: parseId(item.id),
          name,
          weight: round2(weight),
          is_attendance: isAttendance
        });
      }

      if (attendanceCount > 1) {
        return res.status(400).json({ error: 'Only one component can be linked to attendance.' });
      }

      const total = round2(clean.reduce((sum, item) => sum + item.weight, 0));
      if (Math.abs(total - 100) > 0.01) {
        return res.status(400).json({ error: `Component weights must add up to 100%. They currently add up to ${total}%.` });
      }

      const { data: existing, error: existingError } = await supabase
        .from('assessment_components')
        .select('id')
        .eq('term', term)
        .eq('academic_year', academicYear);

      if (existingError) {
        if (isMissingTable(existingError)) return setupRequired(res);
        throw existingError;
      }

      const existingIds = new Set((existing || []).map(row => Number(row.id)));
      const keptIds = new Set(clean.filter(item => item.id && existingIds.has(item.id)).map(item => Number(item.id)));
      const removedIds = [...existingIds].filter(id => !keptIds.has(id));

      if (removedIds.length) {
        const { error: removeError } = await supabase
          .from('assessment_components')
          .delete()
          .in('id', removedIds);
        if (removeError) throw removeError;
      }

      for (let index = 0; index < clean.length; index += 1) {
        const item = clean[index];
        const payload = {
          term,
          academic_year: academicYear,
          name: item.name,
          weight: item.weight,
          is_attendance: item.is_attendance,
          sort_order: index
        };

        if (item.id && keptIds.has(item.id)) {
          const { error } = await supabase
            .from('assessment_components')
            .update(payload)
            .eq('id', item.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('assessment_components')
            .insert(payload);
          if (error) throw error;
        }
      }

      const { components } = await getComponents(term, academicYear);
      res.json({ components, saved: true });
    } catch (err) {
      fail(res, err, 'Failed to save assessment components');
    }
  });

  // PUT /api/scores/setup/period (admin) — optional term start/end dates
  router.put('/setup/period', requireAdmin, async (req, res) => {
    try {
      const { term, academicYear } = termParams(req.body);
      if (!term || !academicYear) {
        return res.status(400).json({ error: 'Term and academic year are required.' });
      }

      const startDate = text(req.body.start_date, 10) || null;
      const endDate = text(req.body.end_date, 10) || null;
      if (startDate && endDate && startDate > endDate) {
        return res.status(400).json({ error: 'The term start date must be before the end date.' });
      }

      const { data, error } = await supabase
        .from('grading_periods')
        .upsert({
          term,
          academic_year: academicYear,
          start_date: startDate,
          end_date: endDate
        }, { onConflict: 'term,academic_year' })
        .select()
        .single();

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }

      res.json({ period: data });
    } catch (err) {
      fail(res, err, 'Failed to save term dates');
    }
  });

  // GET /api/scores/setup/grades
  router.get('/setup/grades', async (req, res) => {
    try {
      const { scale, missing } = await getGradeScale();
      res.json({ grade_scale: scale, grade_scale_ready: !missing });
    } catch (err) {
      fail(res, err, 'Failed to load the grading scale');
    }
  });

  // PUT /api/scores/setup/grades (admin)
  router.put('/setup/grades', requireAdmin, async (req, res) => {
    try {
      const incoming = Array.isArray(req.body.grades) ? req.body.grades : [];
      if (!incoming.length) {
        return res.status(400).json({ error: 'Add at least one grade.' });
      }

      const clean = [];
      const seen = new Set();
      for (const item of incoming) {
        const grade = text(item.grade, 4).toUpperCase();
        const minScore = number(item.min_score);
        if (!grade) return res.status(400).json({ error: 'Every grade needs a label.' });
        if (seen.has(grade)) return res.status(400).json({ error: `Grade "${grade}" appears twice.` });
        if (minScore === null || minScore < 0 || minScore > 100) {
          return res.status(400).json({ error: `Enter a minimum score between 0 and 100 for grade ${grade}.` });
        }
        seen.add(grade);
        clean.push({ grade, min_score: round2(minScore), remark: text(item.remark, 60) });
      }

      clean.sort((a, b) => b.min_score - a.min_score);
      for (let index = 1; index < clean.length; index += 1) {
        if (clean[index].min_score >= clean[index - 1].min_score) {
          return res.status(400).json({ error: 'Each grade needs a lower minimum score than the grade above it.' });
        }
      }

      const { error: deleteError } = await supabase
        .from('grade_scales')
        .delete()
        .gt('id', 0);

      if (deleteError) {
        if (isMissingTable(deleteError)) return setupRequired(res);
        throw deleteError;
      }

      const rows = clean.map((item, index) => ({
        grade: item.grade,
        min_score: item.min_score,
        remark: item.remark,
        sort_order: index + 1
      }));

      const { error: insertError } = await supabase.from('grade_scales').insert(rows);
      if (insertError) throw insertError;

      res.json({ grade_scale: rows, saved: true });
    } catch (err) {
      fail(res, err, 'Failed to save the grading scale');
    }
  });

  // GET /api/scores/subjects — all subjects, or those assigned to a class
  router.get('/subjects', async (req, res) => {
    try {
      const classLevel = text(req.query.class_level, 40);

      if (classLevel) {
        const { subjects, missing } = await getClassSubjects(classLevel);
        if (missing) return setupRequired(res);
        return res.json({ subjects });
      }

      const { data, error } = await supabase
        .from('subjects')
        .select('*')
        .order('name', { ascending: true });

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }

      res.json({ subjects: data || [] });
    } catch (err) {
      fail(res, err, 'Failed to load subjects');
    }
  });

  // POST /api/scores/subjects (admin) — add a subject to the master list
  router.post('/subjects', requireAdmin, async (req, res) => {
    try {
      const name = text(req.body.name, 60);
      if (!name) return res.status(400).json({ error: 'Enter a subject name.' });

      const { data: existing, error: existingError } = await supabase
        .from('subjects')
        .select('id, name');

      if (existingError) {
        if (isMissingTable(existingError)) return setupRequired(res);
        throw existingError;
      }

      if ((existing || []).some(row => String(row.name).toLowerCase() === name.toLowerCase())) {
        return res.status(409).json({ error: `"${name}" already exists.` });
      }

      const { data, error } = await supabase
        .from('subjects')
        .insert({ name })
        .select()
        .single();

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }

      res.status(201).json({ subject: data });
    } catch (err) {
      fail(res, err, 'Failed to add the subject');
    }
  });

  // DELETE /api/scores/subjects/:id (admin)
  router.delete('/subjects/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid subject id.' });

      const { error } = await supabase.from('subjects').delete().eq('id', id);
      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }

      res.json({ removed: true });
    } catch (err) {
      fail(res, err, 'Failed to remove the subject');
    }
  });

  // PUT /api/scores/subjects/class (admin) — set the subjects a class studies
  router.put('/subjects/class', requireAdmin, async (req, res) => {
    try {
      const classLevel = text(req.body.class_level, 40);
      if (!classLevel) return res.status(400).json({ error: 'Choose a class.' });

      const ids = Array.isArray(req.body.subject_ids)
        ? [...new Set(req.body.subject_ids.map(parseId).filter(Boolean))]
        : [];

      const { error: deleteError } = await supabase
        .from('class_subjects')
        .delete()
        .eq('class_level', classLevel);

      if (deleteError) {
        if (isMissingTable(deleteError)) return setupRequired(res);
        throw deleteError;
      }

      if (ids.length) {
        const rows = ids.map((subjectId, index) => ({
          class_level: classLevel,
          subject_id: subjectId,
          sort_order: index
        }));
        const { error: insertError } = await supabase.from('class_subjects').insert(rows);
        if (insertError) throw insertError;
      }

      const { subjects } = await getClassSubjects(classLevel);
      res.json({ subjects });
    } catch (err) {
      fail(res, err, 'Failed to save the class subjects');
    }
  });

  // -------------------------------------------------------------------------
  // Score entry
  // -------------------------------------------------------------------------

  // GET /api/scores/sheet?term=&academic_year=&class_level=&subject_id=
  router.get('/sheet', async (req, res) => {
    try {
      const { term, academicYear } = termParams(req.query);
      const classLevel = text(req.query.class_level, 40);
      const subjectId = parseId(req.query.subject_id) || parseId(req.query.subject);

      if (!term || !academicYear) {
        return res.status(400).json({ error: 'Term and academic year are required.' });
      }
      if (!classLevel) return res.status(400).json({ error: 'Choose a class.' });
      if (!subjectId) return res.status(400).json({ error: 'Choose a subject.' });

      const { components, missing } = await getComponents(term, academicYear);
      if (missing) return setupRequired(res);
      if (!components.length) {
        return res.status(409).json({
          error: 'No assessment components are set up for this term yet. An administrator can add them under Scores → Setup.',
          setupRequired: true
        });
      }

      const { data: subject, error: subjectError } = await supabase
        .from('subjects')
        .select('id, name')
        .eq('id', subjectId)
        .maybeSingle();

      if (subjectError) {
        if (isMissingTable(subjectError)) return setupRequired(res);
        throw subjectError;
      }
      if (!subject) return res.status(404).json({ error: 'Subject not found.' });

      const { data: pupilData, error: pupilError } = await supabase
        .from('pupils')
        .select('id, full_name, class_level, section, enrollment_status')
        .eq('class_level', classLevel)
        .order('full_name', { ascending: true });

      if (pupilError) throw pupilError;

      const pupils = pupilData || [];
      const pupilIds = pupils.map(pupil => pupil.id);

      const { scale } = await getGradeScale();
      const period = await getPeriod(term, academicYear);
      const attendance = await getAttendanceStats(pupilIds, period);

      let savedScores = [];
      if (pupilIds.length) {
        const { data, error } = await supabase
          .from('scores')
          .select('*')
          .eq('term', term)
          .eq('academic_year', academicYear)
          .eq('subject_id', subjectId)
          .in('pupil_id', pupilIds);

        if (error) {
          if (isMissingTable(error)) return setupRequired(res);
          throw error;
        }
        savedScores = data || [];
      }

      const scoreMap = new Map();
      savedScores.forEach(row => {
        scoreMap.set(`${row.pupil_id}:${row.component_id}`, Number(row.score));
      });

      const rows = pupils.map(pupil => {
        const values = {};
        let total = 0;

        components.forEach(component => {
          const key = `${pupil.id}:${component.id}`;
          let value = scoreMap.has(key) ? scoreMap.get(key) : null;

          if (value === null && component.is_attendance) {
            const stats = attendance[pupil.id];
            if (stats && stats.marked) {
              value = round1((stats.present / stats.marked) * Number(component.weight));
            }
          }

          values[component.id] = value;
          if (value !== null) total += value;
        });

        const grade = gradeFor(total, scale);
        return {
          pupil_id: pupil.id,
          full_name: pupil.full_name,
          class_level: pupil.class_level,
          section: pupil.section,
          enrollment_status: pupil.enrollment_status,
          scores: values,
          total: round1(total),
          grade: grade.grade,
          remark: grade.remark,
          attendance: attendance[pupil.id] || { present: 0, marked: 0 }
        };
      });

      res.json({
        term,
        academic_year: academicYear,
        class_level: classLevel,
        subject: { id: subject.id, name: subject.name },
        components,
        grade_scale: scale,
        period,
        pupils: rows
      });
    } catch (err) {
      fail(res, err, 'Failed to load the score sheet');
    }
  });

  // POST /api/scores/sheet — save many component scores at once
  router.post('/sheet', async (req, res) => {
    try {
      const { term, academicYear } = termParams(req.body);
      const classLevel = text(req.body.class_level, 40);
      const subjectId = parseId(req.body.subject_id) || parseId(req.body.subject);
      const entries = Array.isArray(req.body.scores) ? req.body.scores : [];

      if (!term || !academicYear) {
        return res.status(400).json({ error: 'Term and academic year are required.' });
      }
      if (!classLevel) return res.status(400).json({ error: 'Choose a class.' });
      if (!subjectId) return res.status(400).json({ error: 'Choose a subject.' });

      const { components, missing } = await getComponents(term, academicYear);
      if (missing) return setupRequired(res);
      if (!components.length) {
        return res.status(409).json({
          error: 'No assessment components are set up for this term yet.',
          setupRequired: true
        });
      }

      const componentMap = new Map(components.map(component => [Number(component.id), component]));
      const enteredBy = req.user ? (req.user.full_name || req.user.email || '') : '';
      const rows = [];
      const seen = new Set();

      for (const entry of entries) {
        const pupilId = parseId(entry.pupil_id);
        const componentId = parseId(entry.component_id);
        const value = number(entry.score);

        if (!pupilId || !componentId || value === null) continue;
        if (value < 0) {
          return res.status(400).json({ error: 'Scores cannot be negative.' });
        }

        const component = componentMap.get(componentId);
        if (!component) {
          return res.status(400).json({ error: 'One of the components is no longer set up for this term.' });
        }
        if (value > Number(component.weight)) {
          return res.status(400).json({
            error: `"${component.name}" is out of ${component.weight}. A score of ${value} is too high.`
          });
        }

        const key = `${pupilId}:${componentId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        rows.push({
          pupil_id: pupilId,
          subject_id: subjectId,
          component_id: componentId,
          term,
          academic_year: academicYear,
          score: round2(value),
          entered_by: enteredBy,
          updated_at: new Date().toISOString()
        });
      }

      if (!rows.length) {
        return res.json({ saved: 0 });
      }

      const { error } = await supabase
        .from('scores')
        .upsert(rows, {
          onConflict: 'pupil_id,subject_id,component_id,term,academic_year'
        });

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }

      res.json({ saved: rows.length });
    } catch (err) {
      fail(res, err, 'Failed to save the scores');
    }
  });

  // -------------------------------------------------------------------------
  // Report cards
  // -------------------------------------------------------------------------

  // POST /api/scores/reports/generate
  router.post('/reports/generate', async (req, res) => {
    try {
      const { term, academicYear } = termParams(req.body);
      const classLevel = text(req.body.class_level, 40);
      const requestedIds = Array.isArray(req.body.pupil_ids)
        ? req.body.pupil_ids.map(parseId).filter(Boolean)
        : [];

      if (!term || !academicYear) {
        return res.status(400).json({ error: 'Term and academic year are required.' });
      }
      if (!classLevel) return res.status(400).json({ error: 'Choose a class.' });

      const { components, missing } = await getComponents(term, academicYear);
      if (missing) return setupRequired(res);
      if (!components.length) {
        return res.status(409).json({ error: 'Set up the assessment components for this term first.' });
      }

      const { subjects, missing: subjectsMissing } = await getClassSubjects(classLevel);
      if (subjectsMissing) return setupRequired(res);
      if (!subjects.length) {
        return res.status(409).json({ error: 'No subjects are assigned to this class yet. Set them up under Scores → Setup.' });
      }

      let pupilQuery = supabase
        .from('pupils')
        .select('id, full_name, class_level, section')
        .eq('class_level', classLevel);

      if (requestedIds.length) {
        pupilQuery = pupilQuery.in('id', requestedIds);
      }

      const { data: pupilData, error: pupilError } = await pupilQuery;
      if (pupilError) throw pupilError;

      const pupils = pupilData || [];
      if (!pupils.length) {
        return res.status(404).json({ error: 'No pupils were found in that class.' });
      }

      const pupilIds = pupils.map(pupil => pupil.id);
      const subjectIds = subjects.map(subject => subject.id);

      const { data: scoreData, error: scoreError } = await supabase
        .from('scores')
        .select('*')
        .eq('term', term)
        .eq('academic_year', academicYear)
        .in('pupil_id', pupilIds)
        .in('subject_id', subjectIds);

      if (scoreError) {
        if (isMissingTable(scoreError)) return setupRequired(res);
        throw scoreError;
      }

      const { scale } = await getGradeScale();
      const period = await getPeriod(term, academicYear);
      const attendance = await getAttendanceStats(pupilIds, period);

      const scoreMap = new Map();
      (scoreData || []).forEach(row => {
        scoreMap.set(`${row.pupil_id}:${row.subject_id}:${row.component_id}`, Number(row.score));
      });

      const issuedBy = req.user ? (req.user.full_name || req.user.email || '') : '';
      const generatedAt = new Date().toISOString();
      const rows = pupils.map(pupil => {
        const subjectRows = subjects.map(subject => {
          let total = 0;
          const componentRows = components.map(component => {
            const value = scoreMap.get(`${pupil.id}:${subject.id}:${component.id}`);
            const score = value === undefined ? 0 : value;
            total += score;
            return {
              component_id: component.id,
              name: component.name,
              weight: Number(component.weight),
              score: round1(score)
            };
          });

          const grade = gradeFor(total, scale);
          return {
            subject_id: subject.id,
            subject_name: subject.name,
            components: componentRows,
            total: round1(total),
            grade: grade.grade,
            remark: grade.remark
          };
        });

        const totalScore = round1(subjectRows.reduce((sum, row) => sum + row.total, 0));
        const average = subjectRows.length ? round1(totalScore / subjectRows.length) : 0;
        const overall = gradeFor(average, scale);
        const stats = attendance[pupil.id] || { present: 0, marked: 0 };
        const percent = stats.marked ? round1((stats.present / stats.marked) * 100) : 0;

        return {
          pupil_id: pupil.id,
          pupil_name: pupil.full_name,
          pupil_class: pupil.class_level || pupil.section || '',
          section: pupil.section || sectionForClass(pupil.class_level),
          term,
          academic_year: academicYear,
          subject_count: subjectRows.length,
          total_score: totalScore,
          average_score: average,
          overall_grade: overall.grade,
          attendance_present: stats.present,
          attendance_marked: stats.marked,
          attendance_percent: percent,
          snapshot: {
            school: 'Agape Kiddie City Academy',
            pupil: {
              id: pupil.id,
              name: pupil.full_name,
              class_level: pupil.class_level || pupil.section || '',
              section: pupil.section || sectionForClass(pupil.class_level)
            },
            term,
            academic_year: academicYear,
            components: components.map(component => ({
              component_id: component.id,
              name: component.name,
              weight: Number(component.weight),
              is_attendance: Boolean(component.is_attendance)
            })),
            subjects: subjectRows,
            totals: {
              total: totalScore,
              average,
              grade: overall.grade,
              remark: overall.remark,
              subject_count: subjectRows.length
            },
            attendance: {
              present: stats.present,
              marked: stats.marked,
              percent
            },
            grading_scale: scale,
            generated_at: generatedAt,
            issued_by: issuedBy
          },
          issued_by: issuedBy,
          generated_at: generatedAt
        };
      });

      const { data, error } = await supabase
        .from('report_cards')
        .upsert(rows, { onConflict: 'pupil_id,term,academic_year' })
        .select('id, report_number, pupil_id, pupil_name, pupil_class, section, term, academic_year, total_score, average_score, overall_grade, generated_at');

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }

      res.json({ generated: rows.length, reports: data || [] });
    } catch (err) {
      fail(res, err, 'Failed to generate report cards');
    }
  });

  // GET /api/scores/reports?term=&academic_year=&class_level=
  router.get('/reports', async (req, res) => {
    try {
      const { term, academicYear } = termParams(req.query);
      const classLevel = text(req.query.class_level, 40);

      let query = supabase
        .from('report_cards')
        .select('id, report_number, pupil_id, pupil_name, pupil_class, section, term, academic_year, subject_count, total_score, average_score, overall_grade, attendance_percent, generated_at')
        .order('pupil_class', { ascending: true })
        .order('pupil_name', { ascending: true });

      if (term) query = query.eq('term', term);
      if (academicYear) query = query.eq('academic_year', academicYear);
      if (classLevel) query = query.eq('pupil_class', classLevel);

      const { data, error } = await query;
      if (error) {
        if (isMissingTable(error)) return res.json({ reports: [], setupRequired: true });
        throw error;
      }

      res.json({ reports: data || [] });
    } catch (err) {
      fail(res, err, 'Failed to fetch report cards');
    }
  });

  // GET /api/scores/reports/:id
  router.get('/reports/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid report id.' });

      const { data, error } = await supabase
        .from('report_cards')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }
      if (!data) return res.status(404).json({ error: 'Report card not found.' });

      res.json({ report: data });
    } catch (err) {
      fail(res, err, 'Failed to fetch the report card');
    }
  });

  // DELETE /api/scores/reports/:id (admin)
  router.delete('/reports/:id', requireAdmin, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(400).json({ error: 'Invalid report id.' });

      const { error } = await supabase.from('report_cards').delete().eq('id', id);
      if (error) {
        if (isMissingTable(error)) return setupRequired(res);
        throw error;
      }

      res.json({ removed: true });
    } catch (err) {
      fail(res, err, 'Failed to delete the report card');
    }
  });

  return router;
};
