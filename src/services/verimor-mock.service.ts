import axios from 'axios';

export interface CallResult {
    success: boolean;
    message?: string;
    data?: any;
}

export class VerimorMockService {
    static async makeCall(extension: string, destination: string): Promise<CallResult> {
        const cleanExtension = extension.replace(/[\s+]/g, '');
        const cleanDestination = destination.replace(/[\s+]/g, '');

        console.log('=== VERIMOR MOCK CALL ===');
        console.log('Extension:', cleanExtension);
        console.log('Destination:', cleanDestination);
        console.log('MOCK MODE: Simulating call initiation');

        const mockCallUuid = 'mock-uuid-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

        return {
            success: true,
            message: 'Call simulated successfully (mock mode)',
            data: {
                call_uuid: mockCallUuid,
                provider: 'verimor-mock',
                extension: cleanExtension,
                destination: cleanDestination,
                mock: true,
                timestamp: new Date().toISOString()
            }
        };
    }
}
