const express = require('express');

module.exports = ({ run, get, all }) => {
  const router = express.Router();

  // Dashboard summary: totals by section, fees billed/collected/outstanding
  router.get('/summary', (req, res) => {
    try {
      // Pupils by section
      const pupilsBySection = all(`
        SELECT section, COUNT(*) as count
        FROM pupils
        GROUP BY section
      `);

      // Ensure all sections appear even if no pupils
      const sections = ['Crèche', 'Kindergarten', 'Primary'];
      const sectionCounts = {};
      sections.forEach(s => sectionCounts[s] = 0);
      pupilsBySection.forEach(r => { sectionCounts[r.section] = r.count; });

      const totalPupilsRow = get('SELECT COUNT(*) as count FROM pupils');
      const totalPupils = totalPupilsRow ? totalPupilsRow.count : 0;

      // Fees summary (get() returns a single object, not an array)
      const feeSummary = get(`
        SELECT
          COALESCE(SUM(amount_billed), 0) as total_billed,
          COALESCE(SUM(amount_paid), 0) as total_collected
        FROM fee_invoices
      `);

      const totalBilled = feeSummary ? feeSummary.total_billed : 0;
      const totalCollected = feeSummary ? feeSummary.total_collected : 0;
      const outstandingBalance = totalBilled - totalCollected;

      // Pupil count per section detail
      const pupilsPerSection = sections.map(s => ({
        section: s,
        count: sectionCounts[s]
      }));

      res.json({
        totalPupils,
        pupilsPerSection,
        totalBilled,
        totalCollected,
        outstandingBalance
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to load dashboard summary' });
    }
  });

  return router;
};
