import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TOYYIB_BASE = 'https://dev.toyyibpay.com';

app.get('/', (_req, res) => res.json({ ok: true, service: 'ToyyibPay backend' }));

app.post('/api/toyyibpay/create-bill', async (req, res) => {
  try {
    const {
      amount,
      driverId,
      reference,
      returnUrl,
      callbackUrl,
      billTo,
      billEmail,
      billName,
      billDescription
    } = req.body;

    if (!amount || !driverId) {
      return res.status(400).json({ error: 'amount and driverId are required' });
    }

    const billAmount = Math.round(Number(amount) * 100);

    // Forward all required ToyyibPay fields
    const form = new URLSearchParams({
      userSecretKey: process.env.TOYYIBPAY_SECRET,
      categoryCode: process.env.TOYYIBPAY_CATEGORY,
      billTo: billTo || driverId,
      billEmail: billEmail || `${driverId}@urbandrive.com`,
      billPhone: driverId, // optional, Toyyib accepts a string here
      billName: billName || 'UrbanDrive Fee',
      billDescription: billDescription || `Commission for ${driverId}`,
      billPriceSetting: '1',
      billPayorInfo: '1',
      billAmount: String(billAmount),
      billExternalReferenceNo: reference || '',
      billReturnUrl: returnUrl || process.env.APP_RETURN_URL,
      billCallbackUrl: callbackUrl || process.env.APP_CALLBACK_URL
    });

    const r = await fetch(`${TOYYIB_BASE}/index.php/api/createBill`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });

    const data = await r.json();

    if (!Array.isArray(data) || !data[0]?.BillCode) {
      return res.status(400).json({ error: 'Toyyib createBill failed', data });
    }

    const billCode = data[0].BillCode;
    return res.json({ billCode, paymentUrl: `${TOYYIB_BASE}/${billCode}` });
  } catch (e) {
    res.status(500).json({ error: 'server_error', message: e.message });
  }
});

// Webhook: ToyyibPay calls this after payment
app.post('/api/toyyibpay/callback', (req, res) => {
  // status_id === '1' means PAID
  // TODO: verify + update Firebase summaries/commissions
  res.send('OK');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server listening on', process.env.PORT || 3000);
});
