import axios from 'axios';
import { Pool } from 'pg';

// Verimor API Configuration
const VERIMOR_BASE_URL = process.env.VERIMOR_BASE_URL || 'https://api.bulutsantralim.com';
const VERIMOR_API_KEY = process.env.VERIMOR_API_KEY || '';
const VERIMOR_USERNAME = process.env.VERIMOR_USERNAME || '';
const VERIMOR_PASSWORD = process.env.VERIMOR_PASSWORD || '';
const VERIMOR_MOCK_MODE = process.env.VERIMOR_MOCK_MODE === 'true';

// n8n Webhook URL for Voice AI
const N8N_VOICE_WEBHOOK_URL = process.env.N8N_VOICE_WEBHOOK_URL || '';

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

export interface VerimorWebhookData {
    uuid?: string;
    cli?: string;      // Caller ID (arayan numara)
    cld?: string;      // Called number (aranan numara/extension)
    step?: string;     // Webhook step
    event?: string;    // Event type
    [key: string]: any;
}

export class VerimorService {
    /**
     * Initiate an outbound call using Verimor's /originate endpoint
     * Uses HTTP Basic Auth as per Verimor API docs
     */
    static async makeCall(extension: string, destination: string): Promise<CallResult> {
        const cleanExtension = extension.replace(/[\s+]/g, '');
        const cleanDestination = destination.replace(/[\s+]/g, '');

        if (VERIMOR_MOCK_MODE) {
            console.log('=== VERIMOR MOCK MODE ===');
            console.log('Extension:', cleanExtension);
            console.log('Destination:', cleanDestination);
            return {
                success: true,
                message: 'Call simulated successfully (mock mode)',
                data: { call_uuid: 'mock-uuid-' + Date.now(), mock: true }
            };
        }

        try {
            // Use the correct /originate endpoint
            const url = `${VERIMOR_BASE_URL}/originate`;

            console.log('=== VERIMOR ORIGINATE CALL ===');
            console.log('URL:', url);
            console.log('Extension:', cleanExtension);
            console.log('Destination:', cleanDestination);
            console.log('Username:', VERIMOR_USERNAME);

            // Build request config with HTTP Basic Auth
            const axiosConfig: any = {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            };

            // Always use HTTP Basic Auth if credentials are available
            if (VERIMOR_USERNAME && VERIMOR_PASSWORD) {
                axiosConfig.auth = {
                    username: VERIMOR_USERNAME,
                    password: VERIMOR_PASSWORD
                };
                console.log('Using HTTP Basic Auth');
            }

            // Request body for originate
            const requestBody = {
                extension: cleanExtension,
                destination: cleanDestination,
                auto_answer: true
            };

            // Add API key if provided (some Verimor setups require it)
            if (VERIMOR_API_KEY) {
                (requestBody as any).key = VERIMOR_API_KEY;
                console.log('API Key included in request');
            }

            console.log('Request Body:', JSON.stringify(requestBody, null, 2));

            const response = await axios.post(url, requestBody, axiosConfig);

            console.log('Response Status:', response.status);
            console.log('Response Data:', response.data);

            return {
                success: true,
                message: 'Call initiated successfully',
                data: {
                    call_uuid: response.data?.call_uuid || response.data,
                    raw_response: response.data
                }
            };

        } catch (error: any) {
            console.error('=== VERIMOR ORIGINATE ERROR ===');
            console.error('Error Message:', error.message);

            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Status Text:', error.response.statusText);
                console.error('Response Headers:', JSON.stringify(error.response.headers, null, 2));
                console.error('Response Data:', error.response.data);

                // If auth error, try alternative auth method
                if (error.response.status === 401 || error.response.status === 403) {
                    console.log('Auth failed, trying alternative method with query params...');
                    return this.makeCallWithQueryParams(cleanExtension, cleanDestination);
                }
            }

            return {
                success: false,
                message: error.response?.data?.message || error.response?.data || error.message || 'Failed to initiate call'
            };
        }
    }

    /**
     * Alternative call method using query parameters (fallback)
     */
    static async makeCallWithQueryParams(extension: string, destination: string): Promise<CallResult> {
        try {
            const url = `${VERIMOR_BASE_URL}/originate`;

            console.log('=== VERIMOR ORIGINATE (Query Params Fallback) ===');

            const params: any = {
                extension: extension,
                destination: destination,
                auto_answer: true
            };

            // Add credentials as query params
            if (VERIMOR_API_KEY) {
                params.key = VERIMOR_API_KEY;
            }
            if (VERIMOR_USERNAME) {
                params.username = VERIMOR_USERNAME;
            }
            if (VERIMOR_PASSWORD) {
                params.password = VERIMOR_PASSWORD;
            }

            const response = await axios.get(url, {
                params,
                timeout: 30000
            });

            console.log('Fallback Response Status:', response.status);
            console.log('Fallback Response Data:', response.data);

            return {
                success: true,
                message: 'Call initiated successfully (fallback method)',
                data: { call_uuid: response.data }
            };

        } catch (error: any) {
            console.error('=== VERIMOR FALLBACK ERROR ===');
            console.error('Error:', error.message);
            if (error.response) {
                console.error('Response Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            }

            return {
                success: false,
                message: error.response?.data || error.message || 'Failed to initiate call'
            };
        }
    }

    /**
     * Forward incoming call data to n8n for Voice AI processing
     */
    static async forwardToN8n(webhookData: VerimorWebhookData): Promise<any> {
        if (!N8N_VOICE_WEBHOOK_URL) {
            console.log('N8N_VOICE_WEBHOOK_URL not configured, skipping forward');
            return null;
        }

        try {
            console.log('=== FORWARDING TO N8N ===');
            console.log('N8N URL:', N8N_VOICE_WEBHOOK_URL);
            console.log('Payload:', JSON.stringify(webhookData, null, 2));

            const response = await axios.post(N8N_VOICE_WEBHOOK_URL, webhookData, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            console.log('N8N Response Status:', response.status);
            console.log('N8N Response Data:', response.data);

            return response.data;

        } catch (error: any) {
            console.error('=== N8N FORWARD ERROR ===');
            console.error('Error:', error.message);
            if (error.response) {
                console.error('Response Status:', error.response.status);
                console.error('Response Data:', error.response.data);
            }
            // Don't throw - we don't want to fail the Verimor webhook response
            return null;
        }
    }

    /**
     * Generate Verimor response to play an audio file
     */
    static generatePlayAudioResponse(audioUrl: string): object {
        return {
            success: true,
            action: 'play',
            audio_url: audioUrl
        };
    }

    /**
     * Generate Verimor response to hangup the call
     */
    static generateHangupResponse(reason?: string): object {
        return {
            success: true,
            action: 'hangup',
            reason: reason || 'completed'
        };
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

            const { id: numberId, agent_id: agentId } = numberResult.rows[0];

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
