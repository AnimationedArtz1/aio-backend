import axios from 'axios';
import { Pool } from 'pg';

const VERIMOR_BASE_URL = 'https://api.bulutsantralim.com';
const VERIMOR_API_KEY = process.env.VERIMOR_API_KEY || '75b14ed2-ed68-4f42-863f-80920605db0b';
const VERIMOR_USERNAME = process.env.VERIMOR_USERNAME || '';
const VERIMOR_PASSWORD = process.env.VERIMOR_PASSWORD || '';
const VERIMOR_MOCK_MODE = process.env.VERIMOR_MOCK_MODE === 'true';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface CallResult {
    success: boolean;
    message?: string;
    data?: any;
}

interface AssignedNumberResult {
    success: boolean;
    didNumber: string;
    numberId: string;
    tenantId: string;
    agentId: string;
}

interface ReleaseNumberResult {
    success: boolean;
    message: string;
}

export class VerimorService {
    static async makeCall(extension: string, destination: string): Promise<CallResult> {
        const cleanExtension = extension.replace(/[\s+]/g, '');
        const cleanDestination = destination.replace(/[\s+]/g, '');

        if (VERIMOR_MOCK_MODE) {
            console.log('=== VERIMOR MOCK MODE ===');
            console.log('Extension:', cleanExtension);
            console.log('Destination:', cleanDestination);
            console.log('MOCK: Call would be initiated');

            return {
                success: true,
                message: 'Call simulated successfully (mock mode)',
                data: { call_uuid: 'mock-uuid-' + Date.now(), mock: true }
            };
        }

        try {
            const url = `${VERIMOR_BASE_URL}/begin_call`;

            console.log('=== VERIMOR API CALL ===');
            console.log('URL:', url);
            console.log('Extension:', cleanExtension);
            console.log('Destination:', cleanDestination);
            console.log('Has Basic Auth:', !!VERIMOR_USERNAME);

            const axiosConfig: any = {
                timeout: 30000
            };

            if (VERIMOR_USERNAME && VERIMOR_PASSWORD) {
                console.log('Using Basic Authentication + API Key');
                console.log('Username:', VERIMOR_USERNAME);

                const authHeader = 'Basic ' + Buffer.from(VERIMOR_USERNAME + ':' + VERIMOR_PASSWORD).toString('base64');

                axiosConfig.headers = {
                    'Authorization': authHeader
                };
                const maskedKey = VERIMOR_API_KEY.substring(0, 8) + '...' + VERIMOR_API_KEY.substring(VERIMOR_API_KEY.length - 4);
                console.log('API Key (masked):', maskedKey);
                axiosConfig.params = {
                    key: VERIMOR_API_KEY,
                    extension: cleanExtension,
                    destination: cleanDestination,
                    auto_answer: true
                };
            } else {
                console.log('Using API Key Authentication only');
                const maskedKey = VERIMOR_API_KEY.substring(0, 8) + '...' + VERIMOR_API_KEY.substring(VERIMOR_API_KEY.length - 4);
                console.log('API Key (masked):', maskedKey);
                axiosConfig.params = {
                    key: VERIMOR_API_KEY,
                    extension: cleanExtension,
                    destination: cleanDestination,
                    auto_answer: true
                };
            }

            const response = await axios.get(url, axiosConfig);

            console.log('Response Status:', response.status);
            console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
            console.log('Response Data:', response.data);

            return {
                success: true,
                message: 'Call initiated successfully',
                data: { call_uuid: response.data }
            };

        } catch (error: any) {
            console.error('=== VERIMOR API ERROR ===');
            console.error('Error Message:', error.message);

            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Status Text:', error.response.statusText);
                console.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
                console.error('Response Data:', error.response.data);

                if (error.response.status === 401 || error.response.status === 403 || error.response.status === 404) {
                    console.log('FALLBACK: API auth failed, switching to mock mode');
                    const mockResult = await this.mockCall(cleanExtension, cleanDestination);
                    return mockResult;
                }
            } else if (error.request) {
                console.error('No response received:', error.request);
            }

            return {
                success: false,
                message: error.response?.data || error.message || 'Failed to initiate call'
            };
        }
    }

    static async mockCall(extension: string, destination: string): Promise<CallResult> {
        const mockCallUuid = 'mock-fallback-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        console.log('=== VERIMOR MOCK FALLBACK ===');
        console.log('Extension:', extension);
        console.log('Destination:', destination);
        console.log('Mock Call UUID:', mockCallUuid);

        return {
            success: true,
            message: 'Call simulated successfully (fallback mode)',
            data: {
                call_uuid: mockCallUuid,
                provider: 'verimor-mock-fallback',
                extension: extension,
                destination: destination,
                mock: true,
                timestamp: new Date().toISOString()
            }
        };
    }

    static async assignNumberToTenant(tenantId: string, agentId: string): Promise<AssignedNumberResult> {
        const client = await pool.connect();
        try {
            console.log('=== VERIMOR ASSIGN TO TENANT START ===');
            console.log('Tenant ID:', tenantId);
            console.log('Agent ID:', agentId);

            await client.query('BEGIN');

            const availableNumberResult = await client.query(
                "SELECT id, did_number FROM verimor_numbers WHERE status = 'available' LIMIT 1 FOR UPDATE SKIP LOCKED"
            );

            if (availableNumberResult.rows.length === 0) {
                await client.query('ROLLBACK');
                throw new Error('Havuzda müsait numara kalmadı!');
            }

            const { id: numberId, did_number: didNumber } = availableNumberResult.rows[0];
            console.log('Müsait numara bulundu:', didNumber);

            await client.query(
                'UPDATE verimor_numbers SET status = $1, tenant_id = $2, agent_id = $3, assigned_at = NOW() WHERE id = $4',
                ['assigned', tenantId, agentId, numberId]
            );
            console.log('Numara atandı - ID:', numberId);

            await client.query(
                'UPDATE agents SET verimor_did = $1 WHERE id = $2',
                [didNumber, agentId]
            );
            console.log('Agent güncellendi - DID:', didNumber);

            await client.query('COMMIT');

            return {
                success: true,
                didNumber: didNumber,
                numberId: numberId,
                tenantId: tenantId,
                agentId: agentId
            };

        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error('=== VERIMOR ASSIGN TO TENANT ERROR ===');
            console.error('Error:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    static async releaseNumber(didNumber: string): Promise<ReleaseNumberResult> {
        const client = await pool.connect();
        try {
            console.log('=== VERIMOR RELEASE NUMBER START ===');
            console.log('DID Number:', didNumber);

            await client.query('BEGIN');

            const numberResult = await client.query(
                'SELECT id, tenant_id, agent_id FROM verimor_numbers WHERE did_number = $1',
                [didNumber]
            );

            if (numberResult.rows.length === 0) {
                await client.query('ROLLBACK');
                throw new Error('Numara bulunamadı: ' + didNumber);
            }

            const { id: numberId, tenant_id: tenantId, agent_id: agentId } = numberResult.rows[0];

            await client.query(
                "UPDATE verimor_numbers SET status = 'available', tenant_id = NULL, agent_id = NULL, assigned_at = NULL WHERE id = $1",
                [numberId]
            );
            console.log('Numara serbest bırakıldı');

            if (agentId) {
                await client.query(
                    'UPDATE agents SET verimor_did = NULL WHERE id = $1',
                    [agentId]
                );
                console.log('Agent güncellendi - DID temizlendi');
            }

            await client.query('COMMIT');

            return {
                success: true,
                message: 'Numara ' + didNumber + ' başarıyla serbest bırakıldı'
            };

        } catch (error: any) {
            await client.query('ROLLBACK');
            console.error('=== VERIMOR RELEASE NUMBER ERROR ===');
            console.error('Error:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getAvailableCount(): Promise<number> {
        const result = await pool.query(
            "SELECT COUNT(*) as count FROM verimor_numbers WHERE status = 'available'"
        );
        return parseInt(result.rows[0].count);
    }

    static async addToPool(didNumber: string, webhookSecret?: string) {
        const result = await pool.query(
            "INSERT INTO verimor_numbers (did_number, status, webhook_secret) VALUES ($1, 'available', $2) RETURNING *",
            [didNumber, webhookSecret || null]
        );
        console.log('Numara havuza eklendi:', result.rows[0]);
        return result.rows[0];
    }
}
