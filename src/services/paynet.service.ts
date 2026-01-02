import axios from 'axios';
import * as crypto from 'crypto';
import { Pool } from 'pg';
import { AuthService } from './auth.service';

const PAYNET_IS_PRODUCTION = process.env.PAYNETEASY_ENABLE_PRODUCTION === 'true';
const PAYNET_EASY_URL = process.env.PAYNETEASY_API_URL || 'https://gate.payneteasy.com/paynet/api/v2';
const PAYNET_PRODUCTION_URL = 'https://api.paynet.com.tr/v2';
const PAYNET_API_URL = PAYNET_IS_PRODUCTION ? PAYNET_PRODUCTION_URL : PAYNET_EASY_URL;
const PAYNET_SECRET_KEY = process.env.PAYNETEASY_SECRET_KEY || 'sck_5shZWwD-jVQ0r9DuyF8ZmEWkz3vz';
const PAYNET_PUBLISHABLE_KEY = process.env.PAYNETEASY_PUBLIC_KEY || 'pbk_SyS8x3O5SPLbL8XvPM91ZIxocMT7';
const PAYNET_JS_URL = 'https://pj.paynet.com.tr/public/js/paynet.min.js';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export class PaynetService {

    /**
     * Paynet ile ödeme başlatma (3D Secure olmadan direkt ödeme)
     */
    static async createPaymentLink(params: {
        amount: number;
        referenceCode: string;
        email: string;
        name: string;
        description?: string;
        planId?: string;
    }) {
        const secretKey = PAYNET_SECRET_KEY;

        try {
            console.log('=== PAYNET PAYMENT LINK START ===');
            console.log('API URL:', PAYNET_API_URL);
            console.log('Secret Key:', secretKey.substring(0, 20) + '...');
            console.log('Amount (kuruş):', params.amount);
            console.log('Amount (TL):', (params.amount / 100).toFixed(2));

            const paymentData = {
                amount: (params.amount / 100).toFixed(2),
                reference_no: params.referenceCode,
                domain: 'aioasistan.com',
                card_holder: params.name,
                description: params.description || `AIO Asistan Plan Ödemesi - ${params.planId}`
            };

            console.log('Payment Data:', JSON.stringify(paymentData, null, 2));

            const authHeader = 'Basic ' + Buffer.from(secretKey).toString('base64');

            const response = await axios.post(
                `${PAYNET_API_URL}/transaction/payment`,
                paymentData,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': authHeader
                    },
                    timeout: 30000
                }
            );

            console.log('Paynet Response Status:', response.status);
            console.log('Paynet Response Data:', response.data);
            console.log('=== PAYNET PAYMENT LINK END ===');

            if (response.status === 200) {
                const responseData = response.data as any;
                const { id, xact_id } = responseData;

                return {
                    success: true,
                    url: `https://aioasistan.com/payment/success?xact_id=${xact_id}`,
                    paymentId: id,
                    xactId: xact_id,
                    referenceCode: params.referenceCode,
                    paynetJsUrl: PAYNET_JS_URL
                };
            }

            throw new Error('Beklenmeyen Paynet yanıtı');

        } catch (error: any) {
            console.error('=== PAYNET CATCH START ===');
            console.error('Error Message:', error.message);
            console.error('Error Code:', error.code);
            console.error('Response Status:', error.response?.status);
            console.error('Response Data:', error.response?.data);
            console.error('=== PAYNET CATCH END ===');

            if (process.env.NODE_ENV === 'production') {
                throw new Error(error.response?.data?.message || error.message || 'Ödeme başlatılamadı');
            }

            console.log('Mock payment link döndürülüyor (dev mode)');
            return this.getMockPaymentLink(params.referenceCode);
        }
    }

    /**
     * Paynet Webhook Handler (Ödeme onayı)
     */
    static async handleWebhook(webhookData: any) {
        try {
            console.log('=== PAYNET WEBHOOK RECEIVED ===');
            console.log('Webhook Data:', JSON.stringify(webhookData, null, 2));

            const {
                is_succeed,
                reference_no,
                email,
                card_holder,
                transaction_type
            } = webhookData;

            if (is_succeed === true || is_succeed === 'true') {
                console.log(`Ödeme başarılı: ${email}, Ref: ${reference_no}`);

                const tenant = await AuthService.createTenantFromPayment({
                    email,
                    name: card_holder || email.split('@')[0],
                    reference_no
                });

                console.log(`Tenant oluşturuldu: ${tenant.slug}, ID: ${tenant.tenantId}`);

                const phoneNumber = '+905550001122';
                const twilioSid = 'mock_sid_' + Date.now();

                await pool.query(
                    'UPDATE agents SET twilio_phone_number = $1, twilio_sid = $2 WHERE tenant_id = $3',
                    [phoneNumber, twilioSid, tenant.tenantId]
                );

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
                    tenantSlug: tenant.slug
                };
            } else {
                console.log(`Ödeme başarısız: ${email}, Status: ${is_succeed}`);
                return {
                    success: false,
                    message: `Ödeme başarısız. Durum: ${is_succeed}`
                };
            }

        } catch (error: any) {
            console.error('Webhook Error:', error.message);
            throw error;
        }
    }

    /**
     * Eski metodlar - geriye uyumluluk için
     */
    static async createSession(amount: number, referenceCode: string, email: string, name: string) {
        return this.createPaymentLink({
            amount,
            referenceCode,
            email,
            name
        });
    }

    /**
     * Check Paynet connection and credentials
     * Based on: https://doc.paynet.com.tr/oedeme-metotlari/api-entegrasyonu/odeme
     */
    static async checkConnection() {
        try {
            console.log('=== PAYNET CONNECTION CHECK START ===');
            console.log('API URL:', PAYNET_API_URL);
            console.log('Secret Key:', PAYNET_SECRET_KEY.substring(0, 15) + '...');
            console.log('Publishable Key:', PAYNET_PUBLISHABLE_KEY.substring(0, 15) + '...');
            console.log('Is Production:', PAYNET_IS_PRODUCTION);

            const authHeader = 'Basic ' + Buffer.from(PAYNET_SECRET_KEY).toString('base64');

            console.log('Auth Header (first 20 chars):', authHeader.substring(0, 20) + '...');

            const testUrl = `${PAYNET_API_URL}/transaction/payment`;

            console.log('Testing URL:', testUrl);

            const testData = {
                amount: '0.01',
                reference_no: 'TEST-' + Date.now(),
                domain: 'aioasistan.com',
                card_holder: 'CONNECTION TEST',
                pan: '0000000000000',
                month: new Date().getMonth() + 1,
                year: new Date().getFullYear(),
                description: 'Connection test for AIO Asistan'
            };

            console.log('Test Data:', JSON.stringify(testData, null, 2));

            const response = await axios.post(testUrl, testData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': authHeader
                },
                timeout: 30000
            });

            console.log('Paynet Response Status:', response.status);
            console.log('Paynet Response Data:', JSON.stringify(response.data, null, 2));
            console.log('=== PAYNET CONNECTION CHECK END ===');

            return {
                success: response.status === 200,
                data: response.data,
                statusCode: response.status
            };

        } catch (error: any) {
            console.error('=== PAYNET CONNECTION ERROR ===');
            console.error('Error Message:', error.message);
            console.error('Error Code:', error.code);

            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Status Text:', error.response.statusText);
                console.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
                console.error('Response Data:', typeof error.response.data === 'string' ? error.response.data.substring(0, 500) : error.response.data);
            } else if (error.request) {
                console.error('No response received');
            }

            return {
                success: false,
                error: error.message,
                responseStatus: error.response?.status,
                responseData: error.response?.data
            };
        }
    }

    /**
     * Mock payment link (test için)
     */
    private static getMockPaymentLink(referenceCode: string) {
        return {
            success: true,
            url: `https://aioasistan.com/payment/success?mock=true&ref=${referenceCode}`,
            paymentId: `mock-session-${Date.now()}`,
            referenceCode: referenceCode,
            mock: true
        } as any;
    }
}
