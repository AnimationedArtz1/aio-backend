import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { AuthService } from './services/auth.service';
import { PaynetService } from './services/paynet.service';
import { TwilioService } from './services/twilio.service';
import { AgentService } from './services/agent.service';
import { UserService } from './services/user.service';
import { VerimorService } from './services/verimor.service';

dotenv.config();

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'super_gizli_jwt_sifresi_bunu_degistir';

// CORS: Hepsine izin ver
app.use(cors({ origin: '*' }));
app.use(express.json());

// Request Logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

const apiRouter = express.Router();

// ============================================
// PUBLIC ROUTES (Auth gerektirmeyen)
// ============================================

// Login
apiRouter.post('/auth/login', async (req, res) => {
    try {
        console.log('Login Request:', req.body);
        const { email, password } = req.body;
        const result = await AuthService.login(email, password);
        res.json(result);
    } catch (e: any) {
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

         const result = await PaynetService.createPaymentLink({ amount, referenceCode: fullRef, email, name });
        res.json({
            success: true,
            url: result.url,
            referenceCode: fullRef,
            sessionId: result.session_id
        });
    } catch (e: any) {
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
        const result = await AuthService.signupFromForm({
            businessName,
            contactEmail,
            websiteUrl,
            industry,
            planId
        });

        console.log('Signup Result:', result);

        res.json(result);
    } catch (e: any) {
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
        const planPrices: Record<string, number> = {
            'starter': 4900,
            'pro': 24900,
            'enterprise': 199900
        };

        const amount = planPrices[planId] || 4900;
        const referenceCode = 'ORDER-' + Date.now() + '-' + planId;

        const result = await PaynetService.createPaymentLink({
            amount,
            referenceCode,
            email: 'checkout@aioasistan.com',
            name: planId.toUpperCase() + ' Plan'
        });

        res.json({
            redirectUrl: result.url,
            checkoutUrl: result.url,
            sessionId: result.session_id
        });
    } catch (e: any) {
        console.error('Billing Checkout Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Paynet Webhook - Ödeme sonucu callback
apiRouter.post('/paynet/callback', async (req, res) => {
    try {
        console.log('Paynet Callback Received:', req.body);
        
        const { 
            status, 
            reference_no, 
            email, 
            name_surname,
            amount,
            transaction_id 
        } = req.body;
        
        if (status === '1' || status === 'success' || status === 1) {
            // Ödeme başarılı
            console.log(`Ödeme başarılı: ${email}, Ref: ${reference_no}`);

            // 1. Tenant oluştur
            const tenant = await AuthService.createTenantFromPayment({
                email,
                name: name_surname || email.split('@')[0],
                reference_no
            });

            console.log(`Tenant oluşturuldu: ${tenant.slug}, ID: ${tenant.tenantId}`);

            // 2. Agent'ı bul (Tenant oluşturulurken varsayılan agent oluşturuluyor)
            const agentResult = await pool.query(
                'SELECT id FROM agents WHERE tenant_id = $1 LIMIT 1',
                [tenant.tenantId]
            );

            if (agentResult.rows.length === 0) {
                throw new Error('Tenant oluşturuldu ancak agent bulunamadı');
            }

            const agentId = agentResult.rows[0].id;
            console.log(`Agent ID bulundu: ${agentId}`);

            // 3. Verimor havuzundan numara ata (YENİ OTOMASYON)
            let phoneNumber = null;
            let assignmentType = 'none';

            try {
                const verimorAssignment = await VerimorService.assignNumberToTenant(
                    tenant.tenantId,
                    agentId
                );
                phoneNumber = verimorAssignment.didNumber;
                assignmentType = 'verimor';
                console.log(`Verimor numarası atandı: ${phoneNumber}`);
            } catch (verimorErr: any) {
                console.error('Verimor numarası atanamadı:', verimorErr.message);

                // Verimor havuzunda numara yoksa Twilio'a fallback yap
                console.log('Twilio fallback başlatılıyor...');

                try {
                    const phone = await TwilioService.buyPhoneNumber(tenant.slug);
                    phoneNumber = phone.phoneNumber;
                    assignmentType = 'twilio';

                    await pool.query(
                        'UPDATE agents SET twilio_phone_number = $1, twilio_sid = $2 WHERE tenant_id = $3',
                        [phone.phoneNumber, phone.sid, tenant.tenantId]
                    );

                    console.log(`Twilio numarası atandı: ${phone.phoneNumber}`);
                } catch (twilioErr: any) {
                    console.error('Twilio numara alınamadı (mock kullanılacak):', twilioErr.message);
                    phoneNumber = '+905550001122';
                    assignmentType = 'mock';

                    await pool.query(
                        'UPDATE agents SET twilio_phone_number = $1 WHERE tenant_id = $2',
                        [phoneNumber, tenant.tenantId]
                    );
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
        } else {
            // Ödeme başarısız
            console.log(`Ödeme başarısız: ${email}, Status: ${status}`);
            res.json({ success: false, message: 'Ödeme başarısız' });
        }
    } catch (e: any) {
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

        const result = await VerimorService.makeCall(DEMO_EXTENSION, target_number);

        if (result.success) {
            res.json({
                success: true,
                message: 'Call initiated',
                data: result.data
            });
        } else {
            res.status(500).json({
                success: false,
                message: result.message
            });
        }
    } catch (error: any) {
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
    } catch (error: any) {
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
    } catch (error: any) {
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
apiRouter.stack.forEach((layer: any) => {
    if (layer.route && layer.methods) {
        const methods = layer.methods.join(',');
        console.log(`[ROUTE] ${methods} /api${layer.route}`);
    }
});

console.log('[ROUTE] apiRouter mounted on /api');

// ============================================
// Verimor Shared Webhook Handler - Prevents trailing slash & redirects
// ============================================
const handleVerimorWebhook = async (req: any, res: any) => {
    try {
        console.log('=== VERIMOR WEBHOOK HIT ===');
        console.log('Method:', req.method);
        console.log('Path:', req.path);
        console.log('Query:', req.query);
        console.log('Body:', req.body);
        
        const data = req.query || req.body || {};
        console.log('UUID:', data.uuid);
        console.log('CLI:', data.cli);
        console.log('CLD:', data.cld);
        console.log('Step:', data.step);
        
        return res.status(200).send('OK');
    } catch (error: any) {
        console.error('Verimor Webhook Error:', error.message);
        return res.status(200).send('OK');
    }
};

// Mount on all 4 path variations
app.get('/api/verimor/incoming-call', handleVerimorWebhook);
app.get('/api/verimor/incoming-call/', handleVerimorWebhook);
app.get('/verimor/incoming-call', handleVerimorWebhook);
app.get('/verimor/incoming-call/', handleVerimorWebhook);

app.all('/api/verimor/incoming-call', handleVerimorWebhook);
app.all('/api/verimor/incoming-call/', handleVerimorWebhook);
app.all('/verimor/incoming-call', handleVerimorWebhook);
app.all('/verimor/incoming-call/', handleVerimorWebhook);

// ============================================
// AUTH MIDDLEWARE
// ============================================
const authenticate = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token gerekli' });
    }
    
    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = {
            id: decoded.id,
            slug: decoded.slug,
            email: decoded.email
        };
        next();
    } catch (err) {
        console.error('JWT Verify Error:', err);
        return res.status(401).json({ error: 'Geçersiz token' });
    }
};

// ============================================
// PROTECTED ROUTES (Auth gerektiren)
// ============================================

// Dashboard verisi
apiRouter.get('/me', authenticate, async (req: any, res) => {
    try {
        const tenantId = req.user.id;
        const data = await UserService.getDashboardData(tenantId);
        res.json(data);
    } catch (e: any) {
        console.error('Get Me Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Agent getir
apiRouter.get('/agent', authenticate, async (req: any, res) => {
    try {
        const tenantId = req.user.id;
        const agent = await AgentService.getAgent(tenantId);
        res.json(agent || { name: 'Ajan Bulunamadı', model: 'gemini-pro' });
    } catch (e: any) {
        console.error('Get Agent Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Agent güncelle
apiRouter.put('/agent', authenticate, async (req: any, res) => {
    try {
        const tenantId = req.user.id;
        const updated = await AgentService.updateAgent(tenantId, req.body);
        res.json(updated);
    } catch (e: any) {
        console.error('Update Agent Error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Kota güncelle (mesaj sayısı artırma - n8n tarafından çağrılacak)
apiRouter.post('/quota/increment', async (req, res) => {
    try {
        const { tenantId } = req.body;
        await pool.query(
            'UPDATE quotas SET current_message_count = current_message_count + 1 WHERE tenant_id = $1',
            [tenantId]
        );
        res.json({ success: true });
    } catch (e: any) {
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
        const agentResult = await pool.query(
            `SELECT a.*, t.name as tenant_name, t.slug as tenant_slug, q.monthly_message_limit, q.current_message_count
             FROM agents a
             JOIN tenants t ON a.tenant_id = t.id
             LEFT JOIN quotas q ON t.id = q.tenant_id
             WHERE a.twilio_phone_number = $1 OR a.verimor_did = $1`,
            [phoneNumber, phoneNumber]
        );

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
        
    } catch (error: any) {
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

        const result = await VerimorService.assignNumberToTenant(tenantId, agentId);

        res.json({
            success: true,
            message: 'Numara başarılya atandı',
            data: result
        });
    } catch (error: any) {
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

        const result = await VerimorService.releaseNumber(didNumber);

        res.json({
            success: true,
            message: result.message
        });
    } catch (error: any) {
        console.error('Test Release Number Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Test endpoint: Müsait numara sayısı (Development only)
apiRouter.get('/test/available-count', async (req, res) => {
    try {
        const count = await VerimorService.getAvailableCount();

        res.json({
            success: true,
            availableCount: count
        });
    } catch (error: any) {
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

        const result = await VerimorService.addToPool(didNumber, webhookSecret);

        res.json({
            success: true,
            message: `Numara ${didNumber} havuza eklendi`,
            data: result
        });
    } catch (error: any) {
        console.error('Add Verimor Number Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Admin: Havuzdaki tüm numaraları listele
apiRouter.get('/admin/verimor/numbers', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT 
                vn.*,
                t.name as tenant_name,
                a.name as agent_name
             FROM verimor_numbers vn
             LEFT JOIN tenants t ON vn.tenant_id = t.id
             LEFT JOIN agents a ON vn.agent_id = a.id
             ORDER BY vn.created_at DESC`
        );

        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (error: any) {
        console.error('Get Verimor Numbers Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// Verimor Shared Webhook Handler - Prevents trailing slash & redirects
// ============================================
const handleVerimorWebhook = async (req: any, res: any) => {
    try {
        console.log('=== VERIMOR WEBHOOK HIT ===');
        console.log('Method:', req.method);
        console.log('Path:', req.path);
        console.log('Query:', req.query);
        console.log('Body:', req.body);
        
        const data = req.query || req.body || {};
        console.log('UUID:', data.uuid);
        console.log('CLI:', data.cli);
        console.log('CLD:', data.cld);
        console.log('Step:', data.step);
        
        return res.status(200).send('OK');
    } catch (error: any) {
        console.error('Verimor Webhook Error:', error.message);
        return res.status(200).send('OK');
    }
};

// Mount on all 4 path variations to prevent trailing slash issues
app.get('/api/verimor/incoming-call', handleVerimorWebhook);
app.get('/api/verimor/incoming-call/', handleVerimorWebhook);
app.get('/verimor/incoming-call', handleVerimorWebhook);
app.get('/verimor/incoming-call/', handleVerimorWebhook);
app.all('/api/verimor/incoming-call', handleVerimorWebhook);
app.all('/api/verimor/incoming-call/', handleVerimorWebhook);
app.all('/verimor/incoming-call', handleVerimorWebhook);
app.all('/verimor/incoming-call/', handleVerimorWebhook);

// ============================================
// Health check
apiRouter.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Paynet Connection Test
apiRouter.post('/payment/test-connection', async (req, res) => {
    try {
        console.log('=== PAYNET CONNECTION TEST REQUEST ===');
        const result = await PaynetService.checkConnection();

        if (result.success) {
            res.json({
                success: true,
                message: 'Paynet connection successful',
                data: result.data
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Paynet connection failed',
                error: result.error,
                responseStatus: result.responseStatus,
                responseData: result.responseData
            });
        }
    } catch (error: any) {
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
