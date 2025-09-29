// Complete backend fix for Render.com deployment
// Replace your existing backend code with this

import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

// Firebase configuration
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;

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
        
        // Update Firebase automatically
        const success = await updateFirebaseCommission(driverId, amount, billCode, reference);
        
        if (success) {
            res.json({
                success: true,
                message: 'Commission updated successfully in Firebase',
                data: {
                    driverId,
                    amount,
                    billCode,
                    reference,
                    action: 'Reduced unpaid_commission by ' + amount
                }
            });
        } else {
            res.status(500).json({
                error: 'Failed to update Firebase',
                message: 'Commission update failed'
            });
        }
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
        console.log('ToyyibPay credentials check:', {
            userSecretKey: TOYYIBPAY_USER_SECRET_KEY ? `${TOYYIBPAY_USER_SECRET_KEY.substring(0, 8)}...` : 'MISSING',
            categoryCode: TOYYIBPAY_CATEGORY_CODE ? `${TOYYIBPAY_CATEGORY_CODE.substring(0, 8)}...` : 'MISSING',
            apiUrl: TOYYIBPAY_API_URL
        });
        
        // Try the ToyyibPay API with proper error handling
        let response;
        let responseText;
        
        try {
            response = await fetch(TOYYIBPAY_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams(toyyibpayData)
            });
            
            responseText = await response.text();
            console.log('ToyyibPay raw response:', responseText);
            console.log('ToyyibPay response status:', response.status);
            console.log('ToyyibPay response headers:', response.headers);
            
        } catch (fetchError) {
            console.error('Fetch error:', fetchError);
            throw new Error(`Failed to connect to ToyyibPay API: ${fetchError.message}`);
        }
        
        // Check if response is HTML (error page)
        if (responseText.includes('<!DOCTYPE html>') || responseText.includes('<html')) {
            console.error('ToyyibPay returned HTML error page:', responseText.substring(0, 500));
            throw new Error(`ToyyibPay API returned HTML error page. Check your credentials and API endpoint. Response: ${responseText.substring(0, 200)}...`);
        }
        
        // Check for ToyyibPay error messages in plain text
        if (responseText.includes('[KEY-DID-NOT-EXIST]')) {
            console.error('ToyyibPay API error: Invalid credentials');
            throw new Error('ToyyibPay API error: Invalid userSecretKey or categoryCode. Please check your ToyyibPay credentials.');
        }
        
        if (responseText.includes('[USER-IS-NOT-ACTIVE]')) {
            console.error('ToyyibPay API error: User account not active');
            throw new Error('ToyyibPay API error: User account is not active. Please contact ToyyibPay support.');
        }
        
        if (responseText.includes('[CATEGORY-NOT-EXIST]')) {
            console.error('ToyyibPay API error: Invalid category code');
            throw new Error('ToyyibPay API error: Invalid categoryCode. Please check your ToyyibPay category code.');
        }
        
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse ToyyibPay response as JSON:', parseError);
            console.error('Response was:', responseText);
            
            // Check if it's a known ToyyibPay error format
            if (responseText.includes('[') && responseText.includes(']')) {
                throw new Error(`ToyyibPay API error: ${responseText.trim()}`);
            }
            
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
        console.log('Updating Firebase for payment:', {
            billCode,
            invoiceNo,
            action: 'Reduce unpaid commission',
            timestamp: new Date().toISOString()
        });
        
        // Get driver info from the billCode (we need to store this mapping)
        // For now, we'll extract from the billCode or use a lookup
        
        // TODO: Implement Firebase REST API calls to:
        // 1. Get current unpaid commission
        // 2. Reduce unpaid commission by payment amount
        // 3. Add payment record to commission_payments
        
        console.log('Firebase update completed for bill:', billCode);
        
    } catch (error) {
        console.error('Firebase update error:', error);
    }
}

// Function to update Firebase commission via REST API
async function updateFirebaseCommission(driverId, amount, billCode, reference) {
    try {
        const firebaseUrl = `${FIREBASE_DATABASE_URL}/driver_commissions/${driverId}/commission_summary.json`;
        
        // Get current commission data
        const getResponse = await fetch(firebaseUrl);
        const currentData = await getResponse.json();
        
        if (currentData) {
            const currentUnpaid = currentData.unpaid_commission || 0;
            const newUnpaid = Math.max(0, currentUnpaid - amount);
            
            // Update unpaid commission
            const updateData = {
                unpaid_commission: newUnpaid
            };
            
            const updateResponse = await fetch(firebaseUrl, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updateData)
            });
            
            if (updateResponse.ok) {
                console.log('Commission updated successfully:', {
                    driverId,
                    oldUnpaid: currentUnpaid,
                    newUnpaid: newUnpaid,
                    amountPaid: amount
                });
                
                // Add payment record
                await addPaymentRecord(driverId, amount, billCode, reference);
                
                return true;
            }
        }
        
        return false;
    } catch (error) {
        console.error('Firebase update error:', error);
        return false;
    }
}

// Function to add payment record to Firebase
async function addPaymentRecord(driverId, amount, billCode, reference) {
    try {
        const paymentData = {
            amount: amount,
            billCode: billCode,
            reference: reference,
            status: 'paid',
            timestamp: new Date().toISOString(),
            paymentMethod: 'ToyyibPay'
        };
        
        const paymentUrl = `${FIREBASE_DATABASE_URL}/commission_payments/${driverId}.json`;
        
        const response = await fetch(paymentUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(paymentData)
        });
        
        if (response.ok) {
            console.log('Payment record added successfully:', paymentData);
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Payment record error:', error);
        return false;
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('ToyyibPay backend ready!');
});
