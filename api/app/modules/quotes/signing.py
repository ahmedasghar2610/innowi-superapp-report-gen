"""Electronic signatures on quote revisions: what makes them hold up.

Under the U.S. ESIGN Act and UETA, an electronic signature is valid when four
things are true, and this module is where each one lives:

* Intent to sign - the signer performs a deliberate act: they adopt a drawn or
  typed signature and press a clearly labelled sign button (the UI), and the
  consent box they tick says what that act means (CONSENT_TEXT).
* Consent to do business electronically - CONSENT_TEXT, shown in full before
  signing and stored on the signature row with its version.
* Association of the signature with the record - every revision has a
  ``content_hash`` over exactly what is being agreed to (number, revision,
  parties, priced lines, totals, terms, consent version). A signature stores
  the hash it signed, and signing is refused when the client's copy is stale.
* Record retention - revisions and signatures are immutable rows; both parties
  get the signed PDF, which ends with a signature certificate page printing
  the hash, the signers' evidence (IP, user agent, timestamps) and the
  request's event trail.

The wording of CONSENT_TEXT is plain-English boilerplate, not legal advice;
have counsel review it before leaning on it in a dispute.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
from typing import Any

CONSENT_VERSION = "2026-10-21"

CONSENT_TEXT = (
    "By signing, I agree to do business electronically and to sign this document electronically. "
    "I have reviewed this proposal, including its terms and notes, and I agree that my electronic "
    "signature is the legal equivalent of my handwritten signature. Once signed by both parties, "
    "this proposal forms a binding agreement between the restaurant named on it and Innowi, Inc. "
    "for the initial term stated in the terms. I am authorized to sign on behalf of the party I sign for."
)

# A drawn signature arrives as a PNG data URL from a <canvas>.
_PNG_PREFIX = "data:image/png;base64,"
MAX_SIGNATURE_BYTES = 200_000


class SignatureDataError(ValueError):
    pass


def validate_signature_data(method: str, data: str) -> str:
    """Check (and return) the signature payload for one method.

    DRAWN: a PNG data URL, decoded size capped. TYPED: the adopted text.
    """
    if method == "TYPED":
        text = (data or "").strip()
        if not (2 <= len(text) <= 120):
            raise SignatureDataError("Type your full name to sign.")
        return text
    if method == "DRAWN":
        if not data.startswith(_PNG_PREFIX):
            raise SignatureDataError("The drawn signature must be a PNG image.")
        raw = data[len(_PNG_PREFIX):]
        try:
            decoded = base64.b64decode(raw, validate=True)
        except (binascii.Error, ValueError):
            raise SignatureDataError("The drawn signature image couldn't be read.")
        if not decoded.startswith(b"\x89PNG\r\n\x1a\n"):
            raise SignatureDataError("The drawn signature must be a PNG image.")
        if len(decoded) > MAX_SIGNATURE_BYTES:
            raise SignatureDataError("The drawn signature image is too large. Clear it and sign again.")
        if len(decoded) < 100:
            raise SignatureDataError("Please draw your signature before signing.")
        return data
    raise SignatureDataError("Signature method must be DRAWN or TYPED.")


def _line_core(line: dict[str, Any]) -> dict[str, Any]:
    return {
        "sku": line.get("sku"), "name": line.get("name"), "billing": line.get("billing"),
        "qty": line.get("qty"), "unitPrice": str(line.get("unitPrice")), "total": str(line.get("total")),
    }


def content_hash(
    *,
    number: str,
    rev_no: int,
    restaurant_name: str,
    contact_email: str,
    hardware_plan: str,
    lines: list[dict[str, Any]],
    totals: dict[str, Any],
    terms: list[str],
    consent_version: str = CONSENT_VERSION,
) -> str:
    """SHA-256 of exactly what a signature on this revision covers.

    Canonical JSON (sorted keys, no whitespace) over the commercial substance:
    the identifiers, each priced line, the totals, the terms and the consent
    version. Rendering details (detail text, list prices) are left out so a
    cosmetic change never silently invalidates a hash check.
    """
    payload = {
        "number": number,
        "rev": rev_no,
        "restaurant": restaurant_name,
        "contactEmail": contact_email,
        "plan": hardware_plan,
        "lines": [_line_core(line) for line in lines],
        "totals": {k: str(v) for k, v in sorted(totals.items())},
        "terms": list(terms),
        "consent": consent_version,
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(blob.encode()).hexdigest()
