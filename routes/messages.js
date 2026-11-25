const express = require('express');
const { fail, parseId, isMissingTable } = require('./helpers');

function toHellioPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('233') && digits.length >= 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return '233' + digits.slice(1);
  if (digits.length === 9) return '233' + digits;
  return digits;
}

function isValidLocalPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length === 9 || digits.length === 10 || (digits.startsWith('233') && digits.length >= 12);
}

module.exports = ({ supabase }) => {
  const router = express.Router();

  router.get('/config', (req, res) => {
    res.json({ defaultSender: process.env.HELLIO_DEFAULT_SENDER || null, baseUrl: process.env.HELLIO_BASE_URL || 'https://api.helliomessaging.com/v1' });
  });

  router.get('/history', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('sms_campaigns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) {
        if (isMissingTable(error)) return res.json({ campaigns: [], setupRequired: true });
        throw error;
      }
      res.json({ campaigns: data || [] });
    } catch (err) {
      fail(res, err, 'Failed to load message history');
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'Message not found' });

      const { data: campaign, error: cErr } = await supabase
        .from('sms_campaigns')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (cErr) {
        if (isMissingTable(cErr)) return res.status(503).json({ error: 'Messages are not set up in the database yet. Run supabase/apply-updates.sql.' });
        throw cErr;
      }
      if (!campaign) return res.status(404).json({ error: 'Message not found' });

      const { data: recipients, error: rErr } = await supabase
        .from('sms_recipients')
        .select('*')
        .eq('campaign_id', id)
        .order('id', { ascending: true });
      if (rErr) throw rErr;

      res.json({ campaign, recipients: recipients || [] });
    } catch (err) {
      fail(res, err, 'Failed to load message');
    }
  });

  router.post('/send', async (req, res) => {
    try {
      const message = String(req.body.message || '').trim();
      if (!message) return res.status(400).json({ error: 'Message is required.' });

      const sender = String(req.body.sender || process.env.HELLIO_DEFAULT_SENDER || '').trim() || null;
      if (!sender) return res.status(400).json({ error: 'Sender ID is required. Enter an approved sender ID for your Hellio account.' });

      const rawRecipients = Array.isArray(req.body.recipients) ? req.body.recipients : [];
      const seen = new Set();
      const unique = [];
      for (const r of rawRecipients) {
        const phone = String(r && (r.phone || r.number) || '').trim();
        if (!phone) continue;
        const key = phone.replace(/\D/g, '');
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ phone, name: r.name || null, pupil_id: r.pupil_id || null });
      }

      if (!unique.length) return res.status(400).json({ error: 'No recipients selected.' });

      const valid = [];
      const skipped = [];
      for (const r of unique) {
        if (!isValidLocalPhone(r.phone)) {
          skipped.push(r.phone);
          continue;
        }
        valid.push({ ...r, hellioPhone: toHellioPhone(r.phone) });
      }

      if (!valid.length) {
        return res.status(400).json({ error: 'None of the selected recipients have a valid phone number.', skipped });
      }

      const token = process.env.HELLIO_API_TOKEN || process.env.HELLIO_API_KEY;
      if (!token) {
        return res.status(500).json({ error: 'Hellio API token is not configured on the server. Set HELLIOMESSAGING_API_TOKEN in .env / Vercel env vars.' });
      }

      const baseUrl = (process.env.HELLIO_BASE_URL || 'https://api.helliomessaging.com/v1').replace(/\/+$/, '');

      let providerData = null;
      let ok = false;
      let errorMessage = null;
      try {
        const resp = await fetch(baseUrl + '/sms/send', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            recipients: valid.map(r => r.hellioPhone),
            sender: sender,
            message: message
          })
        });
        const text = await resp.text();
        try { providerData = text ? JSON.parse(text) : {}; } catch (e) { providerData = { raw: text }; }
        ok = resp.ok;
        if (!resp.ok) {
          errorMessage = (providerData && (providerData.message || providerData.error)) || ('Hellio request failed (HTTP ' + resp.status + ').');
        }
      } catch (err) {
        errorMessage = err && err.message ? err.message : 'Network error contacting Hellio.';
        ok = false;
      }

      let campaignId = null;
      try {
        const { data: campaign, error: cErr } = await supabase
          .from('sms_campaigns')
          .insert({
            message: message,
            sender: sender,
            recipient_count: valid.length,
            status: ok ? 'Sent' : 'Failed',
            provider_response: providerData,
            sent_by_id: req.user.id,
            sent_by_name: req.user.full_name || req.user.email,
            sent_by_email: req.user.email
          })
          .select()
          .single();
        if (cErr) {
          if (!isMissingTable(cErr)) throw cErr;
        } else {
          campaignId = campaign.id;
          const rows = valid.map(r => ({
            campaign_id: campaign.id,
            pupil_id: r.pupil_id || null,
            guardian_name: r.name || null,
            phone: r.phone,
            status: ok ? 'Sent' : 'Failed',
            error: ok ? null : errorMessage
          }));
          const { error: rErr } = await supabase.from('sms_recipients').insert(rows);
          if (rErr && !isMissingTable(rErr)) throw rErr;
        }
      } catch (logErr) {
        console.error('SMS logging failed:', logErr && logErr.message);
      }

      if (!ok) {
        return res.status(502).json({
          ok: false,
          error: errorMessage || 'Failed to send SMS.',
          sent: 0,
          failed: valid.length,
          skipped: skipped.length,
          skippedNumbers: skipped,
          provider: providerData
        });
      }

      res.json({
        ok: true,
        message: 'SMS sent to ' + valid.length + ' recipient(s).' + (skipped.length ? ' ' + skipped.length + ' skipped (invalid phone).' : ''),
        campaignId: campaignId,
        sent: valid.length,
        failed: 0,
        skipped: skipped.length,
        skippedNumbers: skipped,
        provider: providerData
      });
    } catch (err) {
      fail(res, err, 'Failed to send SMS');
    }
  });

  return router;
};
