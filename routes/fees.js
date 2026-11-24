const express = require('express');
const { SECTIONS, CLASS_ORDER } = require('../constants');
const { fail, parseId, mapInvoice, compareInvoices } = require('./helpers');

const INVOICE_SELECT = '*, pupil:pupils(full_name, section, class_level)';

module.exports = ({ supabase }) => {
  const router = express.Router();

  // GET all fee invoices with pupil info and balance
  router.get('/', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('fee_invoices')
        .select(INVOICE_SELECT);

      if (error) throw error;

      const invoices = (data || []).map(mapInvoice).sort(compareInvoices);
      res.json(invoices);
    } catch (err) {
      fail(res, err, 'Failed to fetch fee invoices');
    }
  });

  // CREATE a general invoice for a whole group (section or class)
  router.post('/bulk', async (req, res) => {
    try {
      const { target, term, academic_year, amount_billed, description } = req.body;

      const validTargets = ['all', ...SECTIONS, ...CLASS_ORDER];
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

      let pupilQuery = supabase
        .from('pupils')
        .select('id')
        .eq('enrollment_status', 'Active');

      if (target !== 'all') {
        if (SECTIONS.includes(target)) {
          pupilQuery = pupilQuery.eq('section', target);
        } else {
          pupilQuery = pupilQuery.eq('class_level', target);
        }
      }

      const { data: pupils, error: pupilError } = await pupilQuery;
      if (pupilError) throw pupilError;

      if (!pupils || pupils.length === 0) {
        return res.status(201).json({ target, created: 0, skipped: 0, total_billed: 0 });
      }

      const pupilIds = pupils.map(pupil => pupil.id);

      // Avoid double-billing a pupil for the same term.
      const { data: existing, error: existingError } = await supabase
        .from('fee_invoices')
        .select('pupil_id')
        .eq('term', term)
        .eq('academic_year', academic_year)
        .in('pupil_id', pupilIds);
      if (existingError) throw existingError;

      const alreadyInvoiced = new Set((existing || []).map(row => row.pupil_id));
      const rows = pupilIds
        .filter(pupilId => !alreadyInvoiced.has(pupilId))
        .map(pupilId => ({
          pupil_id: pupilId,
          term,
          academic_year,
          description: description || 'General invoice',
          amount_billed: amountBilled,
          amount_paid: 0,
          status: 'Unpaid'
        }));

      let created = 0;
      if (rows.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from('fee_invoices')
          .insert(rows)
          .select('id');
        if (insertError) throw insertError;
        created = (inserted || []).length;
      }

      res.status(201).json({
        target,
        created,
        skipped: pupilIds.length - created,
        total_billed: created * amountBilled
      });
    } catch (err) {
      fail(res, err, 'Failed to create general invoice');
    }
  });

  // GET single invoice by id
  router.get('/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Invoice not found' });

      const { data, error } = await supabase
        .from('fee_invoices')
        .select(INVOICE_SELECT)
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Invoice not found' });

      res.json(mapInvoice(data));
    } catch (err) {
      fail(res, err, 'Failed to fetch invoice');
    }
  });

  // CREATE a new fee invoice for a single pupil
  router.post('/', async (req, res) => {
    try {
      const { pupil_id, term, academic_year, amount_billed, description } = req.body;

      if (!pupil_id || !term || !academic_year || amount_billed === undefined) {
        return res.status(400).json({ error: 'All fields are required' });
      }

      const pupilId = parseId(pupil_id);
      if (!pupilId) return res.status(404).json({ error: 'Pupil not found' });

      const { data: pupil, error: pupilError } = await supabase
        .from('pupils')
        .select('id')
        .eq('id', pupilId)
        .maybeSingle();
      if (pupilError) throw pupilError;
      if (!pupil) return res.status(404).json({ error: 'Pupil not found' });

      const { data, error } = await supabase
        .from('fee_invoices')
        .insert({
          pupil_id: pupilId,
          term,
          academic_year,
          description: description || null,
          amount_billed: parseFloat(amount_billed) || 0,
          amount_paid: 0,
          status: 'Unpaid'
        })
        .select(INVOICE_SELECT)
        .single();

      if (error) throw error;
      res.status(201).json(mapInvoice(data));
    } catch (err) {
      fail(res, err, 'Failed to create fee invoice');
    }
  });

  // RECORD a payment against an invoice
  router.post('/:id/payments', async (req, res) => {
    try {
      const invoiceId = parseId(req.params.id);
      if (!invoiceId) return res.status(404).json({ error: 'Invoice not found' });

      const { amount_paid, note } = req.body;
      const paymentAmount = parseFloat(amount_paid);
      if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
        return res.status(400).json({ error: 'Valid payment amount is required' });
      }

      const { data: invoice, error: invoiceError } = await supabase
        .from('fee_invoices')
        .select('*')
        .eq('id', invoiceId)
        .maybeSingle();
      if (invoiceError) throw invoiceError;
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

      const oldAmountPaid = Number(invoice.amount_paid || 0);
      const newAmountPaid = oldAmountPaid + paymentAmount;

      let status = 'Unpaid';
      if (newAmountPaid >= Number(invoice.amount_billed)) {
        status = 'Paid';
      } else if (newAmountPaid > 0) {
        status = 'Partial';
      }

      const { error: updateError } = await supabase
        .from('fee_invoices')
        .update({ amount_paid: newAmountPaid, status })
        .eq('id', invoiceId);
      if (updateError) throw updateError;

      const { error: paymentError } = await supabase
        .from('payments')
        .insert({ invoice_id: invoiceId, amount_paid: paymentAmount, note: note || null });

      if (paymentError) {
        // Undo the invoice update if the payment row could not be written.
        await supabase
          .from('fee_invoices')
          .update({ amount_paid: oldAmountPaid, status: invoice.status })
          .eq('id', invoiceId);
        throw paymentError;
      }

      const { data: updated, error: fetchError } = await supabase
        .from('fee_invoices')
        .select(INVOICE_SELECT)
        .eq('id', invoiceId)
        .single();
      if (fetchError) throw fetchError;

      res.status(201).json({ invoice: mapInvoice(updated) });
    } catch (err) {
      fail(res, err, 'Failed to record payment');
    }
  });

  // GET payments for an invoice
  router.get('/:id/payments', async (req, res) => {
    try {
      const invoiceId = parseId(req.params.id);
      if (!invoiceId) return res.status(404).json({ error: 'Invoice not found' });

      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });

      if (error) throw error;
      res.json(data || []);
    } catch (err) {
      fail(res, err, 'Failed to fetch payments');
    }
  });

  // DELETE a fee invoice
  router.delete('/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Invoice not found' });

      const { data, error } = await supabase
        .from('fee_invoices')
        .delete()
        .eq('id', id)
        .select('id');

      if (error) throw error;
      if (!data || data.length === 0) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      res.json({ message: 'Fee invoice deleted successfully' });
    } catch (err) {
      fail(res, err, 'Failed to delete fee invoice');
    }
  });

  return router;
};
