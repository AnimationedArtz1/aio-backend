"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaynetService = void 0;
const axios_1 = __importDefault(require("axios"));
const pg_1 = require("pg");
const auth_service_1 = require("./auth.service");
// Paynet Configuration
const PAYNET_IS_PRODUCTION = process.env.PAYNETEASY_ENABLE_PRODUCTION === 'true';
const PAYNET_PRODUCTION_URL = 'https://api.paynet.com.tr/v2';
const PAYNET_SANDBOX_URL = 'https://pts-api.paynet.com.tr/v2'; // Sandbox URL
const PAYNET_API_URL = PAYNET_IS_PRODUCTION ? PAYNET_PRODUCTION_URL : PAYNET_SANDBOX_URL;
// Secret key - Paynet uses "sck_xxx" format
const PAYNET_SECRET_KEY = process.env.PAYNETEASY_SECRET_KEY || '';
const PAYNET_PUBLISHABLE_KEY = process.env.PAYNETEASY_PUBLIC_KEY || '';
const PAYNET_ENDPOINT_ID = process.env.PAYNETEASY_ENDPOINT_ID || '';
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
class PaynetService {
    /**
     * Generate proper Authorization header for Paynet
     * Paynet expects: Authorization: Basic base64(secret_key:)
     * Note: The colon after the key is important!
     */
    static getAuthHeader() {
        // Paynet Basic Auth format: base64(secret_key:)
        // The colon at the end is required even with no password
        const credentials = `${PAYNET_SECRET_KEY}:`;
        const base64Credentials = Buffer.from(credentials).toString('base64');
        return `Basic ${base64Credentials}`;
    }
    /**
     * Create a payment link/session with Paynet
     */
    static async createPaymentLink(params) {
        try {
            console.log('=== PAYNET PAYMENT LINK START ===');
            console.log('API URL:', PAYNET_API_URL);
            console.log('Is Production:', PAYNET_IS_PRODUCTION);
            console.log('Endpoint ID:', PAYNET_ENDPOINT_ID);
            console.log('Secret Key (first 15 chars):', PAYNET_SECRET_KEY.substring(0, 15) + '...');
            console.log('Amount (kuruş):', params.amount);
            console.log('Amount (TL):', (params.amount / 100).toFixed(2));
            const authHeader = this.getAuthHeader();
            console.log('Auth Header (first 30 chars):', authHeader.substring(0, 30) + '...');
            // Paynet payment request body
            const paymentData = {
                amount: (params.amount / 100).toFixed(2), // Convert kuruş to TL
                reference_no: params.referenceCode,
                domain: 'aioasistan.com',
                card_holder_email: params.email,
                card_holder: params.name,
                description: params.description || `AIO Asistan Plan Ödemesi - ${params.planId || 'standard'}`,
                // Optional: Add callback URLs
                callback_url: 'https://api.aioasistan.com/api/paynet/callback',
                success_url: 'https://aioasistan.com/payment/success',
                fail_url: 'https://aioasistan.com/payment/fail'
            };
            console.log('Payment Data:', JSON.stringify(paymentData, null, 2));
            const response = await axios_1.default.post(`${PAYNET_API_URL}/transaction/payment`, paymentData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': authHeader
                },
                timeout: 30000
            });
            console.log('Paynet Response Status:', response.status);
            console.log('Paynet Response Data:', JSON.stringify(response.data, null, 2));
            console.log('=== PAYNET PAYMENT LINK END ===');
            const responseData = response.data;
            return {
                success: true,
                url: responseData.redirect_url || responseData.payment_url || `https://aioasistan.com/payment/process?xact_id=${responseData.xact_id}`,
                paymentId: responseData.id,
                xactId: responseData.xact_id,
                sessionId: responseData.session_id || responseData.xact_id,
                referenceCode: params.referenceCode,
                raw_response: responseData
            };
        }
        catch (error) {
            console.error('=== PAYNET ERROR ===');
            console.error('Error Message:', error.message);
            console.error('Error Code:', error.code);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Status Text:', error.response.statusText);
                console.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
                console.error('Response Data:', error.response.data);
                // Log specific auth errors
                if (error.response.status === 401) {
                    console.error('AUTHENTICATION ERROR: Check your secret key format');
                    console.error('Expected format: sck_xxxxxxxxx');
                    console.error('Make sure the key is correctly set in PAYNETEASY_SECRET_KEY env var');
                }
            }
            // In development, return mock data
            if (process.env.NODE_ENV !== 'production') {
                console.log('Returning mock payment link (dev mode)');
                return this.getMockPaymentLink(params.referenceCode);
            }
            throw new Error(error.response?.data?.message || error.message || 'Ödeme başlatılamadı');
        }
    }
    /**
     * Alternative: Create payment with iframe/hosted form
     */
    static async createHostedPayment(params) {
        try {
            console.log('=== PAYNET HOSTED PAYMENT START ===');
            const authHeader = this.getAuthHeader();
            const paymentData = {
                amount: (params.amount / 100).toFixed(2),
                reference_no: params.referenceCode,
                card_holder_email: params.email,
                card_holder: params.name,
                domain: 'aioasistan.com',
                is_3d: true, // Force 3D Secure
                callback_url: 'https://api.aioasistan.com/api/paynet/callback'
            };
            const response = await axios_1.default.post(`${PAYNET_API_URL}/transaction/hosted-payment`, paymentData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': authHeader
                },
                timeout: 30000
            });
            console.log('Hosted Payment Response:', response.data);
            return {
                success: true,
                iframeUrl: response.data.iframe_url,
                redirectUrl: response.data.redirect_url,
                xactId: response.data.xact_id
            };
        }
        catch (error) {
            console.error('Hosted Payment Error:', error.message);
            if (error.response) {
                console.error('Response:', error.response.data);
            }
            throw error;
        }
    }
    /**
     * Handle Paynet webhook callback
     */
    static async handleWebhook(webhookData) {
        try {
            console.log('=== PAYNET WEBHOOK RECEIVED ===');
            console.log('Webhook Data:', JSON.stringify(webhookData, null, 2));
            const { is_succeed, reference_no, email, card_holder, transaction_type, amount, xact_id } = webhookData;
            if (is_succeed === true || is_succeed === 'true' || is_succeed === 1 || is_succeed === '1') {
                console.log(`Ödeme başarılı: ${email}, Ref: ${reference_no}, Amount: ${amount}`);
                const tenant = await auth_service_1.AuthService.createTenantFromPayment({
                    email,
                    name: card_holder || email.split('@')[0],
                    reference_no
                });
                console.log(`Tenant oluşturuldu: ${tenant.slug}, ID: ${tenant.tenantId}`);
                // Assign mock phone number (will be replaced by Verimor)
                const phoneNumber = '+905550001122';
                const twilioSid = 'mock_sid_' + Date.now();
                await pool.query('UPDATE agents SET twilio_phone_number = $1, twilio_sid = $2 WHERE tenant_id = $3', [phoneNumber, twilioSid, tenant.tenantId]);
                console.log('========================================');
                console.log('YENİ MÜŞTERİ KAYDI TAMAMLANDI');
                console.log(`Email: ${email}`);
                console.log(`Geçici Şifre: ${tenant.tempPassword}`);
                console.log(`Telefon Numarası: ${phoneNumber}`);
                console.log(`Tenant Slug: ${tenant.slug}`);
                console.log('========================================');
                return {
                    success: true,
                    message: 'Ödeme işlendi, hesap oluşturuldu',
                    tenantSlug: tenant.slug,
                    xactId: xact_id
                };
            }
            else {
                console.log(`Ödeme başarısız: ${email}, Status: ${is_succeed}`);
                return {
                    success: false,
                    message: `Ödeme başarısız. Durum: ${is_succeed}`
                };
            }
        }
        catch (error) {
            console.error('Webhook Error:', error.message);
            throw error;
        }
    }
    /**
     * Check Paynet connection and credentials
     */
    static async checkConnection() {
        try {
            console.log('=== PAYNET CONNECTION CHECK START ===');
            console.log('API URL:', PAYNET_API_URL);
            console.log('Is Production:', PAYNET_IS_PRODUCTION);
            console.log('Secret Key (first 15 chars):', PAYNET_SECRET_KEY.substring(0, 15) + '...');
            console.log('Publishable Key (first 15 chars):', PAYNET_PUBLISHABLE_KEY.substring(0, 15) + '...');
            const authHeader = this.getAuthHeader();
            console.log('Auth Header format check:');
            console.log('  - Starts with "Basic ": ', authHeader.startsWith('Basic '));
            console.log('  - Header length:', authHeader.length);
            // Try a minimal request to check auth
            // Using an endpoint that should return 400 for invalid data but 401 for bad auth
            const testData = {
                amount: '0.01',
                reference_no: 'CONNECTION-TEST-' + Date.now(),
                domain: 'aioasistan.com',
                card_holder: 'TEST USER',
                description: 'Connection test'
            };
            console.log('Sending test request...');
            const response = await axios_1.default.post(`${PAYNET_API_URL}/transaction/payment`, testData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': authHeader
                },
                timeout: 30000,
                validateStatus: (status) => status < 500 // Accept 4xx as valid responses
            });
            console.log('Response Status:', response.status);
            console.log('Response Data:', JSON.stringify(response.data, null, 2));
            console.log('=== PAYNET CONNECTION CHECK END ===');
            // 401 = auth problem, 400/422 = auth OK but data invalid
            if (response.status === 401 || response.status === 403) {
                return {
                    success: false,
                    error: 'Authentication failed',
                    statusCode: response.status,
                    message: 'Check your PAYNETEASY_SECRET_KEY - it should be in format: sck_xxxxxxxx'
                };
            }
            return {
                success: true,
                message: 'Connection successful - credentials are valid',
                statusCode: response.status,
                data: response.data
            };
        }
        catch (error) {
            console.error('=== PAYNET CONNECTION ERROR ===');
            console.error('Error Message:', error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Response Data:', error.response.data);
                return {
                    success: false,
                    error: error.message,
                    statusCode: error.response.status,
                    responseData: error.response.data
                };
            }
            return {
                success: false,
                error: error.message,
                message: 'Network or connection error'
            };
        }
    }
    /**
     * Create session (legacy method for backward compatibility)
     */
    static async createSession(amount, referenceCode, email, name) {
        return this.createPaymentLink({
            amount,
            referenceCode,
            email,
            name
        });
    }
    /**
     * Mock payment link for development
     */
    static getMockPaymentLink(referenceCode) {
        console.log('=== GENERATING MOCK PAYMENT LINK ===');
        return {
            success: true,
            url: `https://aioasistan.com/payment/mock?ref=${referenceCode}`,
            paymentId: `mock-payment-${Date.now()}`,
            sessionId: `mock-session-${Date.now()}`,
            xactId: `mock-xact-${Date.now()}`,
            referenceCode: referenceCode,
            mock: true
        };
    }
}
exports.PaynetService = PaynetService;
