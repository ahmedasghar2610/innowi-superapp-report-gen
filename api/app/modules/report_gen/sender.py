"""Sending. REPORT_GEN_SEND_MODE decides what "send" does:

    dry-run   (default) nothing leaves: the recipients and the subject are recorded, the
              report stays approved, the response says what would have gone out
    sandbox   Phase 1: e-mail only to REPORT_GEN_SANDBOX_RECIPIENTS
    live      Phase 1: e-mail the merchant's own recipients

Phase 0 ships dry-run only; sandbox and live refuse with a clear message
rather than silently doing nothing. No third-party call happens here."""
from __future__ import annotations

from dataclasses import dataclass

from app.config import get_settings
from app.modules.report_gen.periods import Period

MODES = ("dry-run", "sandbox", "live")


class SendNotReady(Exception):
    pass


@dataclass
class SendResult:
    mode: str
    status: str  # dry_run | sent
    recipients: list[str]
    subject: str


def mode() -> str:
    m = (get_settings().REPORT_GEN_SEND_MODE or "dry-run").strip().lower()
    return m if m in MODES else "dry-run"


def sandbox_recipients() -> list[str]:
    raw = get_settings().REPORT_GEN_SANDBOX_RECIPIENTS or ""
    return [x.strip().lower() for x in raw.split(",") if "@" in x]


def subject_for(merchant_name: str, period: Period) -> str:
    return f"{merchant_name} — monthly report, {period.label}"


async def send(merchant_name: str, period: Period, recipients: list[str]) -> SendResult:
    """Deliver one approved report. Phase 0: dry-run only."""
    m = mode()
    subject = subject_for(merchant_name, period)
    if m == "dry-run":
        return SendResult(mode=m, status="dry_run", recipients=list(recipients), subject=subject)
    raise SendNotReady(f"Send mode '{m}' is not available yet: e-mail delivery arrives in Phase 1. Set REPORT_GEN_SEND_MODE=dry-run.")
