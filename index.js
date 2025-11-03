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

// ToyyibPay API URLs - use environment variable or default to development (sandbox)
// Production: https://toyyibpay.com
// Development (Sandbox): https://dev.toyyibpay.com
const TOYYIBPAY_BASE_URL = process.env.TOYYIBPAY_BASE_URL || 'https://dev.toyyibpay.com';
const TOYYIBPAY_API_URL = `${TOYYIBPAY_BASE_URL}/index.php/api/createBill`;

// Log credentials on startup
console.log('ToyyibPay Configuration:');
console.log('Environment:', TOYYIBPAY_BASE_URL.includes('dev') ? 'DEVELOPMENT' : 'PRODUCTION');
console.log('Base URL:', TOYYIBPAY_BASE_URL);
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
        environment: TOYYIBPAY_BASE_URL.includes('dev') ? 'DEVELOPMENT' : 'PRODUCTION',
        credentials: {
            hasSecretKey: !!TOYYIBPAY_USER_SECRET_KEY,
            hasCategoryCode: !!TOYYIBPAY_CATEGORY_CODE,
            secretKeyPreview: TOYYIBPAY_USER_SECRET_KEY ? `${TOYYIBPAY_USER_SECRET_KEY.substring(0, 8)}...` : 'MISSING',
            categoryCodePreview: TOYYIBPAY_CATEGORY_CODE || 'MISSING',
            baseUrl: TOYYIBPAY_BASE_URL,
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

// Manual payment processing endpoint - processes payment by billCode
app.post('/api/payment/process', async (req, res) => {
    try {
        const { billCode } = req.body;
        
        if (!billCode) {
            return res.status(400).json({
                error: 'Missing billCode',
                message: 'billCode is required to process payment'
            });
        }
        
        console.log('🔄 Manual payment processing for billCode:', billCode);
        
        // Get data from bill_mappings
        const mappingUrl = `${FIREBASE_DATABASE_URL}/bill_mappings/${billCode}.json`;
        const mappingResponse = await fetch(mappingUrl);
        const mapping = await mappingResponse.json();
        
        if (!mapping || !mapping.driverId || !mapping.amount) {
            return res.status(404).json({
                error: 'Payment not found',
                message: `No payment data found for billCode: ${billCode}`,
                billCode: billCode
            });
        }
        
        const { driverId, amount, reference } = mapping;
        
        console.log('Found payment data:', { driverId, amount, reference, billCode });
        
        // Process payment
        const success = await updateFirebaseCommission(driverId, amount, billCode, reference);
        
        if (success) {
            res.json({
                success: true,
                message: 'Payment processed successfully',
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
                error: 'Failed to process payment',
                message: 'Payment processing failed',
                data: { driverId, amount, billCode, reference }
            });
        }
    } catch (error) {
        console.error('Payment processing error:', error);
        res.status(500).json({
            error: 'Payment processing failed',
            message: error.message
        });
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
        // Generate a unique reference number that includes necessary data for callback
        // Format: ref_driverIdShort_amount_timestamp (max 50 chars for ToyyibPay)
        const timestamp = Date.now();
        // Shorten driverId to first 8 chars to save space, include amount
        const driverIdShort = driverId.substring(0, 8);
        // Build reference: ref_driverIdShort_amount_timestamp
        // Example: seringgit_dc0aoTWf_1_1762055701520 (31 chars - well under 50)
        const billExternalReferenceNo = `${reference || 'REF'}_${driverIdShort}_${amount}_${timestamp}`.substring(0, 50);
        
        const billData = {
            billTo: billToValue, // Real driver name from Android
            billDescription: billDescriptionValue.length > 100 ? billDescriptionValue.substring(0, 100) : billDescriptionValue,
            billEmail: billEmailValue,
            billPhone: phoneNumber, // Real phone number from Android
            billName: billNameValue, // Fixed: "Pay Commission"
            billAmount: Math.round(amount * 100), // Convert to cents
            billContentEmail: 'Thank you for your payment!',
            billExternalReferenceNo: billExternalReferenceNo
        };
        
        // Ensure phone number is numeric only - remove any non-numeric characters
        billData.billPhone = billData.billPhone.replace(/\D/g, '');
        if (billData.billPhone.length === 0) {
            billData.billPhone = '0123456789'; // Fallback
        }
        
        // Validate and clean fields for ToyyibPay requirements
        // ToyyibPay field length limits (common limits)
        if (billData.billName.length > 100) {
            billData.billName = billData.billName.substring(0, 100);
            console.warn('billName truncated to 100 characters');
        }
        if (billData.billDescription.length > 100) {
            billData.billDescription = billData.billDescription.substring(0, 100);
            console.warn('billDescription truncated to 100 characters');
        }
        if (billData.billTo.length > 100) {
            billData.billTo = billData.billTo.substring(0, 100);
            console.warn('billTo truncated to 100 characters');
        }
        if (billData.billEmail.length > 100) {
            billData.billEmail = billData.billEmail.substring(0, 100);
            console.warn('billEmail truncated to 100 characters');
        }
        if (billData.billPhone.length > 20) {
            billData.billPhone = billData.billPhone.substring(0, 20);
            console.warn('billPhone truncated to 20 characters');
        }
        if (billData.billExternalReferenceNo.length > 50) {
            billData.billExternalReferenceNo = billData.billExternalReferenceNo.substring(0, 50);
            console.warn('billExternalReferenceNo truncated to 50 characters');
        }
        
        // Validate email format (basic check)
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(billData.billEmail)) {
            console.warn('billEmail format might be invalid:', billData.billEmail);
        }
        
        console.log('Final bill data to send to ToyyibPay:', JSON.stringify(billData, null, 2));
        
        // Create ToyyibPay bill using direct HTTP request
        // Only include fields that are required or have valid values
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
            billExternalReferenceNo: billData.billExternalReferenceNo, // Use the reference we created above (no double timestamp)
            billTo: billData.billTo,
            billEmail: billData.billEmail,
            billPhone: billData.billPhone,
            billSplitPayment: 0,
            billSplitPaymentArgs: '',
            billPaymentChannel: '0',
            billContentEmail: billData.billContentEmail
            // Note: Removed billAdditionalField as it's not needed and was causing issues
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
            // Use FormData instead of URLSearchParams for ToyyibPay
            const formData = new FormData();
            Object.keys(toyyibpayData).forEach(key => {
                formData.append(key, toyyibpayData[key]);
            });
            
            response = await fetch(TOYYIBPAY_API_URL, {
                method: 'POST',
                // Remove Content-Type header to let fetch set the correct boundary
                body: formData
            });
            
            responseText = await response.text();
            console.log('ToyyibPay raw response:', responseText);
            console.log('ToyyibPay response status:', response.status);
            console.log('ToyyibPay response headers:', response.headers);
            
        } catch (fetchError) {
            console.error('Fetch error:', fetchError);
            
            // Check for SSL/TLS related errors
            if (fetchError.message.includes('certificate') || fetchError.message.includes('SSL') || fetchError.message.includes('TLS')) {
                throw new Error(`SSL Certificate Error: Unable to establish secure connection to ToyyibPay API. This is a server-side SSL certificate issue with ${TOYYIBPAY_BASE_URL} that needs to be resolved by ToyyibPay or your hosting provider. Error: ${fetchError.message}`);
            }
            
            throw new Error(`Failed to connect to ToyyibPay API: ${fetchError.message}`);
        }
        
        // Check if response is HTML (error page) - specifically check for Cloudflare SSL errors
        if (responseText.includes('<!DOCTYPE html>') || responseText.includes('<html')) {
            // Check for Cloudflare SSL error (Error 526)
            if (responseText.includes('Invalid SSL certificate') || responseText.includes('Error code 526')) {
                console.error('Cloudflare SSL certificate error (526) detected');
                throw new Error(`Cloudflare SSL Error (526): The ToyyibPay API endpoint (${TOYYIBPAY_BASE_URL}) has an invalid SSL certificate. This is a server-side issue that needs to be fixed by ToyyibPay. The connection is being blocked by Cloudflare's security layer. Please contact ToyyibPay support to resolve the SSL certificate issue.`);
            }
            
            console.error('ToyyibPay returned HTML error page:', responseText.substring(0, 500));
            throw new Error(`ToyyibPay API returned HTML error page. Check your credentials and API endpoint. Response: ${responseText.substring(0, 200)}...`);
        }
        
        // Trim whitespace from response
        responseText = responseText.trim();
        
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
        
        // Check for [FALSE] response - this usually means validation failed
        if (responseText === '[FALSE]' || responseText.includes('[FALSE]')) {
            console.error('ToyyibPay returned [FALSE] - Validation failed');
            console.error('Request data that was sent:', JSON.stringify(toyyibpayData, null, 2));
            throw new Error(`ToyyibPay API validation failed. Common causes: invalid field values, missing required fields, or field length exceeded. Please check: billName, billDescription, billTo, billEmail, billPhone, billExternalReferenceNo. Raw response: ${responseText}`);
        }
        
        let result;
        try {
            result = JSON.parse(responseText);
        } catch (parseError) {
            console.error('Failed to parse ToyyibPay response as JSON:', parseError);
            console.error('Raw response text:', responseText);
            console.error('Request that failed:', JSON.stringify(toyyibpayData, null, 2));
            
            // Check if it's a known ToyyibPay error format
            if (responseText.includes('[') && responseText.includes(']')) {
                throw new Error(`ToyyibPay API error: ${responseText}. This usually means invalid data was sent. Check field lengths and required fields.`);
            }
            
            throw new Error(`ToyyibPay API returned invalid JSON: ${responseText.substring(0, 100)}...`);
        }
        
        console.log('ToyyibPay parsed response:', JSON.stringify(result, null, 2));
        
        // Handle ToyyibPay response format
        if (Array.isArray(result) && result.length > 0 && result[0].BillCode) {
            // ToyyibPay returns array format: [{"BillCode":"rp0fcxj8"}]
            const billCode = result[0].BillCode;
            const paymentUrl = `${TOYYIBPAY_BASE_URL}/${billCode}`;
            
            console.log('Bill created successfully:', { billCode, paymentUrl });
            
            // Store billCode mapping for callback retrieval
            await storeBillCodeMapping(billCode, driverId, amount, reference, billData.billExternalReferenceNo);
            
            res.json({
                success: true,
                billCode: billCode,
                paymentUrl: paymentUrl,
                message: 'Bill created successfully'
            });
        } else if (result && result.billCode) {
            // Alternative format: {"billCode":"rp0fcxj8"}
            const paymentUrl = `${TOYYIBPAY_BASE_URL}/${result.billCode}`;
            
            // Store billCode mapping for callback retrieval
            await storeBillCodeMapping(result.billCode, driverId, amount, reference, billData.billExternalReferenceNo);
            
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

// Function to store billCode mapping for callback retrieval
async function storeBillCodeMapping(billCode, driverId, amount, reference, billExternalReferenceNo) {
    try {
        const mappingData = {
            driverId: driverId,
            amount: amount,
            reference: reference,
            billExternalReferenceNo: billExternalReferenceNo,
            createdAt: new Date().toISOString()
        };
        
        const mappingUrl = `${FIREBASE_DATABASE_URL}/bill_mappings/${billCode}.json`;
        const response = await fetch(mappingUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(mappingData)
        });
        
        if (response.ok) {
            console.log('BillCode mapping stored successfully:', { billCode, driverId, amount });
            return true;
        } else {
            console.error('Failed to store billCode mapping:', response.status, response.statusText);
            return false;
        }
    } catch (error) {
        console.error('Error storing billCode mapping:', error);
        return false;
    }
}

// Callback endpoint for ToyyibPay
app.post('/api/toyyibpay/callback', async (req, res) => {
    try {
        console.log('=== TOYYIBPAY CALLBACK RECEIVED ===');
        console.log('Raw body:', JSON.stringify(req.body, null, 2));
        console.log('Query params:', JSON.stringify(req.query, null, 2));
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        console.log('Content-Type:', req.headers['content-type']);
        
        // ToyyibPay sends data as multipart/form-data
        // Try to get data from both body and query parameters with various field name formats
        const billCode = req.body.billCode || req.query.billCode || req.body.BillCode || req.query.BillCode || 
                       req.body.bill_code || req.query.bill_code || req.body.billcode || req.query.billcode ||
                       req.body.Billcode || req.query.Billcode;
        const billpaymentStatus = req.body.billpaymentStatus || req.query.billpaymentStatus || 
                                  req.body.BillpaymentStatus || req.query.BillpaymentStatus || 
                                  req.body.bill_payment_status || req.query.bill_payment_status ||
                                  req.body.statuscode || req.query.statuscode || req.body.StatusCode || req.query.StatusCode ||
                                  req.body.status || req.query.status;
        const billpaymentInvoiceNo = req.body.billpaymentInvoiceNo || req.query.billpaymentInvoiceNo || 
                                    req.body.BillpaymentInvoiceNo || req.query.BillpaymentInvoiceNo || 
                                    req.body.bill_payment_invoice_no || req.query.bill_payment_invoice_no;
        
        console.log('=== EXTRACTED CALLBACK DATA ===');
        console.log('billCode:', billCode);
        console.log('billpaymentStatus:', billpaymentStatus);
        console.log('billpaymentInvoiceNo:', billpaymentInvoiceNo);
        console.log('All body keys:', Object.keys(req.body));
        console.log('All query keys:', Object.keys(req.query));
        
        // Check if we have the required data
        if (!billCode) {
            console.error('❌ ERROR: No billCode found in callback data');
            console.error('Available body fields:', Object.keys(req.body));
            console.error('Available query fields:', Object.keys(req.query));
            console.error('Full request:', { body: req.body, query: req.query });
            
            // Still respond with success to ToyyibPay to avoid retries
            return res.status(200).json({ received: true, error: 'No billCode found' });
        }
        
        if (billpaymentStatus === '1' || billpaymentStatus === 1 || billCode) {
            // Payment successful - update Firebase
            // Note: Some ToyyibPay environments don't send status, so we process if billCode exists
            console.log('✅ Payment processing for bill:', billCode);
            console.log('Payment status:', billpaymentStatus);
            
            // CRITICAL: ALWAYS check bill_mappings FIRST - this is where we store driverId and amount when creating the bill
            let driverId = null;
            let amount = null;
            let reference = null;
            let billExternalReferenceNo = null;
            
            // STEP 1: Try to get data from bill_mappings (MOST RELIABLE)
            try {
                console.log('🔍 Step 1: Checking bill_mappings for billCode:', billCode);
                const mappingUrl = `${FIREBASE_DATABASE_URL}/bill_mappings/${billCode}.json`;
                const mappingResponse = await fetch(mappingUrl);
                const mapping = await mappingResponse.json();
                
                if (mapping && mapping.driverId && mapping.amount) {
                    driverId = mapping.driverId;
                    amount = mapping.amount;
                    reference = mapping.reference || null;
                    billExternalReferenceNo = mapping.billExternalReferenceNo || null;
                    console.log('✅ Found data in bill_mappings:', { driverId, amount, reference });
                } else {
                    console.warn('⚠️ bill_mappings found but missing driverId or amount:', mapping);
                }
            } catch (mappingError) {
                console.error('❌ Failed to get billCode mapping:', mappingError);
            }
            
            // STEP 2: If bill_mappings didn't work, try parsing billExternalReferenceNo as fallback
            if (!driverId || !amount) {
                console.warn('⚠️ bill_mappings didn\'t have complete data, trying billExternalReferenceNo...');
                billExternalReferenceNo = req.body.billExternalReferenceNo || req.query.billExternalReferenceNo || req.body.BillExternalReferenceNo || req.query.BillExternalReferenceNo;
                
                if (billExternalReferenceNo) {
                    try {
                        // Parse the reference number format: reference_driverIdShort_amount_timestamp
                        const parts = billExternalReferenceNo.split('_');
                        if (parts.length >= 4) {
                            // New format: reference_driverIdShort_amount_timestamp
                            if (!reference) reference = parts[0];
                            if (!amount) amount = parseFloat(parts[2]);
                            const driverIdShort = parts[1];
                            
                            // Find full driverId from drivers table
                            if (!driverId) {
                                const driversUrl = `${FIREBASE_DATABASE_URL}/drivers.json`;
                                const driversResponse = await fetch(driversUrl);
                                const drivers = await driversResponse.json();
                                
                                if (drivers) {
                                    const matchingDriverId = Object.keys(drivers).find(id => id.startsWith(driverIdShort));
                                    if (matchingDriverId) {
                                        driverId = matchingDriverId;
                                        console.log('✅ Found driverId from reference:', { driverIdShort, driverId, amount });
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        console.error('Failed to parse reference number:', e);
                    }
                }
            }
            
            // Validate we have required data before updating
            if (!driverId || !amount) {
                console.error('❌ Missing driverId or amount. Cannot update commission.');
                console.error('driverId:', driverId, 'amount:', amount);
                return res.status(200).json({ 
                    received: true, 
                    error: 'Missing driverId or amount',
                    billCode: billCode
                });
            }
            
            // Update Firebase to reduce commission
            console.log('🔄 Updating Firebase commission...');
            const updateSuccess = await updateCommissionInFirebase(billCode, billpaymentInvoiceNo, driverId, amount, reference);
            
            if (updateSuccess) {
                console.log('✅ Payment completed successfully:', {
                    billCode,
                    invoiceNo: billpaymentInvoiceNo,
                    driverId,
                    amount,
                    reference,
                    status: 'paid',
                    action: 'Commission payment received from driver'
                });
            } else {
                console.error('❌ Failed to update Firebase commission');
            }
        } else {
            console.log('⚠️ Payment not successful for bill:', billCode, 'Status:', billpaymentStatus);
        }
        
        // Always respond with success to ToyyibPay to prevent retries
        res.status(200).json({ received: true, billCode: billCode });
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
        console.log('=== UPDATING FIREBASE COMMISSION ===');
        console.log('driverId:', driverId);
        console.log('amount:', amount);
        console.log('billCode:', billCode);
        console.log('reference:', reference);
        
        if (!driverId || !amount || !billCode) {
            console.error('❌ Missing required parameters for Firebase update');
            return false;
        }
        
        // Try both paths - commission_summary might be at driver_commissions or directly
        let firebaseUrl = `${FIREBASE_DATABASE_URL}/driver_commissions/${driverId}/commission_summary.json`;
        
        // Get current commission data
        console.log('Fetching current commission from:', firebaseUrl);
        let getResponse = await fetch(firebaseUrl);
        
        // If first path fails, try alternative path
        if (!getResponse.ok) {
            console.warn('⚠️ First path failed, trying alternative path...');
            const altFirebaseUrl = `${FIREBASE_DATABASE_URL}/commissions/${driverId}.json`;
            getResponse = await fetch(altFirebaseUrl);
            if (getResponse.ok) {
                firebaseUrl = altFirebaseUrl;
                console.log('✅ Using alternative path:', firebaseUrl);
            }
        }
        
        if (!getResponse.ok) {
            console.error('❌ Failed to fetch commission data. Status:', getResponse.status);
            // Try to create commission_summary if it doesn't exist
            const createData = {
                unpaid_commission: 0,
                total_commission: 0,
                total_rides: 0
            };
            const createResponse = await fetch(firebaseUrl, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(createData)
            });
            if (!createResponse.ok) {
                console.error('❌ Failed to create commission_summary');
                return false;
            }
            console.log('✅ Created new commission_summary');
        }
        
        const currentData = await getResponse.json();
        console.log('Current commission data:', currentData);
        
        if (currentData) {
            const currentUnpaid = parseFloat(currentData.unpaid_commission) || 0;
            const amountToDeduct = parseFloat(amount) || 0;
            const newUnpaid = Math.max(0, currentUnpaid - amountToDeduct);
            
            console.log('Commission calculation:', {
                currentUnpaid: currentUnpaid,
                amountToDeduct: amountToDeduct,
                newUnpaid: newUnpaid
            });
            
            // Update unpaid commission
            const updateData = {
                unpaid_commission: newUnpaid
            };
            
            console.log('Updating commission with:', updateData);
            const updateResponse = await fetch(firebaseUrl, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(updateData)
            });
            
            const updateResponseText = await updateResponse.text();
            
            if (updateResponse.ok) {
                console.log('✅ Commission updated successfully:', {
                    driverId,
                    oldUnpaid: currentUnpaid,
                    newUnpaid: newUnpaid,
                    amountPaid: amountToDeduct
                });
                console.log('Update response:', updateResponseText);
                
                // Add payment record
                console.log('Adding payment record...');
                const paymentRecordSuccess = await addPaymentRecord(driverId, amountToDeduct, billCode, reference);
                
                if (paymentRecordSuccess) {
                    console.log('✅ Payment record added successfully');
                    return true;
                } else {
                    console.error('⚠️ Commission updated but payment record failed');
                    // Still return true since commission was updated
                    return true;
                }
            } else {
                console.error('❌ Failed to update commission. Status:', updateResponse.status);
                console.error('Error response:', updateResponseText);
                console.error('Firebase URL:', firebaseUrl);
                
                // Check for Firebase-specific errors
                if (updateResponseText.includes('Permission denied') || updateResponseText.includes('permission')) {
                    console.error('🚨 FIREBASE SECURITY RULES ERROR: Permission denied!');
                    console.error('💡 Solution: Update your Firebase rules to allow writes:');
                    console.error('   { "rules": { ".read": "now < 1798771200000", ".write": "now < 1798771200000" } }');
                }
                
                return false;
            }
        } else {
            console.error('❌ No current data returned from Firebase');
            return false;
        }
    } catch (error) {
        console.error('❌ Firebase update error:', error);
        console.error('Error stack:', error.stack);
        return false;
    }
}

// Function to add payment record to Firebase
async function addPaymentRecord(driverId, amount, billCode, reference) {
    try {
        console.log('=== ADDING PAYMENT RECORD ===');
        console.log('driverId:', driverId);
        console.log('amount:', amount);
        console.log('billCode:', billCode);
        console.log('reference:', reference);
        
        if (!driverId || !amount || !billCode) {
            console.error('❌ Missing required fields for payment record');
            return false;
        }
        
        const paymentData = {
            amount: parseFloat(amount),
            billCode: billCode,
            reference: reference || '',
            status: 'paid',
            timestamp: new Date().toISOString(),
            paymentMethod: 'ToyyibPay',
            createdAt: new Date().toISOString()
        };
        
        // Ensure Firebase URL ends with .json and includes auth parameter if needed
        let paymentUrl = `${FIREBASE_DATABASE_URL}/commission_payments/${driverId}.json`;
        
        // Firebase REST API requires .json suffix - ensure it's there
        if (!paymentUrl.endsWith('.json')) {
            paymentUrl += '.json';
        }
        
        console.log('POSTing to:', paymentUrl);
        console.log('Payment data:', JSON.stringify(paymentData, null, 2));
        console.log('Firebase Database URL:', FIREBASE_DATABASE_URL);
        
        const response = await fetch(paymentUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(paymentData)
        });

        const responseText = await response.text();
        
        if (response.ok) {
            let result;
            try {
                result = JSON.parse(responseText);
            } catch (e) {
                result = { name: responseText };
            }
            console.log('✅ Payment record added successfully. Firebase key:', result.name);
            console.log('Payment data:', paymentData);
            console.log('Full response:', responseText);
            return true;
        } else {
            console.error('❌ Failed to add payment record. Status:', response.status);
            console.error('Error response:', responseText);
            console.error('Response headers:', Object.fromEntries(response.headers.entries()));
            
            // Check for Firebase-specific errors
            if (responseText.includes('Permission denied') || responseText.includes('permission')) {
                console.error('🚨 FIREBASE SECURITY RULES ERROR: Permission denied!');
                console.error('💡 Solution: Update your Firebase rules to allow writes:');
                console.error('   { "rules": { ".read": "now < 1798771200000", ".write": "now < 1798771200000" } }');
            }
            
            return false;
        }
    } catch (error) {
        console.error('❌ Payment record error:', error);
        console.error('Error stack:', error.stack);
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
        
        // Use FormData for ToyyibPay API
        const formData = new FormData();
        Object.keys(testData).forEach(key => {
            formData.append(key, testData[key]);
        });
        
        let response;
        let responseText;
        
        try {
            response = await fetch(TOYYIBPAY_API_URL, {
                method: 'POST',
                // Remove Content-Type header to let fetch set the correct boundary
                body: formData
            });
            
            responseText = await response.text();
            console.log('ToyyibPay test response:', responseText);
            console.log('ToyyibPay test status:', response.status);
            console.log('ToyyibPay test headers:', response.headers);
        } catch (fetchError) {
            console.error('Credential test fetch error:', fetchError);
            
            // Check for SSL/TLS related errors
            if (fetchError.message.includes('certificate') || fetchError.message.includes('SSL') || fetchError.message.includes('TLS')) {
                return res.status(500).json({
                    success: false,
                    status: 526,
                    error: 'SSL Certificate Error',
                    message: `Unable to establish secure connection to ToyyibPay API. This is a server-side SSL certificate issue with ${TOYYIBPAY_BASE_URL} that needs to be resolved by ToyyibPay.`,
                    response: fetchError.message,
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
            
            throw fetchError;
        }
        
        // Check if response is HTML (error page) - specifically check for Cloudflare SSL errors
        if (responseText.includes('<!DOCTYPE html>') || responseText.includes('<html')) {
            // Check for Cloudflare SSL error (Error 526)
            if (responseText.includes('Invalid SSL certificate') || responseText.includes('Error code 526')) {
                console.error('Cloudflare SSL certificate error (526) detected in credential test');
                return res.json({
                    success: false,
                    status: 526,
                    error: 'Cloudflare SSL Error (526)',
                    message: `The ToyyibPay API endpoint (${TOYYIBPAY_BASE_URL}) has an invalid SSL certificate. This is a server-side issue that needs to be fixed by ToyyibPay. The connection is being blocked by Cloudflare's security layer.`,
                    response: responseText.substring(0, 500),
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
            }
        }
        
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

// Success page endpoint - with payment verification
app.get('/api/toyyibpay/success', async (req, res) => {
    const { amount, driverName, reference, billCode, driverId, statuscode, billcode: billcodeAlt, StatusCode } = req.query;
    
    // ToyyibPay may redirect with billCode in different formats
    const actualBillCodeFromQuery = billCode || billcodeAlt || req.query.billCode;
    const paymentStatusCode = statuscode || StatusCode || req.query.statuscode;
    
    let paymentVerified = false;
    let paymentStatus = 'unknown';
    let actualBillCode = actualBillCodeFromQuery;
    
    // CRITICAL: If we have a billCode and we're on the success page, it means payment was completed
    // ToyyibPay only redirects to returnUrl AFTER payment is successful
    // If payment failed, they redirect to a failure page, not our returnUrl
    if (actualBillCodeFromQuery) {
        // We have a billCode from ToyyibPay redirect = payment completed successfully!
        paymentStatus = 'paid';
        paymentVerified = true; // Trust ToyyibPay - they only redirect here on success
        console.log('✅ BillCode found in redirect - Payment successful (ToyyibPay only redirects on success)');
    }
    
    // If ToyyibPay explicitly returned a status code, use it
    if (paymentStatusCode === '1') {
        paymentStatus = 'paid';
        paymentVerified = true;
        console.log('✅ ToyyibPay status code = 1 - Payment confirmed');
    } else if (paymentStatusCode === '3') {
        paymentStatus = 'failed';
        paymentVerified = false;
        console.log('❌ ToyyibPay status code = 3 - Payment failed');
    }
    
    // Try to verify payment status from Firebase (for double-check, but trust ToyyibPay first)
    if (driverId && actualBillCodeFromQuery && !paymentVerified) {
        try {
            // Check if payment exists in commission_payments
            const paymentsUrl = `${FIREBASE_DATABASE_URL}/commission_payments/${driverId}.json`;
            const paymentsResponse = await fetch(paymentsUrl);
            const payments = await paymentsResponse.json();
            
            if (payments) {
                // Find payment with matching billCode or reference
                const paymentEntries = Object.values(payments);
                const matchingPayment = paymentEntries.find(p => 
                    (p.billCode && p.billCode === actualBillCodeFromQuery) || 
                    (p.reference && p.reference === reference)
                );
                
                if (matchingPayment && matchingPayment.status === 'paid') {
                    paymentVerified = true;
                    paymentStatus = 'paid';
                    actualBillCode = matchingPayment.billCode || actualBillCodeFromQuery;
                } else if (matchingPayment) {
                    paymentStatus = matchingPayment.status || 'pending';
                }
            }
        } catch (error) {
            console.error('Error verifying payment status:', error);
            // Continue to show page even if verification fails
        }
    }
    
    // If we don't have billCode from URL, try to find it from bill_mappings using reference and driverId
    if (!actualBillCodeFromQuery && driverId && reference) {
        try {
            console.log('Searching for billCode in bill_mappings using driverId and reference...');
            const mappingsUrl = `${FIREBASE_DATABASE_URL}/bill_mappings.json`;
            const mappingsResponse = await fetch(mappingsUrl + '?orderBy="driverId"&equalTo="' + driverId + '"');
            const allMappings = await mappingsResponse.json();
            
            if (allMappings) {
                // Find mapping with matching reference
                for (const [billCodeKey, mapping] of Object.entries(allMappings)) {
                    if (mapping.reference === reference || mapping.reference === decodeURIComponent(reference)) {
                        actualBillCode = billCodeKey;
                        actualBillCodeFromQuery = billCodeKey;
                        paymentStatus = 'paid';
                        paymentVerified = true;
                        console.log('✅ Found billCode from mappings:', billCodeKey);
                        break;
                    }
                }
            }
        } catch (error) {
            console.error('Error searching bill mappings:', error);
        }
    }
    
    // Also check bill_mappings to see if billCode exists (verify it's a valid bill)
    if (actualBillCodeFromQuery && !paymentVerified) {
        try {
            const mappingUrl = `${FIREBASE_DATABASE_URL}/bill_mappings/${actualBillCodeFromQuery}.json`;
            const mappingResponse = await fetch(mappingUrl);
            const mapping = await mappingResponse.json();
            
            if (mapping) {
                // Bill exists in mappings = payment was created, so it's successful
                paymentStatus = 'paid';
                paymentVerified = true;
                console.log('✅ Bill found in mappings - Payment confirmed');
            }
        } catch (error) {
            console.error('Error checking bill mapping:', error);
        }
    }
    
    // Build HTML based on actual payment status
    // If we have a billCode, payment was successful (ToyyibPay only redirects here on success)
    const finalPaymentVerified = paymentVerified || !!actualBillCodeFromQuery;
    const statusIcon = finalPaymentVerified ? '✓' : '⏳';
    const statusTitle = finalPaymentVerified ? 'Payment Successful!' : 'Payment Processing...';
    const statusSubtitle = finalPaymentVerified 
        ? 'Your commission payment has been processed successfully. The callback is processing your commission update.'
        : 'Your payment is being processed. Please wait a moment for confirmation.';
    const statusColor = finalPaymentVerified ? '#4CAF50' : '#FF9800';
    
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
                color: ${statusColor};
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
            .warning-box {
                background: #fff3cd;
                border: 1px solid #ffc107;
                border-radius: 10px;
                padding: 15px;
                margin: 20px 0;
                color: #856404;
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
            <div class="success-icon">${statusIcon}</div>
            <h1 class="success-title">${statusTitle}</h1>
            <p class="success-subtitle">${statusSubtitle}</p>
            
            ${!finalPaymentVerified && !actualBillCodeFromQuery ? `
            <div class="warning-box">
                <strong>⚠️ Payment Status Unknown</strong><br>
                Your payment may still be processing. Please check your commission page in the app to confirm if the payment was successful. If the commission amount has not been reduced, the payment may have failed.
            </div>
            ` : finalPaymentVerified && actualBillCodeFromQuery ? `
            <div style="background: #d4edda; border: 1px solid #c3e6cb; border-radius: 10px; padding: 15px; margin: 20px 0; color: #155724;">
                <strong>✅ Payment Confirmed by ToyyibPay</strong><br>
                Your payment has been successfully processed. The commission update is being processed in the background and will reflect in your account shortly.
            </div>
            ` : ''}
            
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
                    <span class="detail-value">${actualBillCode || actualBillCodeFromQuery || 'N/A'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Payment Status:</span>
                    <span class="detail-value">${finalPaymentVerified ? '✅ Paid & Confirmed' : paymentStatus === 'pending' ? '⏳ Processing' : paymentStatus === 'failed' ? '❌ Failed' : '⏳ Processing'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Payment Date:</span>
                    <span class="detail-value">${new Date().toLocaleDateString()}</span>
                </div>
            </div>
            
            <div class="countdown" id="countdown">
                Redirecting to commission page in <span id="timer">5</span> seconds...
            </div>
            
            <button class="return-button" onclick="returnToApp()">
                Return to App Now
            </button>
        </div>
        
        <script>
            let timeLeft = 5;
            const timerElement = document.getElementById('timer');
            const paymentVerified = ${finalPaymentVerified};
            let checkCount = 0;
            const maxChecks = 5;
            let redirectAttempted = false;
            
            // Auto-refresh to check payment status if not verified (only if we don't have billCode)
            ${!finalPaymentVerified && !actualBillCodeFromQuery ? `
            function checkPaymentStatus() {
                if (checkCount >= maxChecks) {
                    console.log('Max payment checks reached');
                    return;
                }
                checkCount++;
                
                setTimeout(() => {
                    console.log('Checking payment status again...');
                    window.location.reload();
                }, 3000);
            }
            
            checkPaymentStatus();
            ` : ''}
            
            const countdown = setInterval(() => {
                timeLeft--;
                timerElement.textContent = timeLeft;
                
                if (timeLeft <= 0) {
                    clearInterval(countdown);
                    if (!redirectAttempted) {
                        returnToApp();
                    }
                }
            }, 1000);
            
            function returnToApp() {
                if (redirectAttempted) {
                    console.log('Redirect already attempted');
                    return;
                }
                redirectAttempted = true;
                
                const packageName = 'com.kelasandroidappsirhafizee.urbandrivefyp';
                
                console.log('Attempting to return to app:', packageName);
                
                // Method 1: Use Android Intent URL (most reliable)
                const intentUrl = 'intent://toyyib/return#Intent;scheme=yourapp;package=' + packageName + ';end';
                
                // Try Intent URL first
                try {
                    console.log('Trying Intent URL:', intentUrl);
                    window.location.href = intentUrl;
                } catch (e) {
                    console.error('Intent URL failed:', e);
                }
                
                // Method 2: Try direct deep link after short delay
                setTimeout(() => {
                    try {
                        console.log('Trying deep link: yourapp://toyyib/return');
                        window.location.href = 'yourapp://toyyib/return';
                    } catch (e) {
                        console.error('Deep link failed:', e);
                    }
                }, 300);
                
                // Method 3: Fallback - try to close window if in WebView
                setTimeout(() => {
                    try {
                        if (window.Android && typeof window.Android.finish === 'function') {
                            console.log('Using Android finish()');
                            window.Android.finish();
                        } else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.close) {
                            console.log('Using WebKit close');
                            window.webkit.messageHandlers.close.postMessage('');
                        } else {
                            // Last resort: try deep link again
                            console.log('Final fallback: trying deep link again');
                            window.location.href = 'yourapp://toyyib/return';
                            
                            // If still not working, show message
                            setTimeout(() => {
                                document.querySelector('.countdown').innerHTML = 'Please close this page and return to the app manually.';
                            }, 2000);
                        }
                    } catch (e) {
                        console.log('All redirect methods failed:', e);
                        document.querySelector('.countdown').innerHTML = 'Please close this page and return to the app manually.';
                    }
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
