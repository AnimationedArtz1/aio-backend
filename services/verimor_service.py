import os
import requests
from typing import Optional, Dict, Any
from dotenv import load_dotenv

load_dotenv()

class VerimorClient:
    def __init__(self):
        self.api_key = os.getenv('VERIMOR_API_KEY')
        self.base_url = os.getenv('VERIMOR_BASE_URL', 'https://api.bulutsantralim.com')
        
        if not self.api_key:
            raise ValueError('VERIMOR_API_KEY environment variable is required')
    
    def _normalize_phone(self, phone: str) -> str:
        """Normalize phone number (ensure 90 prefix)"""
        phone = phone.replace(' ', '').replace('-', '').replace('(', '').replace(')', '')
        
        if not phone.startswith('90') and phone.startswith('0'):
            phone = '90' + phone[1:]
        elif not phone.startswith('90') and not phone.startswith('+90'):
            phone = '90' + phone
        
        return phone
    
    def begin_call(self, source: str, destination: str) -> Dict[str, Any]:
        """
        Begin call between two phone numbers
        
        Args:
            source: Source phone number
            destination: Destination phone number
            
        Returns:
            Dictionary with call session ID and details
        """
        try:
            normalized_source = self._normalize_phone(source)
            normalized_destination = self._normalize_phone(destination)
            
            url = f"{self.base_url}/begin_call"
            params = {
                'key': self.api_key,
                'source': normalized_source,
                'destination': normalized_destination,
                'auto_answer': 'true'
            }
            
            headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
            
            response = requests.post(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            
            return {
                'success': True,
                'session_id': response.json().get('session_id'),
                'status': response.json().get('status', 'initiated'),
                'data': response.json()
            }
            
        except requests.exceptions.RequestException as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'Verimor API request failed'
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'Unexpected error occurred'
            }
    
    def get_available_numbers(self, area_code: str = '850') -> Dict[str, Any]:
        """
        Get available phone numbers from Verimor
        
        Args:
            area_code: Area code (850, 212, etc.)
            
        Returns:
            Dictionary with available numbers
        """
        try:
            url = f"{self.base_url}/numbers/available"
            params = {
                'key': self.api_key,
                'area_code': area_code
            }
            
            headers = {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
            
            response = requests.get(url, params=params, headers=headers, timeout=30)
            response.raise_for_status()
            
            return {
                'success': True,
                'numbers': response.json().get('numbers', []),
                'data': response.json()
            }
            
        except requests.exceptions.RequestException as e:
            return {
                'success': False,
                'error': str(e),
                'message': 'Failed to get available numbers'
            }


# Singleton instance
verimor_client = VerimorClient()


# Convenience functions
def begin_call(source: str, destination: str) -> Dict[str, Any]:
    """Convenience function to begin a call"""
    return verimor_client.begin_call(source, destination)


def get_available_numbers(area_code: str = '850') -> Dict[str, Any]:
    """Convenience function to get available numbers"""
    return verimor_client.get_available_numbers(area_code)


if __name__ == '__main__':
    # Test the service
    print("Verimor Service Test")
    print("=" * 50)
    
    # Test available numbers
    print("\n1. Getting available numbers...")
    result = get_available_numbers('850')
    if result['success']:
        print(f"✓ Success: Found {len(result.get('numbers', []))} numbers")
    else:
        print(f"✗ Error: {result.get('message')}")
    
    # Test begin call
    print("\n2. Testing begin_call...")
    result = begin_call('908500001000', '90555001122')
    if result['success']:
        print(f"✓ Success: Session ID: {result.get('session_id')}")
    else:
        print(f"✗ Error: {result.get('message')}")
