import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export class AgentService {
  // Müşterinin ajanını getir
  static async getAgent(tenantId: string) {
    const res = await pool.query('SELECT * FROM agents WHERE tenant_id = $1 LIMIT 1', [tenantId]);
    return res.rows[0];
  }

  // Ajanı güncelle
  static async updateAgent(tenantId: string, data: any) {
    const { name, system_prompt, model, temperature, role_type } = data;
    
    const res = await pool.query(
      `UPDATE agents 
       SET name = $1, system_prompt = $2, model = $3, temperature = $4, role_type = $5
       WHERE tenant_id = $6
       RETURNING *`,
      [name, system_prompt, model, temperature, role_type, tenantId]
    );
    
    return res.rows[0];
  }
}
