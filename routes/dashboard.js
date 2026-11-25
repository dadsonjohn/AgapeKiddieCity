const express = require('express');
const { SECTIONS, CLASS_ORDER, sectionForClass } = require('../constants');
const { fail } = require('./helpers');

module.exports = ({ supabase }) => {
  const router = express.Router();

  // Dashboard summary: totals by section and class, plus fees billed/collected/
  // outstanding. Fee figures are only returned to administrators.
  router.get('/summary', async (req, res) => {
    try {
      const isAdmin = req.user && req.user.role === 'admin';

      const pupilResult = await supabase.from('pupils').select('id, section, class_level');
      if (pupilResult.error) throw pupilResult.error;

      const pupils = pupilResult.data || [];

      const sectionCounts = {};
      SECTIONS.forEach(section => { sectionCounts[section] = 0; });
      pupils.forEach(pupil => {
        if (sectionCounts[pupil.section] === undefined) sectionCounts[pupil.section] = 0;
        sectionCounts[pupil.section] += 1;
      });

      const classCounts = {};
      pupils.forEach(pupil => {
        const className = pupil.class_level || pupil.section;
        classCounts[className] = (classCounts[className] || 0) + 1;
      });

      const pupilsPerClass = CLASS_ORDER.map(className => ({
        class_level: className,
        section: sectionForClass(className),
        count: classCounts[className] || 0
      }));

      let totalBilled = null;
      let totalCollected = null;
      let outstandingBalance = null;

      if (isAdmin) {
        const invoiceResult = await supabase
          .from('fee_invoices')
          .select('amount_billed, amount_paid');
        if (invoiceResult.error) throw invoiceResult.error;

        const invoices = invoiceResult.data || [];
        totalBilled = invoices.reduce((sum, invoice) => sum + Number(invoice.amount_billed || 0), 0);
        totalCollected = invoices.reduce((sum, invoice) => sum + Number(invoice.amount_paid || 0), 0);
        outstandingBalance = totalBilled - totalCollected;
      }

      res.json({
        totalPupils: pupils.length,
        pupilsPerSection: SECTIONS.map(section => ({ section, count: sectionCounts[section] })),
        pupilsPerClass,
        totalBilled,
        totalCollected,
        outstandingBalance
      });
    } catch (err) {
      fail(res, err, 'Failed to load dashboard summary');
    }
  });

  return router;
};
