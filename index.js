// Complete backend fix for Render.com deployment
// Replace your existing backend code with this

import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// ToyyibPay configuration
const TOYYIBPAY_USER_SECRET_KEY = process.env.TOYYIBPAY_USER_SECRET_KEY;
const TOYYIBPAY_CATEGORY_CODE = process.env.TOYYIBPAY_CATEGORY_CODE;
const TOYYIBPAY_API_URL = 'https://dev.toyyibpay.com/index.php/api/createBill';

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'ToyyibPay backend' });
});

// Manual commission update endpoint for testing
app.post('/api/commission/update', async (req, res) => {
    try {
        const { driverId, amount, billCode, reference } = req.body;
        
        console.log('Manual commission update:', {
            driverId,
            amount,
            billCode,
            reference
        });
        
        // TODO: Implement Firebase update
        // 1. Reduce unpaid_commission by amount
        // 2. Add payment record to commission_payments
        
        res.json({
            success: true,
            message: 'Commission updated successfully',
            data: {
                driverId,
                amount,
                billCode,
                reference
            }
        });
    } catch (error) {
        console.error('Commission update error:', error);
        res.status(500).json({ error: 'Commission update failed' });
    }
});

// Create bill endpoint - FIXED VERSION
app.post('/api/toyyibpay/create-bill', async (req, res) => {
    try {
        console.log('Received request:', JSON.stringify(req.body, null, 2));
        console.log('Request headers:', JSON.stringify(req.headers, null, 2));
        
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
        
        console.log('Extracted fields:', {
            amount: amount,
            driverId: driverId,
            reference: reference,
            amountType: typeof amount,
            driverIdType: typeof driverId,
            referenceType: typeof reference
        });
        
        // Validate required fields
        if (!amount || !driverId || !reference || reference.trim() === '') {
            console.error('Missing required fields:', {
                amount: amount,
                driverId: driverId,
                reference: reference
            });
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'amount, driverId, and reference are required',
                received: {
                    amount: amount,
                    driverId: driverId,
                    reference: reference
                }
            });
        }
        
        // Use the billTo parameter we're sending from Android
        const billToValue = billTo || driverId;
        const billEmailValue = billEmail || `${driverId}@urbandrive.com`;
        
        // Truncate billName to 30 characters max (ToyyibPay limit)
        const fullBillName = billName || `Driver ${driverId}`;
        const billNameValue = fullBillName.length > 30 ? fullBillName.substring(0, 30) : fullBillName;
        
        const billDescriptionValue = billDescription || `Commission payment for driver ${driverId}`;
        
        console.log('Creating bill with:', {
            billTo: billToValue,
            billEmail: billEmailValue,
            billName: billNameValue,
            billDescription: billDescriptionValue,
            amount: amount
        });
        
        // Create bill with proper billTo parameter and field length limits
        const billData = {
            billTo: billToValue, // This was the missing piece!
            billDescription: billDescriptionValue.length > 100 ? billDescriptionValue.substring(0, 100) : billDescriptionValue,
            billEmail: billEmailValue,
            billPhone: '0123456789', // Simple numeric format
            billName: billNameValue, // Already truncated to 30 chars
            billAmount: Math.round(amount * 100), // Convert to cents
            billExternalReferenceNo: reference.length > 20 ? reference.substring(0, 20) : reference,
            billContentEmail: 'Thank you for your payment!',
            billAdditionalField: JSON.stringify({
                driverId: driverId,
                reference: reference,
                timestamp: new Date().toISOString()
            })
        };
        
        // Ensure phone number is numeric only - remove any non-numeric characters
        billData.billPhone = billData.billPhone.replace(/\D/g, '');
        if (billData.billPhone.length === 0) {
            billData.billPhone = '0123456789'; // Fallback
        }
        
        console.log('Final bill data to send to ToyyibPay:', JSON.stringify(billData, null, 2));
        
        // Create ToyyibPay bill using direct HTTP request
        const toyyibpayData = {
            userSecretKey: TOYYIBPAY_USER_SECRET_KEY,
            categoryCode: TOYYIBPAY_CATEGORY_CODE,
            billName: billData.billName,
            billDescription: billData.billDescription,
            billPriceSetting: 1,
            billPayorInfo: 1,
            billAmount: billData.billAmount,
            billReturnUrl: returnUrl,
            billCallbackUrl: callbackUrl,
            billExternalReferenceNo: billData.billExternalReferenceNo,
            billTo: billData.billTo,
            billEmail: billData.billEmail,
            billPhone: billData.billPhone,
            billSplitPayment: 0,
            billSplitPaymentArgs: '',
            billPaymentChannel: '0',
            billContentEmail: billData.billContentEmail,
            billAdditionalField: billData.billAdditionalField
        };
        
        console.log('Sending to ToyyibPay API:', JSON.stringify(toyyibpayData, null, 2));
        
        const response = await fetch(TOYYIBPAY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(toyyibpayData)
        });
        
        const responseText = await response.text();
        console.log('ToyyibPay raw response:', responseText);
        
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse ToyyibPay response as JSON:', parseError);
            console.error('Response was:', responseText);
            throw new Error(`ToyyibPay API returned invalid JSON: ${responseText.substring(0, 100)}...`);
        }
        
        console.log('ToyyibPay parsed response:', JSON.stringify(result, null, 2));
        
        // Handle ToyyibPay response format
        if (Array.isArray(result) && result.length > 0 && result[0].BillCode) {
            // ToyyibPay returns array format: [{"BillCode":"rp0fcxj8"}]
            const billCode = result[0].BillCode;
            const paymentUrl = `https://dev.toyyibpay.com/${billCode}`;
            
            console.log('Bill created successfully:', { billCode, paymentUrl });
            
            res.json({
                success: true,
                billCode: billCode,
                paymentUrl: paymentUrl,
                message: 'Bill created successfully'
            });
        } else if (result && result.billCode) {
            // Alternative format: {"billCode":"rp0fcxj8"}
            const paymentUrl = `https://dev.toyyibpay.com/${result.billCode}`;
            
            res.json({
                success: true,
                billCode: result.billCode,
                paymentUrl: paymentUrl,
                message: 'Bill created successfully'
            });
        } else if (result && result.error) {
            // ToyyibPay returned an error
            console.error('ToyyibPay API error:', result);
            res.status(400).json({
                error: 'ToyyibPay API error',
                message: result.error,
                details: result
            });
        } else {
            console.error('ToyyibPay API returned unexpected response:', result);
            res.status(400).json({
                error: 'Failed to create bill',
                message: 'ToyyibPay API returned unexpected response',
                details: result
            });
        }
        
    } catch (error) {
        console.error('Create bill error:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            stack: error.stack
        });
    }
});

// Callback endpoint for ToyyibPay
app.post('/api/toyyibpay/callback', async (req, res) => {
    try {
        console.log('ToyyibPay callback received - Raw body:', req.body);
        console.log('ToyyibPay callback received - Headers:', req.headers);
        console.log('ToyyibPay callback received - Query:', req.query);
        
        // ToyyibPay sends data as form data, not JSON
        const billCode = req.body.billCode || req.query.billCode;
        const billpaymentStatus = req.body.billpaymentStatus || req.query.billpaymentStatus;
        const billpaymentInvoiceNo = req.body.billpaymentInvoiceNo || req.query.billpaymentInvoiceNo;
        
        console.log('Extracted callback data:', {
            billCode,
            billpaymentStatus,
            billpaymentInvoiceNo
        });
        
        if (billpaymentStatus === '1') {
            // Payment successful - update Firebase
            console.log('Payment successful for bill:', billCode);
            
            // Update Firebase to reduce commission
            await updateCommissionInFirebase(billCode, billpaymentInvoiceNo);
            
            console.log('Payment completed:', {
                billCode,
                invoiceNo: billpaymentInvoiceNo,
                status: 'paid',
                action: 'Commission payment received from driver'
            });
        }
        
        res.json({ received: true });
    } catch (error) {
        console.error('Callback error:', error);
        res.status(500).json({ error: 'Callback processing failed' });
    }
});

// Function to update Firebase when payment is successful
async function updateCommissionInFirebase(billCode, invoiceNo) {
    try {
        // This is a placeholder - you'll need to implement Firebase Admin SDK
        // or use a Firebase REST API call to update the database
        
        console.log('Updating Firebase for payment:', {
            billCode,
            invoiceNo,
            action: 'Reduce unpaid commission',
            timestamp: new Date().toISOString()
        });
        
        // TODO: Implement Firebase update logic here
        // 1. Find the driver by billCode (from additionalField)
        // 2. Reduce their unpaid_commission
        // 3. Add payment record to commission_payments
        
    } catch (error) {
        console.error('Firebase update error:', error);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('ToyyibPay backend ready!');
});
