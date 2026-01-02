"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const pg_1 = require("pg");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
class AuthService {
    static async login(email, passwordRaw) {
        const res = await pool.query('SELECT * FROM tenants WHERE email = $1', [email]);
        const tenant = res.rows[0];
        if (!tenant)
            throw new Error('Kullanıcı bulunamadı.');
        const match = await bcrypt_1.default.compare(passwordRaw, tenant.password_hash);
        if (!match)
            throw new Error('Hatalı şifre.');
        const token = jsonwebtoken_1.default.sign({ id: tenant.id, slug: tenant.slug, email: tenant.email }, JWT_SECRET, { expiresIn: '7d' });
        return { token, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } };
    }
    /**
     * Paynet webhook'unda çağrılır - Verimor numarası otomatik tahsis eder
     */
    static async createTenantFromPayment(paymentData) {
        const { email, name, reference_no } = paymentData;
        const randomPassword = Math.random().toString(36).slice(-8);
        const hash = await bcrypt_1.default.hash(randomPassword, 10);
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + Math.floor(Math.random() * 1000);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const res = await client.query(`INSERT INTO tenants (name, slug, email, password_hash, paynet_ref_code)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id`, [name, slug, email, hash, reference_no]);
            const tenantId = res.rows[0].id;
            await client.query(`INSERT INTO agents (tenant_id, name, role_type, system_prompt, model)
              VALUES ($1, 'Satış Asistanı', 'general', 'Sen profesyonel bir asistansın.', 'gemini-pro')`, [tenantId]);
            await client.query(`INSERT INTO quotas (tenant_id, plan_name, monthly_message_limit) VALUES ($1, 'pro', 5000)`, [tenantId]);
            await client.query('COMMIT');
            return { tenantId, slug, email, tempPassword: randomPassword };
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    /**
     * Frontend signup formu için - Verimor numarası tahsis eder
     */
    static async signupFromForm(signupData) {
        const randomPassword = Math.random().toString(36).slice(-8);
        const hash = await bcrypt_1.default.hash(randomPassword, 10);
        const slug = signupData.businessName.toLowerCase().replace(/[^a-z0-9]/g, '') + '-' + Math.floor(Math.random() * 1000);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const res = await client.query(`INSERT INTO tenants (name, slug, email, password_hash)
              VALUES ($1, $2, $3, $4)
              RETURNING id`, [signupData.businessName, slug, signupData.contactEmail, hash]);
            const tenantId = res.rows[0].id;
            await client.query(`INSERT INTO agents (tenant_id, name, role_type, system_prompt, model)
              VALUES ($1, 'Satış Asistanı', 'general', 'Sen profesyonel bir asistansın.', 'gemini-pro')`, [tenantId]);
            await client.query(`INSERT INTO quotas (tenant_id, plan_name, monthly_message_limit) VALUES ($1, 'pro', 5000)`, [tenantId]);
            // Verimor havuzundan numara tahsis et
            const agentResult = await client.query('SELECT id FROM agents WHERE tenant_id = $1 LIMIT 1', [tenantId]);
            if (agentResult.rows.length === 0) {
                throw new Error('Agent oluşturulamadı');
            }
            const agentId = agentResult.rows[0].id;
            // Verimor numarası ata
            const verimorResult = await client.query(`SELECT id, did_number
             FROM verimor_numbers
             WHERE status = 'available'
             LIMIT 1
             FOR UPDATE SKIP LOCKED`);
            let phoneNumber = null;
            let assignmentType = 'none';
            if (verimorResult.rows.length > 0) {
                const { id: numberId, did_number: didNumber } = verimorResult.rows[0];
                await client.query('UPDATE verimor_numbers SET status = $1, tenant_id = $2, agent_id = $3, assigned_at = NOW() WHERE id = $4', ['assigned', tenantId, agentId, numberId]);
                await client.query('UPDATE agents SET verimor_did = $1 WHERE id = $2', [didNumber, agentId]);
                phoneNumber = didNumber;
                assignmentType = 'verimor';
            }
            await client.query('COMMIT');
            const token = jsonwebtoken_1.default.sign({ id: tenantId, slug, email: signupData.contactEmail }, JWT_SECRET, { expiresIn: '7d' });
            return {
                success: true,
                token,
                tenant: {
                    id: tenantId,
                    name: signupData.businessName,
                    slug,
                    email: signupData.contactEmail
                },
                temporaryPassword: randomPassword,
                phoneNumber,
                assignmentType
            };
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
}
exports.AuthService = AuthService;
