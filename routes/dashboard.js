const express = require('express');
const { SECTIONS } = require('../constants');
const { fail } = require('./helpers');

module.exports = ({ supabase }) => {
  const router = express.Router();

  // Dashboard summary: totals by section, fees billed/collected/outstanding
  router.get('/summary', async (req, res) => {
    try {
      const [pupilResult, invoiceResult] = await Promise.all([
        supabase.from('pupils').select('id, section'),
        supabase.from('fee_invoices').select('amount_billed, amount_paid')
      ]);

      if (pupilResult.error) throw pupilResult.error;
      if (invoiceResult.error) throw invoiceResult.error;

      const pupils = pupilResult.data || [];
      const invoices = invoiceResult.data || [];

      const sectionCounts = {};
      SECTIONS.forEach(section => { sectionCounts[section] = 0; });
      pupils.forEach(pupil => {
        if (sectionCounts[pupil.section] === undefined) sectionCounts[pupil.section] = 0;
        sectionCounts[pupil.section] += 1;
      });

      const totalBilled = invoices.reduce((sum, invoice) => sum + Number(invoice.amount_billed || 0), 0);
      const totalCollected = invoices.reduce((sum, invoice) => sum + Number(invoice.amount_paid || 0), 0);

      res.json({
        totalPupils: pupils.length,
        pupilsPerSection: SECTIONS.map(section => ({ section, count: sectionCounts[section] })),
        totalBilled,
        totalCollected,
        outstandingBalance: totalBilled - totalCollected
      });
    } catch (err) {
      fail(res, err, 'Failed to load dashboard summary');
    }
  });

  return router;
};
