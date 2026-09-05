#!/usr/bin/env python3
"""Read-only Twilio audit. Credentials stay in the runner; no guest data is read."""
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

NUMBER = "+13328779035"
ORIGIN = "https://operations.leyardny.com"
ALLOWED_HOSTS = {"api.twilio.com", "messaging.twilio.com"}

class AuditError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise AuditError("Provider redirect refused; no credential forwarded.")

def transport(account_sid, auth_token):
    encoded = base64.b64encode(f"{account_sid}:{auth_token}".encode()).decode()
    opener = urllib.request.build_opener(NoRedirect())
    def get(url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_HOSTS or parsed.username or parsed.password:
            raise AuditError("Unapproved provider endpoint.")
        req = urllib.request.Request(url, headers={"Authorization": f"Basic {encoded}", "Accept": "application/json"}, method="GET")
        try:
            with opener.open(req, timeout=15) as response:
                if response.status != 200:
                    raise AuditError(f"Provider read failed: HTTP {response.status}.")
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise AuditError(f"Provider read failed: HTTP {error.code}.") from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            raise AuditError("Provider connection or response could not be verified.") from None
    return get

def audit(account_sid, get):
    if not re.fullmatch(r"AC[0-9a-fA-F]{32}", account_sid):
        raise AuditError("Invalid Account SID.")
    root = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}"
    account = get(root + ".json")
    if account.get("sid") != account_sid:
        raise AuditError("Account identity mismatch.")
    page = get(root + "/IncomingPhoneNumbers.json?" + urllib.parse.urlencode({"PhoneNumber": NUMBER, "PageSize": 100}))
    numbers = [p for p in page.get("incoming_phone_numbers", []) if p.get("phone_number") == NUMBER]
    if len(numbers) != 1 or numbers[0].get("account_sid") != account_sid:
        raise AuditError("The Le Yard number was not uniquely found in this account. No replacement will be purchased.")
    phone = numbers[0]
    if not re.fullmatch(r"PN[0-9a-fA-F]{32}", phone.get("sid", "")):
        raise AuditError("Invalid phone resource identifier.")
    caps = {k.lower(): v is True for k, v in phone.get("capabilities", {}).items()}
    output = {"access": "verified", "number": NUMBER, "number_owned": True,
        "account_active": account.get("status") == "active", "account_type": account.get("type") if account.get("type") in ("Full", "Trial") else "other",
        "capabilities": {key: caps.get(key, False) for key in ("voice", "sms", "mms")},
        "voice_webhook_matches": phone.get("voice_url") == ORIGIN + "/api/twilio/voice/incoming" and phone.get("voice_method") == "POST",
        "mutations": 0, "calls_or_messages_sent": 0, "live_carrier_tests_passed": False}
    services_page = get("https://messaging.twilio.com/v1/Services?PageSize=100")
    services = [s for s in services_page.get("services", []) if s.get("friendly_name") == "Le Yard Guest Care"]
    output["matching_service_count_in_first_page"] = len(services)
    output["service_listing_has_more"] = bool(services_page.get("meta", {}).get("next_page_url"))
    if len(services) != 1:
        output["messaging_status"] = "existing_service_requires_resolution"
        return output
    service = services[0]
    sid = service.get("sid", "")
    if not re.fullmatch(r"MG[0-9a-fA-F]{32}", sid) or service.get("account_sid") != account_sid:
        raise AuditError("Messaging Service identity mismatch.")
    root = "https://messaging.twilio.com/v1/Services/" + sid
    senders_page = get(root + "/PhoneNumbers?PageSize=100")
    output["number_in_sender_pool"] = any(p.get("sid") == phone["sid"] for p in senders_page.get("phone_numbers", []))
    output["sender_listing_has_more"] = bool(senders_page.get("meta", {}).get("next_page_url"))
    registrations = get(root + "/Compliance/Usa2p?PageSize=100")
    states = {"IN_PROGRESS", "VERIFIED", "FAILED", "DELETED", "PENDING"}
    output["campaigns"] = [{"status": c.get("campaign_status") if c.get("campaign_status") in states else "unrecognized",
        "mock": c.get("mock") is True} for c in registrations.get("us_app_to_person", [])]
    output["messaging_webhook_matches"] = service.get("inbound_request_url") == ORIGIN + "/api/twilio/sms/incoming" and service.get("inbound_method") == "POST" and service.get("use_inbound_webhook_on_number") is False
    output["messaging_status"] = "read_only_audit_complete"
    return output

def main():
    missing = [key for key in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN") if not os.environ.get(key, "").strip()]
    code = 0
    if missing:
        result = {"access": "blocked", "missing_secret_names": missing, "mutations": 0, "calls_or_messages_sent": 0}
        code = 78
    else:
        try:
            sid, token = (os.environ[key].strip() for key in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"))
            result = audit(sid, transport(sid, token))
        except AuditError as error:
            result = {"access": "unverified", "error": str(error), "mutations": 0, "calls_or_messages_sent": 0}
            code = 1
        except Exception:
            result = {"access": "unverified", "error": "Unexpected audit failure; no raw provider response or secret will be logged.", "mutations": 0, "calls_or_messages_sent": 0}
            code = 1
    encoded = json.dumps(result, indent=2)
    print(encoded)
    directory = Path(os.environ.get("RUNNER_TEMP", "/tmp"))
    (directory / "twilio-account-audit.json").write_text(encoded, encoding="utf-8")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write("## Le Yard Twilio read-only audit\n```json\n" + encoded + "\n```\n")
    return code

if __name__ == "__main__":
    sys.exit(main())
