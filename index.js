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
    const { amount, driverId, reference } = req.body;
    if (!amount || !driverId) return res.status(400).json({ error: 'amount and driverId are required' });

    const billAmount = Math.round(Number(amount) * 100);
    const form = new URLSearchParams({
      userSecretKey: process.env.TOYYIBPAY_SECRET,
      categoryCode: process.env.TOYYIBPAY_CATEGORY,
      billName: 'UrbanDrive Commission',
      billDescription: `Commission for ${driverId}`,
      billPriceSetting: '1',
      billPayorInfo: '1',
      billAmount: String(billAmount),
      billExternalReferenceNo: reference || '',
      billReturnUrl: process.env.APP_RETURN_URL,
      billCallbackUrl: process.env.APP_CALLBACK_URL
    });

    const r = await fetch(`${TOYYIB_BASE}/index.php/api/createBill`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form
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

// Optional: webhook stub (you’ll update Firebase here)
app.post('/api/toyyibpay/callback', (req, res) => {
  // status_id === '1' means PAID
  // TODO: verify + update Firebase summaries/commissions
  res.send('OK');
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server listening on', process.env.PORT || 3000);
});