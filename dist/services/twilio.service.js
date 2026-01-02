"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwilioService = void 0;
const twilio_1 = __importDefault(require("twilio"));
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
// Eğer env yoksa mock modunda çalışır
const client = (accountSid && authToken) ? (0, twilio_1.default)(accountSid, authToken) : null;
class TwilioService {
    /**
     * +90 Numarası arar ve satın alır
     * @param tenantSlug Müşteri kimliği (Friendly name için)
     */
    static async buyPhoneNumber(tenantSlug) {
        if (!client) {
            console.warn('Twilio credentials missing. Mocking purchase.');
            return { phoneNumber: '+905550001122', sid: 'mock_sid_' + Date.now() };
        }
        try {
            // 1. Türkiye numarası ara (Voice özellikli)
            const availableNumbers = await client.availablePhoneNumbers('TR')
                .local.list({ voiceEnabled: true, limit: 1 });
            if (availableNumbers.length === 0) {
                throw new Error('Uygun numara bulunamadı.');
            }
            const numberToBuy = availableNumbers[0];
            // 2. Numarayı satın al
            const purchasedNumber = await client.incomingPhoneNumbers.create({
                phoneNumber: numberToBuy.phoneNumber,
                friendlyName: `AIO-${tenantSlug}`,
                // Ses Webhook'unu n8n'e bağla (Örn: Çağrı gelince buraya at)
                voiceUrl: 'https://n8n.aioasistan.com/webhook/twilio-voice',
                voiceMethod: 'POST'
            });
            return {
                phoneNumber: purchasedNumber.phoneNumber,
                sid: purchasedNumber.sid
            };
        }
        catch (error) {
            console.error('Twilio Error:', error);
            throw new Error('Numara satın alınamadı: ' + error.message);
        }
    }
}
exports.TwilioService = TwilioService;
