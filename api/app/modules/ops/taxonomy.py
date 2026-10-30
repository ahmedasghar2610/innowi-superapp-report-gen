"""Ticket types → categories → sub-categories, from the Ops CRM prototype v4.

Kept in code (not a table) for phase 1: the list is short, changes rarely,
and the API needs it to validate every create/update. The frontend reads it
from GET /ops/catalog, so there is still one source of truth. Move it to a
table with an admin screen if the team needs to edit it themselves.
"""
from __future__ import annotations

from app.models.enums import TicketType

TAXONOMY: dict[TicketType, dict] = {
    TicketType.MARKETING: {
        "label": "Marketing",
        "description": "Campaigns, promotions, social media, email and SMS support for merchants.",
        "categories": {
            "Campaign": ["Launch", "Seasonal", "Loyalty"],
            "Promotion / offer": ["Discount code", "Bundle", "Happy hour"],
            "Social media": ["Post schedule", "Review responses", "Ads creative"],
            "Email / SMS": ["Newsletter", "SMS blast", "Automation"],
        },
    },
    TicketType.DESIGN: {
        "label": "Design",
        "description": "Logos, menus, signage, social assets and other creative work for a merchant.",
        "categories": {
            "Logo": ["New logo", "Refresh existing", "Colour variants"],
            "Menu": ["Printed menu", "Digital menu board", "Menu update"],
            "Signage": ["Storefront", "Window", "Table tents"],
            "Social assets": ["Post templates", "Story set", "Cover images"],
            "Other": ["Other"],
        },
    },
    TicketType.WEBSITE: {
        "label": "Website",
        "description": "New sites, content updates, bugs, domains and hosting for merchant websites.",
        "categories": {
            "New site": ["Template build", "Custom build"],
            "Content update": ["Hours / contact", "Menu content", "Photos"],
            "Bug / fix": ["Broken page", "Mobile layout", "Forms / ordering"],
            "SEO fix": ["Ranking drop", "Missing metadata", "Page speed"],
            "Domain / hosting": ["Domain transfer", "SSL", "Renewal"],
        },
    },
    TicketType.INTERNAL: {
        "label": "Internal task",
        "description": "Internal work for the team, not tied to a merchant request (e.g. SuperApp build, approvals).",
        "categories": {
            "Process": ["Approval", "Documentation", "Template"],
            "Tooling": ["Access", "Integration"],
            "Other": ["Other"],
        },
    },
}


def validate_category(type_: TicketType, category: str, sub_category: str | None) -> str | None:
    """Returns an error message, or None when the combination is valid."""
    cats = TAXONOMY[type_]["categories"]
    if category not in cats:
        return f"'{category}' is not a {TAXONOMY[type_]['label']} category. Choose one of: {', '.join(cats)}"
    if sub_category is not None and sub_category not in cats[category]:
        return f"'{sub_category}' is not a sub-category of '{category}'. Choose one of: {', '.join(cats[category])}"
    return None


def catalog_payload() -> dict:
    from app.modules.ops.sla import policy_payload

    return {
        "sla": policy_payload(),
        "types": [
            {
                "type": t.value,
                "label": spec["label"],
                "description": spec["description"],
                "categories": [{"name": c, "subCategories": subs} for c, subs in spec["categories"].items()],
            }
            for t, spec in TAXONOMY.items()
        ]
    }
