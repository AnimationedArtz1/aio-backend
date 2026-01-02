import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export class UserService {
  // Dashboard için tüm veriyi getir
  static async getDashboardData(tenantId: string) {
    const client = await pool.connect();
    try {
        // 1. Tenant Bilgisi (Telefon, Email)
        const tenantRes = await client.query('SELECT name, email, phone_number, slug FROM tenants WHERE id = $1', [tenantId]);
        
        // 2. Kota Bilgisi
        const quotaRes = await client.query('SELECT * FROM quotas WHERE tenant_id = $1', [tenantId]);
        
        // 3. Agent Bilgisi
        const agentRes = await client.query('SELECT name, model, twilio_phone_number FROM agents WHERE tenant_id = $1', [tenantId]);

        return {
            tenant: tenantRes.rows[0],
            quota: quotaRes.rows[0] || { monthly_message_limit: 0, current_message_count: 0 },
            agent: agentRes.rows[0] || null
        };
    } finally {
        client.release();
    }
  }
}
