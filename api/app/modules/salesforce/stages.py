"""How a Salesforce stage is shown on the Pipeline.

Innowi's org has 13 active stages and ~29 stages that were switched off but
still hold ~680 deals ("Live", "Deployed - Closed", "Menu Created", ...).
Salesforce already marks every stage closed/won, so the rules are:

* closed + won                         -> "Won"
* closed, not won, a follow-up stage   -> "Follow up later"  (e.g. "60/90 days follow up")
* closed, not won                      -> "Lost"             (DNC, Disqualified, Cancelled, Closed Lost)
* open + active                        -> its own column, in Salesforce's order
* open + retired, deployment/approval  -> "In deployment"    (menus, Elavon/TekCard, ready to deploy ...)
* open + retired, anything else        -> "Other open"       (Incubation, Proposal, Negotiation ...)

Nothing here changes Salesforce; it only decides where a deal is drawn.
An unknown stage name (not in the synced stage list) is treated as a retired stage: it goes
to "Won" or "Lost" by the deal's own closed/won flags if it is closed, else "In deployment"
or "Other open" by the words above.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Protocol

WON = "won"
FOLLOW_UP = "follow_up"
LOST = "lost"
IN_DEPLOYMENT = "in_deployment"
OTHER_OPEN = "other_open"

GROUP_LABELS = {
    WON: "Won",
    FOLLOW_UP: "Follow up later",
    LOST: "Lost",
    IN_DEPLOYMENT: "In deployment",
    OTHER_OPEN: "Other open",
}

# Words that mark a retired open stage as part of deployment / processor approval.
_DEPLOYMENT_WORDS = ("deploy", "menu", "elavon", "tekcard", "install", "onboard", "training", "boost", "upsell", "kiosk")


class StageLike(Protocol):
    label: str
    sort_order: Optional[int]
    is_active: bool
    is_closed: bool
    is_won: bool


@dataclass(frozen=True)
class Column:
    key: str              # stable id for the column: "stage:<label>" or a group key
    label: str            # what the screen shows
    order: int            # left-to-right position
    is_open: bool         # open deals (counted in the pipeline) vs closed
    is_won: bool = False


def _stage_key(label: str) -> str:
    return f"stage:{label}"


def _retired_open(label: str) -> Column:
    lowered = label.lower()
    if any(word in lowered for word in _DEPLOYMENT_WORDS):
        return Column(key=IN_DEPLOYMENT, label=GROUP_LABELS[IN_DEPLOYMENT], order=700, is_open=True)
    return Column(key=OTHER_OPEN, label=GROUP_LABELS[OTHER_OPEN], order=800, is_open=True)


def column_for(stage: Optional[StageLike], stage_name: str) -> Column:
    """The Pipeline column a deal in `stage_name` belongs to.

    `stage` is None when a deal's stage is missing from Salesforce's stage list
    (seen in innowi33: "Submitted to Elavon", "Elavon Approved" - values renamed
    or removed after deals were saved with them). Those are treated as retired
    open stages; whether a deal is closed comes from the deal's own flags.
    """
    if stage is None:
        return _retired_open(stage_name)
    if stage.is_closed:
        if stage.is_won:
            return Column(key=WON, label=GROUP_LABELS[WON], order=900, is_open=False, is_won=True)
        if "follow" in stage.label.lower():
            return Column(key=FOLLOW_UP, label=GROUP_LABELS[FOLLOW_UP], order=910, is_open=False)
        return Column(key=LOST, label=GROUP_LABELS[LOST], order=920, is_open=False)
    if stage.is_active:
        return Column(key=_stage_key(stage.label), label=stage.label, order=stage.sort_order or 0, is_open=True)
    return _retired_open(stage.label)


def column_for_deal(stage: Optional[StageLike], stage_name: str, *, is_closed: bool, is_won: bool) -> Column:
    """Like column_for, but trusts the deal's own closed/won flags when its stage is unknown."""
    if stage is None and is_closed:
        if is_won:
            return Column(key=WON, label=GROUP_LABELS[WON], order=900, is_open=False, is_won=True)
        return Column(key=LOST, label=GROUP_LABELS[LOST], order=920, is_open=False)
    return column_for(stage, stage_name)


def stage_columns(stages: Iterable[StageLike]) -> dict[str, Column]:
    """{stage label: column} for every known stage."""
    return {stage.label: column_for(stage, stage.label) for stage in stages}


def ordered_columns(columns: Iterable[Column]) -> list[Column]:
    """Distinct columns, left to right."""
    unique: dict[str, Column] = {}
    for column in columns:
        unique.setdefault(column.key, column)
    return sorted(unique.values(), key=lambda c: (c.order, c.label))
