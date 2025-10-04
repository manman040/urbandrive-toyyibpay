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
app.use(express.urlencoded({ extended: true })); // For form data
app.use(cors());

// Custom middleware to handle multipart/form-data
app.use('/api/toyyibpay/callback', (req, res, next) => {
    if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            // Parse multipart form data manually
            const boundary = req.headers['content-type'].split('boundary=')[1];
            const parts = body.split('--' + boundary);
            
            const formData = {};
            parts.forEach(part => {
                if (part.includes('Content-Disposition: form-data')) {
                    const lines = part.split('\r\n');
                    const disposition = lines.find(line => line.includes('Content-Disposition: form-data'));
                    if (disposition) {
                        const nameMatch = disposition.match(/name="([^"]+)"/);
                        if (nameMatch) {
                            const name = nameMatch[1];
                            const value = lines[lines.length - 2]; // Value is usually second to last line
                            if (value && value.trim()) {
                                formData[name] = value.trim();
                            }
                        }
                    }
                }
            });
            
            req.body = formData;
            next();
        });
    } else {
        next();
    }
});

// ToyyibPay configuration
const TOYYIBPAY_USER_SECRET_KEY = process.env.TOYYIBPAY_USER_SECRET_KEY;
const TOYYIBPAY_CATEGORY_CODE = process.env.TOYYIBPAY_CATEGORY_CODE;
const TOYYIBPAY_API_URL = 'https://dev.toyyibpay.com/index.php/api/createBill';

// Log credentials on startup
console.log('ToyyibPay Configuration:');
console.log('Secret Key:', TOYYIBPAY_USER_SECRET_KEY ? `${TOYYIBPAY_USER_SECRET_KEY.substring(0, 8)}...` : 'MISSING');
console.log('Category Code:', TOYYIBPAY_CATEGORY_CODE);
console.log('API URL:', TOYYIBPAY_API_URL);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ ok: true, service: 'ToyyibPay backend' });
});

// Simple credential verification endpoint
app.get('/api/toyyibpay/verify', (req, res) => {
    res.json({
        success: true,
        message: 'ToyyibPay credentials loaded',
        credentials: {
            hasSecretKey: !!TOYYIBPAY_USER_SECRET_KEY,
            hasCategoryCode: !!TOYYIBPAY_CATEGORY_CODE,
            secretKeyPreview: TOYYIBPAY_USER_SECRET_KEY ? `${TOYYIBPAY_USER_SECRET_KEY.substring(0, 8)}...` : 'MISSING',
            categoryCodePreview: TOYYIBPAY_CATEGORY_CODE || 'MISSING',
            apiUrl: TOYYIBPAY_API_URL
        },
        timestamp: new Date().toISOString()
    });
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
        console.log('Bill data from Android:', {
            billTo: req.body.billTo,
            billName: req.body.billName,
            billDescription: req.body.billDescription,
            billPhone: req.body.billPhone
        });
        
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
        
        // Validate amount limits for ToyyibPay
        if (amount < 1) {
            console.error('Amount too small:', amount);
            return res.status(400).json({
                error: 'Invalid amount',
                message: 'Amount must be at least RM 1.00',
                received: amount
            });
        }
        
        if (amount > 10000) {
            console.error('Amount too large:', amount);
            return res.status(400).json({
                error: 'Invalid amount',
                message: 'Amount must not exceed RM 10,000.00',
                received: amount
            });
        }
        
        // Use the billTo parameter we're sending from Android (now contains real driver name)
        const billToValue = billTo || driverId;
        const billEmailValue = billEmail || `${driverId}@urbandrive.com`;
        
        // Use the fixed bill name and description from Android
        const billNameValue = billName || "Pay Commission";
        const billDescriptionValue = billDescription || "Pay commission to company UrbanDriveSdnBhd";
        
        console.log('Creating bill with:', {
            billTo: billToValue,
            billEmail: billEmailValue,
            billName: billNameValue,
            billDescription: billDescriptionValue,
            amount: amount,
            phoneFromRequest: req.body.billPhone
        });
        
        // Get phone number from request or use default
        const phoneNumber = req.body.billPhone || '0123456789';
        
        // Log the final data being sent to ToyyibPay
        console.log('Final bill data before sending to ToyyibPay:', {
            billTo: billToValue,
            billName: billNameValue,
            billDescription: billDescriptionValue,
            billPhone: phoneNumber,
            billEmail: billEmailValue,
            amount: amount,
            timestamp: req.body.timestamp
        });
        
        // Create bill with proper data and remove unnecessary fields
        const billData = {
            billTo: billToValue, // Real driver name from Android
            billDescription: billDescriptionValue.length > 100 ? billDescriptionValue.substring(0, 100) : billDescriptionValue,
            billEmail: billEmailValue,
            billPhone: phoneNumber, // Real phone number from Android
            billName: billNameValue, // Fixed: "Pay Commission"
            billAmount: Math.round(amount * 100), // Convert to cents
            billContentEmail: 'Thank you for your payment!',
            // Store additional data in billExternalReferenceNo instead of billAdditionalField
            // to prevent it from showing as editable form fields
            // Shorten the reference to meet ToyyibPay limits (max 20 characters)
            billExternalReferenceNo: `${reference}_${Date.now()}`.substring(0, 20)
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
            billExternalReferenceNo: billData.billExternalReferenceNo + '_' + Date.now(), // Add timestamp to prevent caching
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
        console.log('ToyyibPay callback received - Content-Type:', req.headers['content-type']);
        
        // ToyyibPay sends data as multipart/form-data
        // Try to get data from both body and query parameters with various field name formats
        const billCode = req.body.billCode || req.query.billCode || req.body.BillCode || req.query.BillCode || req.body.bill_code || req.query.bill_code;
        const billpaymentStatus = req.body.billpaymentStatus || req.query.billpaymentStatus || req.body.BillpaymentStatus || req.query.BillpaymentStatus || req.body.bill_payment_status || req.query.bill_payment_status;
        const billpaymentInvoiceNo = req.body.billpaymentInvoiceNo || req.query.billpaymentInvoiceNo || req.body.BillpaymentInvoiceNo || req.query.BillpaymentInvoiceNo || req.body.bill_payment_invoice_no || req.query.bill_payment_invoice_no;
        
        console.log('Extracted callback data:', {
            billCode,
            billpaymentStatus,
            billpaymentInvoiceNo,
            bodyKeys: Object.keys(req.body),
            queryKeys: Object.keys(req.query)
        });
        
        // Check if we have the required data
        if (!billCode) {
            console.error('No billCode found in callback data');
            return res.status(400).json({ error: 'No billCode found in callback' });
        }
        
        if (billpaymentStatus === '1') {
            // Payment successful - update Firebase
            console.log('Payment successful for bill:', billCode);
            
            // Get additional data from billExternalReferenceNo instead of billAdditionalField
            const billExternalReferenceNo = req.body.billExternalReferenceNo || req.query.billExternalReferenceNo || req.body.BillExternalReferenceNo || req.query.BillExternalReferenceNo;
            let driverId = null;
            let amount = null;
            let reference = null;
            
            if (billExternalReferenceNo) {
                try {
                    // Parse the reference number format: reference_driverId_amount_timestamp
                    const parts = billExternalReferenceNo.split('_');
                    if (parts.length >= 3) {
                        reference = parts[0];
                        driverId = parts[1];
                        amount = parseFloat(parts[2]);
                        console.log('Extracted data from reference number:', { driverId, amount, reference });
                    } else {
                        console.warn('Invalid reference number format:', billExternalReferenceNo);
                    }
                } catch (e) {
                    console.error('Failed to parse reference number:', e);
                }
            } else {
                console.warn('No reference number found in callback - this might cause issues with Firebase update');
            }
            
            // Update Firebase to reduce commission
            await updateCommissionInFirebase(billCode, billpaymentInvoiceNo, driverId, amount, reference);
            
            console.log('Payment completed:', {
                billCode,
                invoiceNo: billpaymentInvoiceNo,
                driverId,
                amount,
                reference,
                status: 'paid',
                action: 'Commission payment received from driver'
            });
        } else {
            console.log('Payment not successful for bill:', billCode, 'Status:', billpaymentStatus);
        }
        
        res.json({ received: true });
    } catch (error) {
        console.error('Callback error:', error);
        res.status(500).json({ error: 'Callback processing failed' });
    }
});

// Function to update Firebase when payment is successful
async function updateCommissionInFirebase(billCode, invoiceNo, driverId, amount, reference) {
    try {
        console.log('Updating Firebase for payment:', {
            billCode,
            invoiceNo,
            driverId,
            amount,
            reference,
            action: 'Reduce unpaid commission',
            timestamp: new Date().toISOString()
        });
        
        // Validate required parameters
        if (!driverId) {
            console.error('No driverId provided for Firebase update');
            return false;
        }
        
        if (!amount || amount <= 0) {
            console.error('Invalid amount provided for Firebase update:', amount);
            return false;
        }
        
        console.log('Processing payment for driver:', driverId, 'Amount:', amount);
        
        // Update Firebase commission
        const success = await updateFirebaseCommission(driverId, amount, billCode, reference);
        
        if (success) {
            console.log('Firebase update completed successfully for bill:', billCode);
        } else {
            console.error('Firebase update failed for bill:', billCode);
        }
        
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

// Test endpoint to verify data
app.get('/api/toyyibpay/test', (req, res) => {
    res.json({
        message: "ToyyibPay backend is working",
        timestamp: new Date().toISOString(),
        environment: {
            hasSecretKey: !!TOYYIBPAY_USER_SECRET_KEY,
            hasCategoryCode: !!TOYYIBPAY_CATEGORY_CODE,
            apiUrl: TOYYIBPAY_API_URL
        }
    });
});

// Credential test endpoint
app.get('/api/toyyibpay/credential-test', async (req, res) => {
    try {
        console.log('Testing ToyyibPay credentials...');
        console.log('Full credentials being used:', {
            userSecretKey: TOYYIBPAY_USER_SECRET_KEY,
            categoryCode: TOYYIBPAY_CATEGORY_CODE,
            apiUrl: TOYYIBPAY_API_URL
        });
        
        // Test with a minimal bill creation request
        const testData = {
            userSecretKey: TOYYIBPAY_USER_SECRET_KEY,
            categoryCode: TOYYIBPAY_CATEGORY_CODE,
            billName: "Test",
            billDescription: "Test",
            billPriceSetting: 1,
            billPayorInfo: 1,
            billAmount: 100, // RM 1.00
            billReturnUrl: "https://example.com/return",
            billCallbackUrl: "https://example.com/callback",
            billExternalReferenceNo: "test123",
            billTo: "Test",
            billEmail: "test@test.com",
            billPhone: "0123456789",
            billSplitPayment: 0,
            billSplitPaymentArgs: "",
            billPaymentChannel: "0",
            billContentEmail: "Test"
        };
        
        console.log('Sending test request to ToyyibPay...');
        console.log('Test data being sent:', testData);
        
        const response = await fetch(TOYYIBPAY_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams(testData)
        });
        
        const responseText = await response.text();
        console.log('ToyyibPay test response:', responseText);
        console.log('ToyyibPay test status:', response.status);
        console.log('ToyyibPay test headers:', response.headers);
        
        // Check if response is successful
        let isSuccess = false;
        let billCode = null;
        
        if (responseText.includes('[FALSE]')) {
            console.log('ToyyibPay returned [FALSE] - credentials are invalid');
        } else if (responseText.includes('[') && responseText.includes(']')) {
            try {
                const result = JSON.parse(responseText);
                if (Array.isArray(result) && result.length > 0 && result[0].BillCode) {
                    isSuccess = true;
                    billCode = result[0].BillCode;
                    console.log('ToyyibPay test successful, bill code:', billCode);
                }
            } catch (parseError) {
                console.log('Failed to parse ToyyibPay response:', parseError);
            }
        }
        
        res.json({
            success: isSuccess,
            status: response.status,
            response: responseText,
            billCode: billCode,
            credentials: {
                hasSecretKey: !!TOYYIBPAY_USER_SECRET_KEY,
                hasCategoryCode: !!TOYYIBPAY_CATEGORY_CODE,
                secretKeyFull: TOYYIBPAY_USER_SECRET_KEY,
                categoryCodeFull: TOYYIBPAY_CATEGORY_CODE,
                secretKeyPreview: TOYYIBPAY_USER_SECRET_KEY ? `${TOYYIBPAY_USER_SECRET_KEY.substring(0, 8)}...` : 'MISSING',
                categoryCodePreview: TOYYIBPAY_CATEGORY_CODE ? `${TOYYIBPAY_CATEGORY_CODE.substring(0, 8)}...` : 'MISSING'
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Credential test error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            credentials: {
                hasSecretKey: !!TOYYIBPAY_USER_SECRET_KEY,
                hasCategoryCode: !!TOYYIBPAY_CATEGORY_CODE,
                secretKeyFull: TOYYIBPAY_USER_SECRET_KEY,
                categoryCodeFull: TOYYIBPAY_CATEGORY_CODE,
                secretKeyPreview: TOYYIBPAY_USER_SECRET_KEY ? `${TOYYIBPAY_USER_SECRET_KEY.substring(0, 8)}...` : 'MISSING',
                categoryCodePreview: TOYYIBPAY_CATEGORY_CODE ? `${TOYYIBPAY_CATEGORY_CODE.substring(0, 8)}...` : 'MISSING'
            }
        });
    }
});

// Settings API endpoints
// Get driver settings
app.get('/api/settings/:driverId', async (req, res) => {
    try {
        const { driverId } = req.params;
        const settingsUrl = `${FIREBASE_DATABASE_URL}/driver_settings/${driverId}.json`;
        
        const response = await fetch(settingsUrl);
        const settings = await response.json();
        
        // Default settings if none exist
        const defaultSettings = {
            notifications: {
                commissionReminders: true,
                jobAlerts: true,
                pushNotifications: true,
                emailNotifications: false
            },
            privacy: {
                dataSharing: false,
                locationTracking: true,
                analytics: false
            },
            lastUpdated: new Date().toISOString()
        };
        
        res.json({
            success: true,
            settings: settings || defaultSettings
        });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

// Update driver settings
app.post('/api/settings/:driverId', async (req, res) => {
    try {
        const { driverId } = req.params;
        const { settings } = req.body;
        
        const settingsUrl = `${FIREBASE_DATABASE_URL}/driver_settings/${driverId}.json`;
        
        const updateData = {
            ...settings,
            lastUpdated: new Date().toISOString()
        };
        
        const response = await fetch(settingsUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData)
        });
        
        if (response.ok) {
            res.json({
                success: true,
                message: 'Settings updated successfully',
                settings: updateData
            });
        } else {
            res.status(500).json({ error: 'Failed to update settings' });
        }
    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// Create booking and notify drivers
app.post('/api/bookings/create', async (req, res) => {
    try {
        const { userId, pickupLocation, destination, vehicleType, fare, status, timestamp } = req.body;
        
        console.log('New booking created:', {
            userId,
            pickupLocation,
            destination,
            vehicleType,
            fare,
            status
        });
        
        // Store booking in Firebase
        const bookingData = {
            userId,
            pickupLocation,
            destination,
            vehicleType,
            fare,
            status,
            timestamp,
            createdAt: new Date().toISOString()
        };
        
        const bookingUrl = `${FIREBASE_DATABASE_URL}/bookings.json`;
        const bookingResponse = await fetch(bookingUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(bookingData)
        });
        
        if (!bookingResponse.ok) {
            throw new Error('Failed to store booking');
        }
        
        const bookingResult = await bookingResponse.json();
        const bookingId = bookingResult.name;
        
        // Get all available drivers
        const driversUrl = `${FIREBASE_DATABASE_URL}/drivers.json`;
        const driversResponse = await fetch(driversUrl);
        const drivers = await driversResponse.json();
        
        if (!drivers) {
            return res.json({
                success: true,
                message: 'Booking created but no drivers available',
                bookingId
            });
        }
        
        // Send notifications to all available drivers
        const notificationPromises = Object.entries(drivers).map(async ([driverId, driverData]) => {
            try {
                // Check if driver has notifications enabled
                const settingsUrl = `${FIREBASE_DATABASE_URL}/driver_settings/${driverId}.json`;
                const settingsResponse = await fetch(settingsUrl);
                const settings = await settingsResponse.json();
                
                if (settings && settings.notifications && settings.notifications.jobAlerts === false) {
                    console.log(`Driver ${driverId} has job alerts disabled`);
                    return;
                }
                
                // Send job alert notification
                const notificationData = {
                    driverId,
                    type: 'job_alert',
                    title: 'New Ride Request!',
                    message: `Pickup: ${pickupLocation}\nDestination: ${destination}\nFare: RM ${fare.toFixed(2)}\nVehicle: ${vehicleType}`,
                    data: {
                        bookingId,
                        pickupLocation,
                        destination,
                        fare,
                        vehicleType,
                        userId
                    }
                };
                
                const notificationUrl = `${FIREBASE_DATABASE_URL}/driver_notifications/${driverId}.json`;
                await fetch(notificationUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(notificationData)
                });
                
                console.log(`Job alert sent to driver ${driverId}`);
            } catch (error) {
                console.error(`Error sending notification to driver ${driverId}:`, error);
            }
        });
        
        // Wait for all notifications to be sent
        await Promise.all(notificationPromises);
        
        res.json({
            success: true,
            message: 'Booking created and drivers notified',
            bookingId,
            driversNotified: Object.keys(drivers).length
        });
        
    } catch (error) {
        console.error('Error creating booking:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create booking',
            message: error.message
        });
    }
});

// Send notification to driver
app.post('/api/notifications/send', async (req, res) => {
    try {
        const { driverId, type, title, message, data } = req.body;
        
        // Check if driver has notifications enabled
        const settingsUrl = `${FIREBASE_DATABASE_URL}/driver_settings/${driverId}.json`;
        const settingsResponse = await fetch(settingsUrl);
        const settings = await settingsResponse.json();
        
        if (!settings || !settings.notifications || !settings.notifications.pushNotifications) {
            return res.json({
                success: false,
                message: 'Driver has notifications disabled'
            });
        }
        
        // Store notification in Firebase
        const notificationData = {
            driverId,
            type,
            title,
            message,
            data: data || {},
            timestamp: new Date().toISOString(),
            read: false
        };
        
        const notificationUrl = `${FIREBASE_DATABASE_URL}/driver_notifications/${driverId}.json`;
        const response = await fetch(notificationUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(notificationData)
        });
        
        if (response.ok) {
            res.json({
                success: true,
                message: 'Notification sent successfully',
                notification: notificationData
            });
        } else {
            res.status(500).json({ error: 'Failed to send notification' });
        }
    } catch (error) {
        console.error('Send notification error:', error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

// Get driver notifications
app.get('/api/notifications/:driverId', async (req, res) => {
    try {
        const { driverId } = req.params;
        const notificationsUrl = `${FIREBASE_DATABASE_URL}/driver_notifications/${driverId}.json`;
        
        const response = await fetch(notificationsUrl);
        const notifications = await response.json();
        
        // Convert to array and sort by timestamp
        const notificationsArray = notifications ? Object.values(notifications).sort((a, b) => 
            new Date(b.timestamp) - new Date(a.timestamp)
        ) : [];
        
        res.json({
            success: true,
            notifications: notificationsArray
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});

// Mark notification as read
app.post('/api/notifications/:driverId/read', async (req, res) => {
    try {
        const { driverId } = req.params;
        const { notificationId } = req.body;
        
        const notificationUrl = `${FIREBASE_DATABASE_URL}/driver_notifications/${driverId}/${notificationId}.json`;
        
        const response = await fetch(notificationUrl, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ read: true })
        });
        
        if (response.ok) {
            res.json({
                success: true,
                message: 'Notification marked as read'
            });
        } else {
            res.status(500).json({ error: 'Failed to mark notification as read' });
        }
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

// Get app information
app.get('/api/app/info', (req, res) => {
    res.json({
        success: true,
        appInfo: {
            name: "UrbanDrive",
            version: "1.0.0",
            description: "UrbanDrive is a comprehensive ride-sharing platform that connects drivers with passengers, providing a seamless transportation experience across urban areas. Our app features real-time tracking, secure payments, commission management, and advanced safety features.",
            history: "UrbanDrive was developed as a Final Year Project (FYP) to revolutionize urban transportation. The project began in 2024 with the vision of creating a more efficient, safe, and user-friendly ride-sharing platform.",
            createdDate: "January 2024",
            lastUpdated: "December 2024",
            creators: [
                {
                    name: "Aiman Farhan",
                    role: "Lead Developer & Backend Engineer",
                    contribution: "Backend development, API integration, payment systems, and database architecture"
                },
                {
                    name: "Izzral Firhan", 
                    role: "Frontend Developer & UI/UX Designer",
                    contribution: "Mobile app development, user interface design, and user experience optimization"
                }
            ],
            features: [
                "Real-time GPS tracking",
                "Secure payment processing via ToyyibPay",
                "Commission management system",
                "Driver and passenger matching",
                "Safety features and emergency contacts",
                "Notification system",
                "Privacy and security controls"
            ],
            technologies: [
                "React Native (Mobile App)",
                "Node.js & Express (Backend)",
                "Firebase (Database)",
                "ToyyibPay (Payment Gateway)",
                "Google Maps API (Location Services)"
            ]
        }
    });
});

// Success page endpoint
app.get('/api/toyyibpay/success', (req, res) => {
    const { amount, driverName, reference, billCode } = req.query;
    
    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Success - UrbanDrive</title>
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                margin: 0;
                padding: 20px;
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .success-container {
                background: white;
                border-radius: 20px;
                padding: 40px;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                text-align: center;
                max-width: 500px;
                width: 100%;
            }
            .success-icon {
                font-size: 80px;
                color: #4CAF50;
                margin-bottom: 20px;
            }
            .success-title {
                color: #333;
                font-size: 28px;
                font-weight: bold;
                margin-bottom: 10px;
            }
            .success-subtitle {
                color: #666;
                font-size: 16px;
                margin-bottom: 30px;
            }
            .payment-details {
                background: #f8f9fa;
                border-radius: 10px;
                padding: 20px;
                margin: 20px 0;
                text-align: left;
            }
            .detail-row {
                display: flex;
                justify-content: space-between;
                margin: 10px 0;
                padding: 5px 0;
                border-bottom: 1px solid #eee;
            }
            .detail-label {
                font-weight: bold;
                color: #555;
            }
            .detail-value {
                color: #333;
            }
            .countdown {
                background: #e3f2fd;
                border-radius: 10px;
                padding: 15px;
                margin: 20px 0;
                font-size: 18px;
                font-weight: bold;
                color: #1976d2;
            }
            .return-button {
                background: #4CAF50;
                color: white;
                border: none;
                padding: 15px 30px;
                border-radius: 25px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                margin-top: 20px;
                transition: background 0.3s;
            }
            .return-button:hover {
                background: #45a049;
            }
        </style>
    </head>
    <body>
        <div class="success-container">
            <div class="success-icon">✓</div>
            <h1 class="success-title">Payment Successful!</h1>
            <p class="success-subtitle">Your commission payment has been processed successfully.</p>
            
            <div class="payment-details">
                <div class="detail-row">
                    <span class="detail-label">Driver Name:</span>
                    <span class="detail-value">${driverName || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Amount:</span>
                    <span class="detail-value">RM ${amount || '0.00'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Reference:</span>
                    <span class="detail-value">${reference || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Transaction ID:</span>
                    <span class="detail-value">${billCode || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Payment Date:</span>
                    <span class="detail-value">${new Date().toLocaleDateString()}</span>
                </div>
            </div>
            
            <div class="countdown" id="countdown">
                Redirecting to commission page in <span id="timer">10</span> seconds...
            </div>
            
            <button class="return-button" onclick="returnToApp()">
                Return to App Now
            </button>
        </div>
        
        <script>
            let timeLeft = 10;
            const timerElement = document.getElementById('timer');
            
            const countdown = setInterval(() => {
                timeLeft--;
                timerElement.textContent = timeLeft;
                
                if (timeLeft <= 0) {
                    clearInterval(countdown);
                    returnToApp();
                }
            }, 1000);
            
            function returnToApp() {
                // Try to return to the app using deep link
                window.location.href = 'yourapp://toyyib/return';
                
                // Fallback: close the window after a short delay
                setTimeout(() => {
                    window.close();
                }, 1000);
            }
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log('ToyyibPay backend ready!');
});
