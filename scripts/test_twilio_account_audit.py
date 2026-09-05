import importlib.util
import unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('twilio-account-audit.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
SID = 'AC' + 'a' * 32
PN = 'PN' + 'b' * 32
MG = 'MG' + 'c' * 32
class AuditTests(unittest.TestCase):
    def get(self, url):
        if url.endswith(SID + '.json'): return {'sid': SID, 'status': 'active', 'type': 'Full'}
        if '/IncomingPhoneNumbers.json?' in url: return {'incoming_phone_numbers': [{'sid': PN, 'account_sid': SID, 'phone_number': a.NUMBER, 'capabilities': {'voice': True, 'SMS': True, 'MMS': True}}]}
        if '/Services?' in url: return {'services': [{'sid': MG, 'account_sid': SID, 'friendly_name': 'Le Yard Guest Care'}]}
        if '/PhoneNumbers?' in url: return {'phone_numbers': [{'sid': PN}]}
        if '/Compliance/Usa2p?' in url: return {'us_app_to_person': [{'campaign_status': 'IN_PROGRESS', 'mock': False}]}
        self.fail('unexpected endpoint')
    def test_read_only(self):
        result = a.audit(SID, self.get)
        self.assertEqual(result['mutations'], 0)
        self.assertFalse(result['live_carrier_tests_passed'])
        self.assertTrue(result['capabilities']['mms'])
        self.assertEqual(result['campaigns'][0]['status'], 'IN_PROGRESS')
    def test_unknown_sid(self):
        with self.assertRaises(a.AuditError): a.audit('ACinvalid', self.get)
    def test_wrong_account(self):
        with self.assertRaises(a.AuditError): a.audit(SID, lambda url: {'sid': 'ACother'})
    def test_no_replacement_number(self):
        def get(url):
            if '/IncomingPhoneNumbers.json?' in url: return {'incoming_phone_numbers': []}
            return self.get(url)
        with self.assertRaises(a.AuditError): a.audit(SID, get)
    def test_duplicate_services_not_modified(self):
        def get(url):
            if '/Services?' in url: return {'services': [{'friendly_name': 'Le Yard Guest Care'}] * 2}
            return self.get(url)
        self.assertEqual(a.audit(SID, get)['messaging_status'], 'existing_service_requires_resolution')
    def test_endpoint_allowlist(self):
        with self.assertRaises(a.AuditError): a.transport(SID, 'fake')('https://evil.example/test')
    def test_redirects_not_followed(self):
        with self.assertRaises(a.AuditError): a.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://evil.example')
if __name__ == '__main__': unittest.main()
