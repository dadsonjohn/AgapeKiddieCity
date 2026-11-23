const express = require('express');

const CLASS_LEVELS = [
  'Crèche',
  'Kindergarten 1',
  'Kindergarten 2',
  'Primary 1',
  'Primary 2',
  'Primary 3',
  'Primary 4',
  'Primary 5',
  'Primary 6'
];

const INVOICE_SELECT = `
  SELECT fi.*,
         p.full_name AS pupil_name,
         p.section AS pupil_section,
         p.class_level AS pupil_class,
         (fi.amount_billed - fi.amount_paid) AS balance_due
  FROM fee_invoices fi
  JOIN pupils p ON fi.pupil_id = p.id
`;

module.exports = ({ run, get, all }) => {
  const router = express.Router();

  // GET all fee invoices with pupil info and balance
  router.get('/', (req, res) => {
    try {
      const invoices = all(`
        ${INVOICE_SELECT}
        ORDER BY
          CASE p.section WHEN 'Crèche' THEN 1 WHEN 'Kindergarten' THEN 2 ELSE 3 END,
          p.class_level ASC,
          p.full_name ASC
      `);
      res.json(invoices);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch fee invoices' });
    }
  });

  // CREATE a general invoice for a whole group (section or class)
  router.post('/bulk', (req, res) => {
    try {
      const { target, term, academic_year, amount_billed, description } = req.body;

      const validTargets = ['all', 'Crèche', 'Kindergarten', 'Primary', ...CLASS_LEVELS];
      if (!target || !validTargets.includes(target)) {
        return res.status(400).json({ error: 'A valid group is required' });
      }
      if (!term || !academic_year || amount_billed === undefined || amount_billed === '') {
        return res.status(400).json({ error: 'Term, academic year, and amount are required' });
      }

      const amountBilled = parseFloat(amount_billed);
      if (!Number.isFinite(amountBilled) || amountBilled < 0) {
        return res.status(400).json({ error: 'Amount must be a valid number' });
      }

      let sql = "SELECT * FROM pupils WHERE enrollment_status = 'Active'";
      const params = [];

      if (target !== 'all') {
        if (['Crèche', 'Kindergarten', 'Primary'].includes(target)) {
          sql += ' AND section = ?';
          params.push(target);
        } else {
          sql += ' AND class_level = ?';
          params.push(target);
        }
      }
      sql += ' ORDER BY full_name ASC';

      const pupils = all(sql, params);

      let created = 0;
      let skipped = 0;

      pupils.forEach(pupil => {
        const existing = get(
          'SELECT id FROM fee_invoices WHERE pupil_id = ? AND term = ? AND academic_year = ?',
          [pupil.id, term, academic_year]
        );

        // Avoid double-billing a pupil for the same term.
        if (existing) {
          skipped += 1;
          return;
        }

        run(`
          INSERT INTO fee_invoices (pupil_id, term, academic_year, description, amount_billed, amount_paid, status)
          VALUES (?, ?, ?, ?, ?, 0, 'Unpaid')
        `, [pupil.id, term, academic_year, description || 'General invoice', amountBilled]);
        created += 1;
      });

      res.status(201).json({
        target,
        created,
        skipped,
        total_billed: created * amountBilled
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create general invoice' });
    }
  });

  // GET single invoice by id
  router.get('/:id', (req, res) => {
    try {
      const invoice = get(`${INVOICE_SELECT} WHERE fi.id = ?`, [req.params.id]);

      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }
      res.json(invoice);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch invoice' });
    }
  });

  // CREATE a new fee invoice for a single pupil
  router.post('/', (req, res) => {
    try {
      const { pupil_id, term, academic_year, amount_billed, description } = req.body;

      if (!pupil_id || !term || !academic_year || amount_billed === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      const pupil = get('SELECT id FROM pupils WHERE id = ?', [pupil_id]);
      if (!pupil) {
        return res.status(404).json({ error: 'Pupil not found' });
      }

      const amountBilled = parseFloat(amount_billed) || 0;

      const info = run(`
        INSERT INTO fee_invoices (pupil_id, term, academic_year, description, amount_billed, amount_paid, status)
        VALUES (?, ?, ?, ?, ?, 0, 'Unpaid')
      `, [pupil_id, term, academic_year, description || null, amountBilled]);

      const newInvoice = get(`${INVOICE_SELECT} WHERE fi.id = ?`, [info.lastInsertRowid]);
      res.status(201).json(newInvoice);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create fee invoice' });
    }
  });

  // RECORD a payment against an invoice
  router.post('/:id/payments', (req, res) => {
    try {
      const { amount_paid, note } = req.body;
      const invoiceId = req.params.id;

      if (!amount_paid || parseFloat(amount_paid) <= 0) {
        return res.status(400).json({ error: 'Valid payment amount is required' });
      }

      const invoice = get('SELECT * FROM fee_invoices WHERE id = ?', [invoiceId]);
      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const paymentAmount = parseFloat(amount_paid);
      const newAmountPaid = invoice.amount_paid + paymentAmount;

      let status = invoice.status;
      if (newAmountPaid >= invoice.amount_billed) {
        status = 'Paid';
      } else if (newAmountPaid > 0) {
        status = 'Partial';
      } else {
        status = 'Unpaid';
      }

      run(`
        UPDATE fee_invoices
        SET amount_paid = ?, status = ?
        WHERE id = ?
      `, [newAmountPaid, status, invoiceId]);

      run(`
        INSERT INTO payments (invoice_id, amount_paid, note)
        VALUES (?, ?, ?)
      `, [invoiceId, paymentAmount, note || null]);

      const updatedInvoice = get(`${INVOICE_SELECT} WHERE fi.id = ?`, [invoiceId]);
      res.status(201).json({ invoice: updatedInvoice });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to record payment' });
    }
  });

  // GET payments for an invoice
  router.get('/:id/payments', (req, res) => {
    try {
      const payments = all(`
        SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC
      `, [req.params.id]);
      res.json(payments);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  // DELETE a fee invoice
  router.delete('/:id', (req, res) => {
    try {
      const existing = get('SELECT id FROM fee_invoices WHERE id = ?', [req.params.id]);
      if (!existing) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      run('DELETE FROM fee_invoices WHERE id = ?', [req.params.id]);
      res.json({ message: 'Fee invoice deleted successfully' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to delete fee invoice' });
    }
  });

  return router;
};
