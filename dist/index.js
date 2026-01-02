"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const pg_1 = require("pg");
const auth_service_1 = require("./services/auth.service");
const paynet_service_1 = require("./services/paynet.service");
const twilio_service_1 = require("./services/twilio.service");
const agent_service_1 = require("./services/agent.service");
const user_service_1 = require("./services/user.service");
const verimor_service_1 = require("./services/verimor.service");
dotenv_1.default.config();
const app = (0, express_1.default)();
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'super_gizli_jwt_sifresi_bunu_degistir';
// Ensure public/audio directory exists
const AUDIO_DIR = path_1.default.join(__dirname, '..', 'public', 'audio');
if (!fs_1.default.existsSync(AUDIO_DIR)) {
    fs_1.default.mkdirSync(AUDIO_DIR, { recursive: true });
    console.log('Created audio directory:', AUDIO_DIR);
}
// Configure multer for audio file uploads
const audioStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        cb(null, AUDIO_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path_1.default.extname(file.originalname) || '.mp3';
        cb(null, `audio-${uniqueSuffix}${ext}`);
    }
});
const audioUpload = (0, multer_1.default)({
    storage: audioStorage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    },
    fileFilter: (req, file, cb) => {
        const allowedMimes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Invalid file type. Only audio files are allowed.'));
        }
    }
});
// CORS: Allow all origins
app.use((0, cors_1.default)({ origin: '*' }));
// Parse JSON bodies
app.use(express_1.default.json());
// Parse URL-encoded bodies (important for Verimor webhooks)
app.use(express_1.default.urlencoded({ extended: true }));
// Serve static files from public directory
app.use('/public', express_1.default.static(path_1.default.join(__dirname, '..', 'public')));
// Request Logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});
const apiRouter = express_1.default.Router();
// ============================================
// PUBLIC ROUTES (Auth gerektirmeyen)
// ============================================
// Login
apiRouter.post('/auth/login', async (req, res) => {
    try {
        console.log('Login Request:', req.body);
        const { email, password } = req.body;
        const result = await auth_service_1.AuthService.login(email, password);
        res.json(result);
    }
    catch (e) {
        console.error('Login Error:', e.message);
        res.status(401).json({ error: e.message });
    }
});
// Paynet - Ödeme oturumu oluştur
apiRouter.post('/paynet/create-session', async (req, res) => {
    try {
        const { amount, email, name, planId } = req.body;
        const referenceCode = 'ORDER-' + Date.now();
        // Plan bilgisini referans koduna ekle
        const fullRef = planId ? `${referenceCode}-${planId}` : referenceCode;
        const result = await paynet_service_1.PaynetService.createPaymentLink({ amount, referenceCode: fullRef, email, name });
        res.json({
            success: true,
            url: result.url,
            referenceCode: fullRef,
            sessionId: result.sessionId
        });
    }
    catch (e) {
        console.error('Paynet Create Session Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// Public Signup - Frontend'in beklediği endpoint (Verimor numarası ile signup)
apiRouter.post('/public/signup', async (req, res) => {
    try {
        const { businessName, contactEmail, websiteUrl, industry, planId } = req.body;
        console.log('Public Signup Request:', { businessName, contactEmail, planId });
        // AuthService.signupFromForm metodunu çağır - Verimor numarası otomatik atanır
        const result = await auth_service_1.AuthService.signupFromForm({
            businessName,
            contactEmail,
            websiteUrl,
            industry,
            planId
        });
        console.log('Signup Result:', result);
        res.json(result);
    }
    catch (e) {
        console.error('Public Signup Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// Billing Checkout - Frontend'in beklediği endpoint
apiRouter.post('/billing/checkout', async (req, res) => {
    try {
        const { planId } = req.body;
        console.log('Billing Checkout Request:', planId);
        // Plan fiyatlarını belirle
        const planPrices = {
            'starter': 4900,
            'pro': 24900,
            'enterprise': 199900
        };
        const amount = planPrices[planId] || 4900;
        const referenceCode = 'ORDER-' + Date.now() + '-' + planId;
        const result = await paynet_service_1.PaynetService.createPaymentLink({
            amount,
            referenceCode,
            email: 'checkout@aioasistan.com',
            name: planId.toUpperCase() + ' Plan'
        });
        res.json({
            redirectUrl: result.url,
            checkoutUrl: result.url,
            sessionId: result.sessionId
        });
    }
    catch (e) {
        console.error('Billing Checkout Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// Paynet Webhook - Ödeme sonucu callback
apiRouter.post('/paynet/callback', async (req, res) => {
    try {
        console.log('Paynet Callback Received:', req.body);
        const { status, reference_no, email, name_surname, amount, transaction_id } = req.body;
        if (status === '1' || status === 'success' || status === 1) {
            // Ödeme başarılı
            console.log(`Ödeme başarılı: ${email}, Ref: ${reference_no}`);
            // 1. Tenant oluştur
            const tenant = await auth_service_1.AuthService.createTenantFromPayment({
                email,
                name: name_surname || email.split('@')[0],
                reference_no
            });
            console.log(`Tenant oluşturuldu: ${tenant.slug}, ID: ${tenant.tenantId}`);
            // 2. Agent'ı bul (Tenant oluşturulurken varsayılan agent oluşturuluyor)
            const agentResult = await pool.query('SELECT id FROM agents WHERE tenant_id = $1 LIMIT 1', [tenant.tenantId]);
            if (agentResult.rows.length === 0) {
                throw new Error('Tenant oluşturuldu ancak agent bulunamadı');
            }
            const agentId = agentResult.rows[0].id;
            console.log(`Agent ID bulundu: ${agentId}`);
            // 3. Verimor havuzundan numara ata (YENİ OTOMASYON)
            let phoneNumber = null;
            let assignmentType = 'none';
            try {
                const verimorAssignment = await verimor_service_1.VerimorService.assignNumberToTenant(tenant.tenantId, agentId);
                phoneNumber = verimorAssignment.didNumber;
                assignmentType = 'verimor';
                console.log(`Verimor numarası atandı: ${phoneNumber}`);
            }
            catch (verimorErr) {
                console.error('Verimor numarası atanamadı:', verimorErr.message);
                // Verimor havuzunda numara yoksa Twilio'a fallback yap
                console.log('Twilio fallback başlatılıyor...');
                try {
                    const phone = await twilio_service_1.TwilioService.buyPhoneNumber(tenant.slug);
                    phoneNumber = phone.phoneNumber;
                    assignmentType = 'twilio';
                    await pool.query('UPDATE agents SET twilio_phone_number = $1, twilio_sid = $2 WHERE tenant_id = $3', [phone.phoneNumber, phone.sid, tenant.tenantId]);
                    console.log(`Twilio numarası atandı: ${phone.phoneNumber}`);
                }
                catch (twilioErr) {
                    console.error('Twilio numara alınamadı (mock kullanılacak):', twilioErr.message);
                    phoneNumber = '+905550001122';
                    assignmentType = 'mock';
                    await pool.query('UPDATE agents SET twilio_phone_number = $1 WHERE tenant_id = $2', [phoneNumber, tenant.tenantId]);
                }
            }
            // 4. Log (Email servisi eklenince burası değişecek)
            console.log('========================================');
            console.log('YENİ MÜŞTERİ KAYDI TAMAMLANDI');
            console.log(`Email: ${email}`);
            console.log(`Geçici Şifre: ${tenant.tempPassword}`);
            console.log(`Telefon Numarası: ${phoneNumber}`);
            console.log(`Numara Kaynağı: ${assignmentType}`);
            console.log(`Tenant Slug: ${tenant.slug}`);
            console.log('========================================');
            res.json({
                success: true,
                message: 'Ödeme işlendi, hesap oluşturuldu',
                tenantSlug: tenant.slug,
                phoneNumber: phoneNumber,
                assignmentType: assignmentType
            });
        }
        else {
            // Ödeme başarısız
            console.log(`Ödeme başarısız: ${email}, Status: ${status}`);
            res.json({ success: false, message: 'Ödeme başarısız' });
        }
    }
    catch (e) {
        console.error('Paynet Callback Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// Verimor Call Integration - For n8n triggering
apiRouter.post('/integrations/verimor/call', async (req, res) => {
    try {
        const { target_number } = req.body;
        if (!target_number) {
            return res.status(400).json({ error: 'target_number is required' });
        }
        const DEMO_EXTENSION = '902422555761';
        console.log('=== VERIMOR CALL REQUEST ===');
        console.log('Extension (Source):', DEMO_EXTENSION);
        console.log('Destination (Target):', target_number);
        const result = await verimor_service_1.VerimorService.makeCall(DEMO_EXTENSION, target_number);
        if (result.success) {
            res.json({
                success: true,
                message: 'Call initiated',
                data: result.data
            });
        }
        else {
            res.status(500).json({
                success: false,
                message: result.message
            });
        }
    }
    catch (error) {
        console.error('Verimor Call Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// Verimor Incoming Call Webhook - For Verimor Panel
apiRouter.get('/verimor/incoming-call', async (req, res) => {
    try {
        const data = req.query;
        console.log('=== VERIMOR INCOMING CALL WEBHOOK (GET) ===');
        console.log('Data:', JSON.stringify(data, null, 2));
        console.log('UUID:', data.uuid);
        console.log('CLI (Caller ID):', data.cli);
        console.log('CLD (Target/Extension):', data.cld);
        console.log('Step:', data.step);
        return res.status(200).json({
            success: true,
            action: 'continue'
        });
    }
    catch (error) {
        console.error('Verimor Webhook Error:', error.message);
        return res.status(200).json({
            success: true,
            action: 'continue'
        });
    }
});
apiRouter.post('/verimor/incoming-call', async (req, res) => {
    try {
        const data = req.body || {};
        console.log('=== VERIMOR INCOMING CALL WEBHOOK (POST) ===');
        console.log('Data:', JSON.stringify(data, null, 2));
        console.log('UUID:', data.uuid);
        console.log('CLI (Caller ID):', data.cli);
        console.log('CLD (Target/Extension):', data.cld);
        console.log('Step:', data.step);
        return res.status(200).json({
            success: true,
            transfer: {
                target: 'hangup/busy'
            }
        });
    }
    catch (error) {
        console.error('Verimor Webhook Error:', error.message);
        return res.status(200).json({
            success: true,
            transfer: {
                target: 'hangup/busy'
            }
        });
    }
});
// ============================================
// DIAGNOSTIC: Print All Routes on Startup
// ============================================
apiRouter.stack.forEach((layer) => {
    if (layer.route && layer.methods) {
        const methods = layer.methods.join(',');
        console.log(`[ROUTE] ${methods} /api${layer.route}`);
    }
});
console.log('[ROUTE] apiRouter mounted on /api');
// ============================================
// VERIMOR ROBUST WEBHOOK HANDLER
// This handler responds 200 OK IMMEDIATELY to prevent 404/timeout errors
// It handles GET (validation) and POST (events) requests
// ============================================
const handleVerimorWebhook = async (req, res) => {
    // CRITICAL: Send 200 OK immediately to prevent Verimor timeout/error
    // We send response BEFORE processing to ensure Verimor gets OK
    const timestamp = new Date().toISOString();
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║           VERIMOR WEBHOOK RECEIVED                           ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║ Timestamp: ${timestamp}`);
    console.log(`║ Method: ${req.method}`);
    console.log(`║ Path: ${req.path}`);
    console.log(`║ Original URL: ${req.originalUrl}`);
    console.log(`║ Content-Type: ${req.get('content-type') || 'none'}`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    try {
        // Extract data from query params (GET) or body (POST)
        let data = {};
        if (req.method === 'GET') {
            data = { ...req.query };
            console.log('[Verimor] Using query parameters (GET validation request)');
        }
        else {
            // POST - could be JSON or form-urlencoded
            data = { ...req.query, ...req.body };
            console.log('[Verimor] Using body + query (POST event request)');
        }
        console.log('[Verimor] Parsed Data:', JSON.stringify(data, null, 2));
        console.log('[Verimor] UUID:', data.uuid || 'N/A');
        console.log('[Verimor] CLI (Caller):', data.cli || 'N/A');
        console.log('[Verimor] CLD (Called):', data.cld || 'N/A');
        console.log('[Verimor] Step:', data.step || 'N/A');
        console.log('[Verimor] Event:', data.event || 'N/A');
        // Forward to n8n asynchronously (don't wait for response)
        setImmediate(async () => {
            try {
                const n8nResponse = await verimor_service_1.VerimorService.forwardToN8n(data);
                if (n8nResponse) {
                    console.log('[Verimor->n8n] Forward successful:', n8nResponse);
                }
            }
            catch (err) {
                console.error('[Verimor->n8n] Forward error:', err.message);
            }
        });
        // Return 200 OK with JSON response
        // Verimor API requires JSON with transfer.target field
        // See: https://github.com/verimor/Bulutsantralim-API/blob/master/advisory_webhook.md
        // Default response: transfer to a queue or hangup
        // You can customize this based on your needs
        const defaultTarget = process.env.VERIMOR_DEFAULT_TARGET || 'hangup/hangup';
        res.status(200).json({
            transfer: {
                target: defaultTarget
            }
        });
    }
    catch (error) {
        console.error('[Verimor] Webhook processing error:', error.message);
        // Return valid JSON even on error
        res.status(200).json({
            transfer: {
                target: 'hangup/hangup'
            }
        });
    }
};
// ============================================
// MOUNT VERIMOR WEBHOOK ON ALL PATH VARIATIONS
// Using app.all() to catch GET, POST, PUT, DELETE, OPTIONS etc.
// Including .json extensions as per Verimor API docs
// ============================================
const verimorPaths = [
    // Standard paths
    '/api/verimor/incoming-call',
    '/api/verimor/incoming-call/',
    '/verimor/incoming-call',
    '/verimor/incoming-call/',
    // With .json extension (Verimor API format)
    '/api/verimor/incoming-call.json',
    '/verimor/incoming-call.json',
    '/api/verimor.json',
    '/verimor.json',
    // Alternative webhook paths
    '/api/verimor/webhook',
    '/api/verimor/webhook/',
    '/verimor/webhook',
    '/verimor/webhook/',
    '/api/verimor/webhook.json',
    '/verimor/webhook.json',
    // Other variations
    '/api/webhook/verimor',
    '/api/webhook/verimor/',
    '/webhook/verimor',
    '/webhook/verimor/',
    '/api/webhook/verimor.json',
    '/webhook/verimor.json'
];
verimorPaths.forEach(p => {
    app.all(p, handleVerimorWebhook);
    console.log(`[VERIMOR] Mounted catch-all on: ${p}`);
});
// ============================================
// AUDIO UPLOAD ENDPOINT - For n8n Voice AI
// n8n generates TTS audio and uploads here
// Returns public URL for Verimor to play
// ============================================
app.post('/api/upload-audio', audioUpload.single('audio'), (req, res) => {
    try {
        console.log('=== AUDIO UPLOAD REQUEST ===');
        if (!req.file) {
            console.error('No audio file in request');
            return res.status(400).json({
                success: false,
                error: 'No audio file provided. Use field name "audio"'
            });
        }
        const filename = req.file.filename;
        const publicUrl = `https://api.aioasistan.com/public/audio/${filename}`;
        const localUrl = `http://localhost:${process.env.PORT || 3000}/public/audio/${filename}`;
        console.log('File saved:', req.file.path);
        console.log('Public URL:', publicUrl);
        console.log('Local URL:', localUrl);
        res.json({
            success: true,
            filename: filename,
            url: publicUrl,
            localUrl: localUrl,
            size: req.file.size,
            mimetype: req.file.mimetype
        });
    }
    catch (error) {
        console.error('Audio upload error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});
// Also mount on path without /api prefix
app.post('/upload-audio', audioUpload.single('audio'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No audio file provided' });
        }
        const filename = req.file.filename;
        const publicUrl = `https://api.aioasistan.com/public/audio/${filename}`;
        res.json({
            success: true,
            filename: filename,
            url: publicUrl,
            size: req.file.size
        });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
// ============================================
// VERIMOR PLAY AUDIO RESPONSE HELPER ENDPOINT
// Returns proper JSON command for Verimor to play audio
// ============================================
app.post('/api/verimor/play', express_1.default.json(), (req, res) => {
    try {
        const { audio_url, uuid } = req.body;
        console.log('=== VERIMOR PLAY AUDIO ===');
        console.log('Audio URL:', audio_url);
        console.log('Call UUID:', uuid);
        // Return Verimor-compatible response
        res.json({
            success: true,
            action: 'play',
            audio_url: audio_url,
            uuid: uuid
        });
    }
    catch (error) {
        console.error('Play audio error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// ============================================
// AUTH MIDDLEWARE
// ============================================
const authenticate = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token gerekli' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        req.user = {
            id: decoded.id,
            slug: decoded.slug,
            email: decoded.email
        };
        next();
    }
    catch (err) {
        console.error('JWT Verify Error:', err);
        return res.status(401).json({ error: 'Geçersiz token' });
    }
};
// ============================================
// PROTECTED ROUTES (Auth gerektiren)
// ============================================
// Dashboard verisi
apiRouter.get('/me', authenticate, async (req, res) => {
    try {
        const tenantId = req.user.id;
        const data = await user_service_1.UserService.getDashboardData(tenantId);
        res.json(data);
    }
    catch (e) {
        console.error('Get Me Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// Agent getir
apiRouter.get('/agent', authenticate, async (req, res) => {
    try {
        const tenantId = req.user.id;
        const agent = await agent_service_1.AgentService.getAgent(tenantId);
        res.json(agent || { name: 'Ajan Bulunamadı', model: 'gemini-pro' });
    }
    catch (e) {
        console.error('Get Agent Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// Agent güncelle
apiRouter.put('/agent', authenticate, async (req, res) => {
    try {
        const tenantId = req.user.id;
        const updated = await agent_service_1.AgentService.updateAgent(tenantId, req.body);
        res.json(updated);
    }
    catch (e) {
        console.error('Update Agent Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});
// Kota güncelle (mesaj sayısı artırma - n8n tarafından çağrılacak)
apiRouter.post('/quota/increment', async (req, res) => {
    try {
        const { tenantId } = req.body;
        await pool.query('UPDATE quotas SET current_message_count = current_message_count + 1 WHERE tenant_id = $1', [tenantId]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
// n8n Webhook (n8n'den gelen Twilio webhook'unu karşıla)
apiRouter.post('/n8n/webhook', async (req, res) => {
    try {
        console.log('=== N8N WEBHOOK RECEIVED ===');
        console.log('Webhook Data:', JSON.stringify(req.body, null, 2));
        // Twilio Voice Request formatı: { CallSid, From, To, CallStatus, CallerName, ... }
        const { From: caller, To: callee, CallSid, CallStatus } = req.body;
        // Arayan numara (caller) veya aranılan numara (callee) al
        const phoneNumber = caller || callee;
        console.log(`Aranan numara: ${phoneNumber}`);
        // Agent bilgilerini getir (aranan numaraya göre)
        // Hem Twilio hem Verimor numaralarını kontrol et
        const agentResult = await pool.query(`SELECT a.*, t.name as tenant_name, t.slug as tenant_slug, q.monthly_message_limit, q.current_message_count
             FROM agents a
             JOIN tenants t ON a.tenant_id = t.id
             LEFT JOIN quotas q ON t.id = q.tenant_id
             WHERE a.twilio_phone_number = $1 OR a.verimor_did = $1`, [phoneNumber, phoneNumber]);
        if (agentResult.rows.length === 0) {
            console.log('Agent bulunamadı, numara:', phoneNumber);
            return res.json({
                success: false,
                message: 'Bu numaraya atanmış bir agent yok'
            });
        }
        const agent = agentResult.rows[0];
        console.log('Bulunan Agent:', agent.name);
        console.log('System Prompt:', agent.system_prompt);
        console.log('Tenant:', agent.tenant_slug);
        // n8n için TwiML response
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather>
    <Say>Hello! AIO Asistanınız ile görüşüyorsunuz.</Say>
  </Gather>
</Response>`;
        console.log('Twilio Response:', twiml);
        res.setHeader('Content-Type', 'application/xml');
        res.send(twiml);
    }
    catch (error) {
        console.error('N8n Webhook Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// Test endpoint: Numara atama (Development only)
apiRouter.post('/test/assign-number', async (req, res) => {
    try {
        const { tenantId, agentId } = req.body;
        if (!tenantId || !agentId) {
            return res.status(400).json({ error: 'tenantId ve agentId gereklidir' });
        }
        console.log('Test numara atama isteği:', { tenantId, agentId });
        const result = await verimor_service_1.VerimorService.assignNumberToTenant(tenantId, agentId);
        res.json({
            success: true,
            message: 'Numara başarılya atandı',
            data: result
        });
    }
    catch (error) {
        console.error('Test Assign Number Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// Test endpoint: Numara serbest bırakma (Development only)
apiRouter.post('/test/release-number', async (req, res) => {
    try {
        const { didNumber } = req.body;
        if (!didNumber) {
            return res.status(400).json({ error: 'didNumber gereklidir' });
        }
        console.log('Test numara serbest bırakma isteği:', didNumber);
        const result = await verimor_service_1.VerimorService.releaseNumber(didNumber);
        res.json({
            success: true,
            message: result.message
        });
    }
    catch (error) {
        console.error('Test Release Number Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// Test endpoint: Müsait numara sayısı (Development only)
apiRouter.get('/test/available-count', async (req, res) => {
    try {
        const count = await verimor_service_1.VerimorService.getAvailableCount();
        res.json({
            success: true,
            availableCount: count
        });
    }
    catch (error) {
        console.error('Get Available Count Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// Admin: Verimor numarası havuza ekle
apiRouter.post('/admin/verimor/add-number', async (req, res) => {
    try {
        const { didNumber, webhookSecret } = req.body;
        if (!didNumber) {
            return res.status(400).json({ error: 'didNumber gereklidir' });
        }
        console.log('Verimor numara ekleme isteği:', { didNumber, webhookSecret });
        const result = await verimor_service_1.VerimorService.addToPool(didNumber, webhookSecret);
        res.json({
            success: true,
            message: `Numara ${didNumber} havuza eklendi`,
            data: result
        });
    }
    catch (error) {
        console.error('Add Verimor Number Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// Admin: Havuzdaki tüm numaraları listele
apiRouter.get('/admin/verimor/numbers', async (req, res) => {
    try {
        const result = await pool.query(`SELECT 
                vn.*,
                t.name as tenant_name,
                a.name as agent_name
             FROM verimor_numbers vn
             LEFT JOIN tenants t ON vn.tenant_id = t.id
             LEFT JOIN agents a ON vn.agent_id = a.id
             ORDER BY vn.created_at DESC`);
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    }
    catch (error) {
        console.error('Get Verimor Numbers Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
// ============================================
// Health check
apiRouter.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Paynet Connection Test
apiRouter.post('/payment/test-connection', async (req, res) => {
    try {
        console.log('=== PAYNET CONNECTION TEST REQUEST ===');
        const result = await paynet_service_1.PaynetService.checkConnection();
        if (result.success) {
            res.json({
                success: true,
                message: 'Paynet connection successful',
                data: result.data
            });
        }
        else {
            res.status(500).json({
                success: false,
                message: 'Paynet connection failed',
                error: result.error,
                responseStatus: result.statusCode,
                responseData: result.responseData
            });
        }
    }
    catch (error) {
        console.error('Paynet Test Route Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});
app.use('/api', apiRouter);
const port = Number(process.env.PORT) || 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
    console.log(`Health check: http://localhost:${port}/api/health`);
});
