"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerimorMockService = void 0;
class VerimorMockService {
    static async makeCall(extension, destination) {
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
exports.VerimorMockService = VerimorMockService;
