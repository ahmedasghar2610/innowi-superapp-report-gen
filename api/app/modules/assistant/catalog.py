"""Every change a person can make on the screens, as something the assistant can propose.

The hand-written action tools (actions.py) cover the common partner-lead, quote
and roadmap changes with tailored cards. This module covers everything else with
one catalog, so the assistant can do what the signed-in person can do and no more:

* OPERATIONS lists the API's write endpoints by (method, path). Nothing else: the
  model picks an operation and supplies ids and fields, never a path.
* The permission an operation needs is read from the route itself (its
  require_capability dependencies), so it can't drift from what the screens enforce.
  change_options only lists operations the person's role holds; propose_change
  refuses the rest; and the endpoint checks again when the change is confirmed.
* Fields are validated with the endpoint's own request model at proposal time.
* Ids in the path, and any *Id field in the body, must be ids a lookup returned in
  this same answer (ctx.seen_ids), as with the other action tools.
* Nothing changes until the person clicks Confirm on the card; the change is then
  replayed against the API as that person (router.confirm_action).

tests/test_assistant_catalog.py fails if a write endpoint is added without being put
in OPERATIONS, COVERED (a hand-written tool does it) or EXCLUDED (with the reason).
"""
from __future__ import annotations

import json
import re
from urllib.parse import quote
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Optional

from pydantic import BaseModel, ValidationError
from sqlalchemy import text

from app.common.capabilities import has_capability
from app.db.schemas import qualified
from app.modules.assistant.tools_base import Ctx, Tool, ToolError, jsonable, limit_arg, text_arg

MAX_CHANGES = 25


# ------------------------------------------------------------ records ----
@dataclass(frozen=True)
class Entity:
    """A kind of record: how to find it (find_records), name it on a card, and who may read it."""

    name: str
    capability: str
    table: str            # schema.table with the plain schema name (qualified at query time)
    label: str            # SQL expression naming one row
    columns: str          # extra columns returned by find_records (SQL select list, aliased in camelCase)
    search: tuple[str, ...] = ()
    parent: Optional[str] = None   # column holding the merchant id, for find_records(merchant_id=...)
    where: str = "true"
    id_col: str = "id"
    order: str = "1"

    def sql_table(self) -> str:
        schema, tbl = self.table.split(".", 1)
        return f"{qualified(schema)}.{tbl}" if schema != "public" else self.table


ENTITIES: dict[str, Entity] = {e.name: e for e in (
    Entity("merchant", "profile.view", "profiling.merchant", "restaurant_name_dba",
           "merchant_code as code, legal_name as \"legalName\", cuisine_category as cuisine, account_health as health",
           search=("restaurant_name_dba", "merchant_code", "legal_name")),
    Entity("contact", "profile.view", "profiling.contact", "name",
           "merchant_id as \"merchantId\", role, email, phone", search=("name", "email"), parent="merchant_id"),
    Entity("location", "profile.view", "profiling.location", "concat_ws(', ', address, city, state)",
           "merchant_id as \"merchantId\", address, city, state, zip, is_primary as \"isPrimary\"",
           search=("address", "city"), parent="merchant_id"),
    Entity("keyword", "profile.view", "profiling.keyword", "term", "merchant_id as \"merchantId\", type",
           search=("term",), parent="merchant_id"),
    Entity("competitor", "profile.view", "profiling.competitor", "name", "merchant_id as \"merchantId\", rank",
           search=("name",), parent="merchant_id"),
    Entity("connection", "profile.view", "profiling.access_item", "access_item",
           "merchant_id as \"merchantId\", criticality, status, owner", search=("access_item",), parent="merchant_id"),
    Entity("merchant_service", "profile.view", "profiling.merchant_service",
           f"coalesce((select s.name from {{catalog}}.service s where s.id = t.service_id), t.service_id)",
           "merchant_id as \"merchantId\", service_id as \"serviceId\", status", parent="merchant_id"),
    Entity("service", "profile.view", "catalog.service", "name", "category, owner_team as \"ownerTeam\"",
           search=("name", "category")),
    Entity("promotion", "profile.view", "marketing.promotion", "promo_name",
           "merchant_id as \"merchantId\", status, start_date as \"startDate\", end_date as \"endDate\"",
           search=("promo_name",), parent="merchant_id"),
    Entity("document", "profile.view", "profiling.document", "file_name",
           "merchant_id as \"merchantId\", category, status", search=("file_name",), parent="merchant_id"),
    Entity("brand_asset", "profile.view", "profiling.brand_asset", "name",
           "merchant_id as \"merchantId\", type, status", search=("name",), parent="merchant_id"),
    Entity("account_manager", "profile.view", "profiling.account_manager", "name", "team, email",
           search=("name", "email")),
    Entity("website", "website.view", "marketing.website", "name",
           "slug, status, merchant_id as \"merchantId\", contact_email as \"contactEmail\"",
           search=("name", "slug")),
    Entity("user", "users.manage", "auth.user", "coalesce(nullif(btrim(concat_ws(' ', first_name, last_name)), ''), email)",
           "email, role, status", search=("email", "first_name", "last_name"), id_col="id"),
    Entity("invitation", "users.manage", "auth.invitation", "email",
           "email, role, expires_at as \"expiresAt\"", search=("email",),
           where="accepted_at is null and revoked_at is null"),
    Entity("price_item", "quotes.view", "quotes.price_item", "name",
           "sku, section, kind, monthly_price as monthly, purchase_price as purchase, lease_price as lease, active",
           search=("name", "sku")),
    Entity("quote_link", "quotes.view", "quotes.quote_link", "restaurant_name",
           "mode, status, contact_email as \"contactEmail\", expires_at as \"expiresAt\"", search=("restaurant_name", "contact_email")),
    Entity("roadmap_phase", "roadmap.view", "roadmap.phase", "name", "goal, start_month as \"from\", end_month as \"to\"",
           search=("name",)),
    Entity("sales_person", "sales.manage", "salesforce.sf_user", "name",
           "email, is_active as active, role_name as \"sfRole\"", search=("name", "email")),
)}


# --------------------------------------------------------- operations ----
@dataclass(frozen=True)
class Op:
    key: str
    method: str
    path: str                       # API path below /api/v1, with {params}
    does: str                       # one line, for change_options and the card title
    area: str
    params: dict[str, Optional[str]] = field(default_factory=dict)  # path param -> entity (None = not an id)
    destructive: bool = False
    # Response fields shown once on the card after Confirm (never saved, never sent to the model).
    reveal: tuple[str, ...] = ()
    # Rules the endpoint checks inside (not as a route dependency): (capability or "", what it limits).
    # change_options shows a capability-bound one only to roles without that capability.
    limits: tuple[tuple[str, str], ...] = ()


AREAS = {
    "merchants": "Merchants and their profile fields",
    "merchant_records": "A merchant's contacts, locations, keywords, competitors, connections, services, "
                        "promotions, documents, brand assets, brand and catering profiles, subscription",
    "websites": "Restaurant websites",
    "quotes": "Quote links and the price list",
    "roadmap": "Roadmap phases",
    "team": "Super App logins, invitations and the partner team",
    "partners": "Partner Network contacts",
    "sales": "Salesforce people (logins and links) and the sync",
    "account_managers": "Account managers",
}


def _crud(entity: str, plural: str, area: str, *, create: bool = True, nice: Optional[str] = None) -> list[Op]:
    nice = nice or entity.replace("_", " ")
    ops = []
    if create:
        ops.append(Op(f"{entity}.create", "POST", f"/merchants/{{merchant_id}}/{plural}", f"Add a {nice} to a merchant",
                      area, {"merchant_id": "merchant"}))
    ops += [
        Op(f"{entity}.update", "PATCH", f"/{plural}/{{id}}", f"Change a {nice}", area, {"id": entity if entity != "service" else "merchant_service"}),
        Op(f"{entity}.delete", "DELETE", f"/{plural}/{{id}}", f"Delete a {nice}", area,
           {"id": entity if entity != "service" else "merchant_service"}, destructive=True),
    ]
    return ops


_NO_DISCOUNT = "This role can't give special pricing (discountPercent above 0, or per-item price changes)."

OPERATIONS: list[Op] = [
    Op("merchant.create", "POST", "/merchants", "Create a merchant", "merchants"),
    Op("merchant.update", "PATCH", "/merchants/{id}", "Change a merchant's details", "merchants", {"id": "merchant"}),
    Op("merchant.delete", "DELETE", "/merchants/{id}", "Delete a merchant and everything on its profile", "merchants",
       {"id": "merchant"}, destructive=True),
    Op("merchant.field.update", "PATCH", "/merchants/{id}/fields/{key}", "Set one profile field (by field key)",
       "merchants", {"id": "merchant", "key": None}),
    Op("merchant.field.attest", "POST", "/merchants/{id}/fields/{key}/attest", "Mark one profile field as verified",
       "merchants", {"id": "merchant", "key": None}),
    *_crud("contact", "contacts", "merchant_records"),
    *_crud("location", "locations", "merchant_records"),
    *_crud("keyword", "keywords", "merchant_records"),
    *_crud("competitor", "competitors", "merchant_records"),
    *_crud("connection", "connections", "merchant_records", nice="connection (access item)"),
    *_crud("service", "services", "merchant_records", nice="service"),
    *_crud("promotion", "promotions", "merchant_records"),
    *_crud("document", "documents", "merchant_records", nice="document record"),
    *_crud("brand_asset", "brand-assets", "merchant_records", create=False, nice="brand asset"),
    Op("brand_profile.update", "PATCH", "/merchants/{merchant_id}/brand-profile", "Set a merchant's brand profile",
       "merchant_records", {"merchant_id": "merchant"}),
    Op("catering_profile.update", "PATCH", "/merchants/{merchant_id}/catering-profile", "Set a merchant's catering profile",
       "merchant_records", {"merchant_id": "merchant"}),
    Op("subscription.update", "PATCH", "/merchants/{merchant_id}/subscription", "Set a merchant's subscription",
       "merchant_records", {"merchant_id": "merchant"}),
    Op("account_manager.create", "POST", "/account-managers", "Add an account manager", "account_managers"),
    Op("account_manager.update", "PATCH", "/account-managers/{id}", "Change an account manager", "account_managers",
       {"id": "account_manager"}),
    Op("website.create", "POST", "/websites", "Create a restaurant website", "websites",
       limits=(("website.publish", "This role can't create a site straight into a public status (Live / Update required)."),)),
    Op("website.update", "PATCH", "/websites/{key}", "Change a website (details, status)", "websites", {"key": "website"},
       limits=(("website.publish", "This role can't make a site public, take it out of public, or set it Inactive."),)),
    Op("website.delete", "DELETE", "/websites/{key}", "Delete a website (its public address stops working)", "websites",
       {"key": "website"}, destructive=True),
    Op("website.link", "POST", "/websites/{key}/link", "Link a website to a merchant", "websites", {"key": "website"}),
    Op("website.unlink", "DELETE", "/websites/{key}/link", "Unlink a website from its merchant", "websites",
       {"key": "website"}, destructive=True),
    Op("website.create_merchant", "POST", "/websites/{key}/merchant", "Create a merchant from a website", "websites",
       {"key": "website"}),
    Op("website.preview_link", "POST", "/websites/{key}/preview-link", "Make a private preview link for a website",
       "websites", {"key": "website"}, reveal=("url",)),
    Op("partner_team.update", "PATCH", "/partner-leads/team/{email}",
       "Change someone's partner-lead settings (can be given leads, gets new-lead e-mails)",
       "team", {"email": "team_member"}),
    Op("partner_contact.create", "POST", "/partner-contacts", "Add a Partner Network contact", "partners"),
    Op("invitation.create", "POST", "/invitations", "Invite someone to the Super App by e-mail (with a role)", "team",
       reveal=("inviteUrl", "emailed"),
       limits=(("", "Role can be ADMIN, MARKETING_MANAGER, MARKETING_EXECUTIVE, SALES_MANAGER or SALES_EXECUTIVE."),)),
    Op("invitation.resend", "POST", "/invitations/{id}/resend", "Re-send an invitation e-mail (new link)", "team",
       {"id": "invitation"}, reveal=("inviteUrl", "emailed")),
    Op("invitation.revoke", "DELETE", "/invitations/{id}", "Cancel a pending invitation", "team", {"id": "invitation"},
       destructive=True),
    Op("user.update", "PATCH", "/users/{id}", "Change someone's role, name, or turn their login off/on", "team",
       {"id": "user"},
       limits=(("", "Nobody can change their own role or status. Only a Super Admin can make someone a Super Admin "
                    "or change a Super Admin's login."),)),
    Op("user.delete", "DELETE", "/users/{id}", "Delete a Super App login", "team", {"id": "user"}, destructive=True),
    Op("sales_person.create_login", "POST", "/sales/people/{sf_user_id}/login",
       "Create a Super App login for a Salesforce person (temporary password shown once)", "sales",
       {"sf_user_id": "sales_person"}, reveal=("temporaryPassword",)),
    Op("sales_person.link", "PUT", "/sales/people/{sf_user_id}/link", "Link a Super App login to a Salesforce person",
       "sales", {"sf_user_id": "sales_person"}),
    Op("sales_person.unlink", "DELETE", "/sales/people/{sf_user_id}/link", "Unlink a login from a Salesforce person",
       "sales", {"sf_user_id": "sales_person"}, destructive=True),
    Op("sales.sync_run", "POST", "/sales/sync/run", "Copy the latest changes from Salesforce now", "sales"),
    Op("price_item.create", "POST", "/quotes/price-list", "Add an item to the price list", "quotes"),
    Op("price_item.update", "PATCH", "/quotes/price-list/{id}", "Change a price-list item (prices, active)", "quotes",
       {"id": "price_item"}),
    Op("quote_link.create", "POST", "/quotes/links", "Create a quote link for a restaurant (link shown once)", "quotes",
       reveal=("url",), limits=(("quotes.discount", _NO_DISCOUNT),)),
    Op("quote_link.update", "PATCH", "/quotes/links/{id}", "Change a quote link", "quotes", {"id": "quote_link"},
       limits=(("quotes.discount", _NO_DISCOUNT),)),
    Op("quote_link.new_url", "POST", "/quotes/links/{id}/new-url",
       "Give a quote link a new address (the old one stops working; new one shown once)", "quotes",
       {"id": "quote_link"}, destructive=True, reveal=("url",)),
    Op("roadmap_phase.create", "POST", "/roadmap/phases", "Add a roadmap phase", "roadmap"),
    Op("roadmap_phase.update", "PATCH", "/roadmap/phases/{phase_id}", "Change a roadmap phase", "roadmap",
       {"phase_id": "roadmap_phase"}),
    Op("roadmap_phase.delete", "DELETE", "/roadmap/phases/{phase_id}", "Delete a roadmap phase", "roadmap",
       {"phase_id": "roadmap_phase"}, destructive=True),
]
BY_KEY: dict[str, Op] = {o.key: o for o in OPERATIONS}

# Write endpoints a hand-written action tool already does (with a tailored card).
COVERED: dict[tuple[str, str], str] = {
    ("PATCH", "/partner-leads/{id}"): "propose_partner_leads_update",
    ("POST", "/partner-leads/{id}/notes"): "propose_partner_lead_note",
    ("DELETE", "/partner-leads/{id}"): "propose_partner_leads_delete",
    ("PATCH", "/partner-contacts/{id}"): "propose_partner_contacts_update",
    ("POST", "/partner-contacts/{id}/promote"): "propose_partner_contact_promote",
    ("POST", "/quotes/links/{id}/revoke"): "propose_quote_links_revoke",
    ("PATCH", "/quotes/requests/{id}"): "propose_quote_request_update",
    ("POST", "/roadmap/items"): "propose_roadmap_item_create",
    ("PATCH", "/roadmap/items/{item_id}"): "propose_roadmap_item_update",
    ("DELETE", "/roadmap/items/{item_id}"): "propose_roadmap_items_delete",
}

# Write endpoints the assistant never calls, and why.
EXCLUDED: dict[tuple[str, str], str] = {
    # Team requests: people send and discuss their own requests on the Requests page;
    # triage decisions (approve onto the roadmap, decline) stay a person's click.
    ("POST", "/requests"): "a person's own request; use the Requests page",
    ("PATCH", "/requests/{ref}"): "editing a request; use the Requests page",
    ("POST", "/requests/{ref}/vote"): "upvotes are a person's own; use the Requests page",
    ("DELETE", "/requests/{ref}/vote"): "upvotes are a person's own; use the Requests page",
    ("POST", "/requests/{ref}/comments"): "comments are a person's own words; use the Requests page",
    ("POST", "/requests/{ref}/status"): "triage decision; use the Requests page",
    ("POST", "/requests/{ref}/approve"): "triage decision (creates a roadmap item); use the Requests page",
    # Churned accounts (win-back list): a future assistant feature; for now the screen.
    ("POST", "/churn/import"): "file upload; use the Churned accounts screen",
    ("POST", "/churn/{merchant_id}"): "marks a merchant churned; use the merchant screen",
    ("PATCH", "/churn/{merchant_id}"): "win-back fields; use the Churned accounts screen",
    ("POST", "/churn/{merchant_id}/notes"): "win-back notes; use the Churned accounts screen",
    # The spine (organizations + deals): a future assistant feature; for now the Deals / Organizations screens.
    ("POST", "/organizations"): "creates a partner/contractor organization; use the Organizations screen",
    ("PATCH", "/organizations/{org_id}"): "organization fields; use the Organizations screen",
    ("POST", "/organizations/{org_id}/contacts"): "organization contacts; use the Organizations screen",
    ("PATCH", "/organizations/{org_id}/contacts/{contact_id}"): "organization contacts; use the Organizations screen",
    ("DELETE", "/organizations/{org_id}/contacts/{contact_id}"): "organization contacts; use the Organizations screen",
    ("POST", "/organizations/assign"): "bulk hand-out of partners/agents to salespeople, previewed on the Organizations screen",
    ("POST", "/organizations/from-lead/{lead_id}"): "turns a partner lead into an organization; use the Partner leads screen",
    ("POST", "/organizations/from-card/{contact_id}"): "turns a business card into an organization; use the Network screen",
    ("POST", "/organizations/{org_id}/agents"): "adds an ISO's agent list; use the ISO's page",
    ("POST", "/organizations/{org_id}/notes"): "organization timeline notes; use the Organizations screen",
    ("POST", "/deals"): "creates a deal (and possibly a merchant); use the Deals screen",
    ("PATCH", "/deals/{deal_id}"): "stage changes move the merchant's status; use the Deals screen",
    ("POST", "/deals/{deal_id}/notes"): "deal notes; use the Deals screen",
    ("POST", "/deals/{deal_id}/link-quote"): "attaches a quote link to a deal; use the Deals screen",
    ("POST", "/auth/login"): "signing in",
    ("POST", "/auth/refresh"): "session plumbing",
    ("POST", "/auth/logout"): "session plumbing",
    ("POST", "/auth/logout-all"): "signs the person out everywhere; do it on the screen",
    ("POST", "/auth/change-password"): "passwords never go through the chat",
    ("POST", "/auth/invitations/accept"): "done by the invited person on the invite page",
    ("POST", "/users"): "needs a password in the chat; invite people instead (invitation.create)",
    ("POST", "/merchants/{merchant_id}/documents/upload"): "file upload; use the merchant screen",
    ("POST", "/merchants/{merchant_id}/brand-assets/upload"): "file upload; use the merchant screen",
    ("POST", "/websites/import-docx"): "file upload; use the websites screen",
    ("POST", "/websites/assets"): "file upload; use the websites screen",
    ("POST", "/websites/{key}/admin/login"): "the website editor's own login",
    ("PUT", "/websites/{key}/content"): "the website editor (its own login and screen)",
    ("DELETE", "/websites/{key}/content"): "the website editor (its own login and screen)",
    ("POST", "/websites/{key}/content/assets"): "the website editor (file upload)",
    ("POST", "/quotes/links/{id}/price"): "a price preview, changes nothing",
    ("POST", "/sales/sync/cron"): "the scheduled sync (token, not a person)",
    ("POST", "/public/partner-leads/action"): "the e-mail buttons' public page",
    ("POST", "/public/quotes/{token}/price"): "the restaurant's public quote page",
    ("POST", "/public/quotes/{token}/requests"): "the restaurant's public quote page",
    ("POST", "/public/quotes/{token}/requests/{id}/sign"): "the restaurant's public quote page (their signature)",
    ("POST", "/public/quotes/{token}/requests/{id}/decline"): "the restaurant's public quote page",
    ("POST", "/quotes/requests/{id}/revise"): "a counter-offer: build it on the request's revise screen",
    ("POST", "/quotes/requests/{id}/countersign"): "a signature: only the person signs, on the request screen",
    ("PATCH", "/assistant/chats/{chat_id}"): "the assistant's own chats",
    ("DELETE", "/assistant/chats/{chat_id}"): "the assistant's own chats",
    ("POST", "/assistant/chat"): "the assistant itself",
    ("POST", "/assistant/actions/{action_id}/confirm"): "only the person's click confirms",
    ("POST", "/assistant/actions/{action_id}/cancel"): "only the person cancels",
    # Ops CRM, settings, SEO, GBP and Google Ads (developer import, 2026-10-19).
    ("POST", "/ads/accounts"): "Google Ads: not offered by the assistant yet; use the Google Ads screens",
    ("POST", "/ads/accounts/import"): "file upload; use the screen",
    ("PATCH", "/ads/accounts/{account_id}"): "Google Ads: not offered by the assistant yet; use the Google Ads screens",
    ("POST", "/ads/accounts/{account_id}/comments"): "Google Ads: not offered by the assistant yet; use the Google Ads screens",
    ("DELETE", "/ads/accounts/{account_id}/merchant"): "Google Ads: not offered by the assistant yet; use the Google Ads screens",
    ("PUT", "/ads/accounts/{account_id}/merchant"): "Google Ads: not offered by the assistant yet; use the Google Ads screens",
    ("DELETE", "/ads/comments/{comment_id}"): "Google Ads: not offered by the assistant yet; use the Google Ads screens",
    ("PATCH", "/ads/comments/{comment_id}"): "Google Ads: not offered by the assistant yet; use the Google Ads screens",
    ("POST", "/ads/connect"): "Google sign-in happens on the Integrations screen",
    ("DELETE", "/ads/connection"): "Google sign-in happens on the Integrations screen",
    ("DELETE", "/ads/sample-data"): "demo data; load or clear it on its screen",
    ("POST", "/ads/sample-data"): "demo data; load or clear it on its screen",
    ("POST", "/ads/sync"): "long-running sync; start it on its screen",
    ("POST", "/gbp/connect"): "Google sign-in happens on the Integrations screen",
    ("DELETE", "/gbp/connection"): "Google sign-in happens on the Integrations screen",
    ("DELETE", "/gbp/locations/{location_id}/merchant"): "GBP: not offered by the assistant yet; use the GBP screens",
    ("PUT", "/gbp/locations/{location_id}/merchant"): "GBP: not offered by the assistant yet; use the GBP screens",
    ("POST", "/gbp/locations/{location_id}/notes"): "GBP: not offered by the assistant yet; use the GBP screens",
    ("DELETE", "/gbp/notes/{note_id}"): "GBP: not offered by the assistant yet; use the GBP screens",
    ("PATCH", "/gbp/notes/{note_id}"): "GBP: not offered by the assistant yet; use the GBP screens",
    ("DELETE", "/gbp/sample-data"): "demo data; load or clear it on its screen",
    ("POST", "/gbp/sample-data"): "demo data; load or clear it on its screen",
    ("POST", "/gbp/sync"): "long-running sync; start it on its screen",
    ("POST", "/integrations/fathom/webhook"): "Fathom's webhook (signed, not a person)",
    ("POST", "/jobs/{job}"): "the scheduler (token, not a person)",
    ("POST", "/integrations/teams/availability"): "the Power Automate availability flow (secret key, not a person)",
    ("POST", "/merchants/{merchant_id}/menu/extract"): "long-running sync; start it on its screen",
    ("POST", "/merchants/import"): "imports a whole spreadsheet; done on the Merchants screen with its preview",
    ("POST", "/merchant-payments/import"): "imports a whole revenue report; done on the Merchants screen with its preview",
    ("POST", "/merchants/{merchant_id}/payments"): "Payments: not offered by the assistant yet; use the merchant's Payments tab",
    ("PATCH", "/merchant-payments/{payment_id}"): "Payments: not offered by the assistant yet; use the merchant's Payments tab",
    ("DELETE", "/merchant-payments/{payment_id}"): "Payments: not offered by the assistant yet; use the merchant's Payments tab",
    ("POST", "/merchants/connect"): "links many records at once; done on the Merchants / Data setup screens",
    ("POST", "/merchants/{merchant_id}/links"): "Connector: not offered by the assistant yet; use the merchant's SEO / Ads tabs",
    ("DELETE", "/merchants/{merchant_id}/links/{module}/{entity_id}"): "Connector: not offered by the assistant yet; use the merchant's SEO / Ads tabs",
    ("PUT", "/settings/connector"): "settings; change them on the Settings screens",
    ("POST", "/merchant-menus/check"): "long-running sync; start it on its screen",
    ("POST", "/merchant-menus/fetch"): "long-running sync; start it on its screen",
    ("PUT", "/merchant-menus/{merchant_id}/link"): "Menu: not offered by the assistant yet; use the Menu screens",
    ("DELETE", "/ops/attachments/{attachment_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/catch-up/dismiss"): "the person's own inbox and saved views",
    ("POST", "/ops/credentials"): "the passwords vault never goes through the chat",
    ("DELETE", "/ops/credentials/{cred_id}"): "the passwords vault never goes through the chat",
    ("PATCH", "/ops/credentials/{cred_id}"): "the passwords vault never goes through the chat",
    ("POST", "/ops/credentials/{cred_id}/reveal"): "the passwords vault never goes through the chat",
    ("POST", "/ops/library"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("DELETE", "/ops/library/{page_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("PATCH", "/ops/library/{page_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/meetings/sync"): "long-running sync; start it on its screen",
    ("DELETE", "/ops/meetings/{meeting_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("PATCH", "/ops/meetings/{meeting_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/meetings/{meeting_id}/actions/{action_id}/dismiss"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/meetings/{meeting_id}/actions/{action_id}/reopen"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/notifications/read"): "the person's own inbox and saved views",
    ("POST", "/ops/teams/test"): "sends a real Teams message (a setup check, not a change)",
    ("POST", "/ops/teams/digest"): "posts to the Teams channel (admin setup action)",
    ("POST", "/ops/teams/meeting"): "sends real Outlook / Teams invites to other people",
    ("POST", "/ops/projects"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("PATCH", "/ops/projects/{project_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("DELETE", "/ops/subtasks/{subtask_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("PATCH", "/ops/subtasks/{subtask_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/tickets"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("DELETE", "/ops/tickets/{key}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("PATCH", "/ops/tickets/{key}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/tickets/{key}/attachments"): "file upload; use the screen",
    ("POST", "/ops/tickets/{key}/comments"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/tickets/{key}/library"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("DELETE", "/ops/tickets/{key}/library/{page_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/tickets/{key}/subtasks"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/tickets/{key}/watchers"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("DELETE", "/ops/tickets/{key}/watchers/{user_id}"): "Ops CRM: not offered by the assistant yet; use the Ops CRM screens",
    ("POST", "/ops/views"): "the person's own inbox and saved views",
    ("DELETE", "/ops/views/{view_id}"): "the person's own inbox and saved views",
    ("POST", "/seo/connect"): "Google sign-in happens on the Integrations screen",
    ("DELETE", "/seo/connection"): "Google sign-in happens on the Integrations screen",
    ("POST", "/seo/email/test"): "sends to or signs off for a client; done on the report screen",
    ("PATCH", "/seo/findings/{finding_id}"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("DELETE", "/seo/keywords/{keyword_id}"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("POST", "/seo/kpis"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("DELETE", "/seo/kpis/{key}"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("PATCH", "/seo/kpis/{key}"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("PATCH", "/seo/reports/{report_id}/next-steps"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("POST", "/seo/reports/{report_id}/send"): "sends to or signs off for a client; done on the report screen",
    ("POST", "/seo/reports/{report_id}/sign-off"): "sends to or signs off for a client; done on the report screen",
    ("DELETE", "/seo/sample-data"): "demo data; load or clear it on its screen",
    ("POST", "/seo/sample-data"): "demo data; load or clear it on its screen",
    ("POST", "/seo/sites"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("DELETE", "/seo/sites/{site_id}"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("PATCH", "/seo/sites/{site_id}"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("POST", "/seo/sites/{site_id}/keywords"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("POST", "/seo/sites/{site_id}/reports"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("POST", "/seo/sites/{site_id}/rescore"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("POST", "/seo/sites/{site_id}/pagespeed"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("PUT", "/seo/blogs/schedule"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("POST", "/seo/blogs/refresh"): "long-running sync; start it on its screen",
    ("POST", "/seo/crawler/crawl"): "queues Screaming Frog crawls on the helper PCs; start it on the SEO screen",
    ("POST", "/seo/crawler/jobs/{job_id}/cancel"): "crawl queue control, on the SEO screen",
    ("POST", "/seo/crawler/keys"): "creates a crawler secret shown once; done in Settings → Integrations",
    ("DELETE", "/seo/crawler/keys/{key_id}"): "revokes a crawler key; done in Settings → Integrations",
    ("POST", "/seo/crawler/jobs/{job_id}/status"): "called by the crawler helper with its key, not by people",
    ("POST", "/seo/crawler/jobs/{job_id}/result"): "called by the crawler helper with its key (zip upload), not by people",
    ("PUT", "/seo/blogs/sites/{site_id}/brand-terms"): "SEO: not offered by the assistant yet; use the SEO screens",
    ("PATCH", "/seo/reports/{report_id}/summary"): "SEO: not offered by the assistant yet; use the SEO screens",
    # Merchant Reports (modules/report_gen): drafts are reviewed, approved and sent on the report screen only.
    ("POST", "/report-gen/merchants/{merchant_id}/reports"): "merchant reports: generated and reviewed on the Merchant Reports screen",
    ("PATCH", "/report-gen/reports/{report_id}/text"): "merchant reports: edited on the Merchant Reports screen",
    ("POST", "/report-gen/reports/{report_id}/approve"): "sends to or signs off for a client; done on the report screen",
    ("DELETE", "/report-gen/reports/{report_id}"): "merchant reports: deleted on the Merchant Reports screen",
    ("POST", "/report-gen/reports/{report_id}/send"): "sends to or signs off for a client; done on the report screen",
    ("POST", "/seo/sync"): "long-running sync; start it on its screen",
    ("POST", "/settings/data-setup/apply"): "settings; change them on the Settings screens",
    ("POST", "/settings/data-setup/refresh"): "long-running sync; start it on its screen",
    ("POST", "/settings/data-setup/undo"): "settings; change them on the Settings screens",
    ("PATCH", "/settings/me"): "settings; change them on the Settings screens",
    ("DELETE", "/settings/me/sessions/{session_id}"): "settings; change them on the Settings screens",
    ("DELETE", "/settings/sla"): "settings; change them on the Settings screens",
    ("PUT", "/settings/sla"): "settings; change them on the Settings screens",
    ("PUT", "/settings/workspace"): "settings; change them on the Settings screens",
    ("POST", "/users/{id}/reset-password"): "passwords never go through the chat",
}


# ------------------------------------------------------ route introspection ----
@dataclass
class RouteInfo:
    capabilities: frozenset[str]
    body: Optional[type[BaseModel]]


def _route_capabilities(dependant) -> set[str]:
    out: set[str] = set()
    for sub in dependant.dependencies:
        call = sub.call
        if getattr(call, "__name__", "") == "_check" and getattr(call, "__closure__", None):
            for cell in call.__closure__:
                if isinstance(cell.cell_contents, str):
                    out.add(cell.cell_contents)
        out |= _route_capabilities(sub)
    return out


def walk_routes(app) -> list[tuple[str, str, Any]]:
    """(method, path below /api/v1, route) for every write route, sub-routers included."""
    from fastapi.routing import APIRoute

    found: list[tuple[str, str, Any]] = []

    def walk(routes, prefix=""):
        for r in routes:
            if isinstance(r, APIRoute):
                path = (prefix + r.path).removeprefix("/api/v1")
                for m in r.methods:
                    if m in ("POST", "PUT", "PATCH", "DELETE"):
                        found.append((m, path, r))
            elif type(r).__name__ == "_IncludedRouter":
                walk(r.original_router.routes, prefix + (getattr(r.include_context, "prefix", "") or ""))
            elif hasattr(r, "routes") and hasattr(r, "path"):
                walk(r.routes, prefix + r.path)

    walk(app.routes)
    return found


@lru_cache(maxsize=1)
def route_table() -> dict[tuple[str, str], RouteInfo]:
    from app.main import app

    table: dict[tuple[str, str], RouteInfo] = {}
    for method, path, r in walk_routes(app):
        body = None
        if r.body_field is not None:
            t = getattr(r.body_field, "type_", None) or getattr(getattr(r.body_field, "field_info", None), "annotation", None)
            if isinstance(t, type) and issubclass(t, BaseModel):
                body = t
        table[(method, path)] = RouteInfo(frozenset(_route_capabilities(r.dependant)), body)
    return table


def info(op: Op) -> RouteInfo:
    ri = route_table().get((op.method, op.path))
    if ri is None:  # tests make sure this can't happen
        raise ToolError(f"{op.key} isn't available on this server.")
    return ri


def allowed(ctx: Ctx, op: Op) -> bool:
    caps = info(op).capabilities
    # Every catalog route requires at least one capability (tested); none = refuse.
    return bool(caps) and all(has_capability(ctx.user.role, c) for c in caps)


# ------------------------------------------------------------ field docs ----
def _compact(schema: dict, defs: dict, depth: int = 0) -> Any:
    if "$ref" in schema:
        target = defs.get(schema["$ref"].rsplit("/", 1)[-1], {})
        return _compact(target, defs, depth)
    if "anyOf" in schema:
        parts = [p for p in schema["anyOf"] if p.get("type") != "null"]
        inner = _compact(parts[0], defs, depth) if len(parts) == 1 else " | ".join(
            str(_compact(p, defs, depth)) for p in parts)
        return inner if isinstance(inner, (dict, list)) else f"{inner} (or null)"
    if "enum" in schema:
        return "one of: " + ", ".join(map(str, schema["enum"]))
    t = schema.get("type")
    if t == "object" and "properties" in schema:
        if depth >= 2:
            return "object"
        req = set(schema.get("required", []))
        return {(k + ("*" if k in req else "")): _compact(v, defs, depth + 1) for k, v in schema["properties"].items()}
    if t == "array":
        return [_compact(schema.get("items", {}), defs, depth + 1)]
    bits = [t or "any"]
    if schema.get("format"):
        bits.append(schema["format"])
    for k in ("maxLength", "minimum", "maximum"):
        if k in schema:
            bits.append(f"{k} {schema[k]}")
    if schema.get("description"):
        bits.append(f"- {schema['description'][:120]}")
    return " ".join(map(str, bits))


# Passwords, secrets and tokens never go through the chat (they'd sit in the model's context, the
# saved proposal and the card). Such fields are left out of change_options and refused.
SECRET_FIELD = re.compile(r"password|secret|token|api_?key", re.I)


def _strip_secrets(doc: Any) -> Any:
    if isinstance(doc, dict):
        return {k: _strip_secrets(v) for k, v in doc.items() if not SECRET_FIELD.search(k)}
    if isinstance(doc, list):
        return [_strip_secrets(v) for v in doc]
    return doc


def _secret_keys(value: Any, path: str = "") -> list[str]:
    out: list[str] = []
    if isinstance(value, dict):
        for k, v in value.items():
            here = f"{path}.{k}" if path else str(k)
            if SECRET_FIELD.search(str(k)):
                out.append(here)
            out += _secret_keys(v, here)
    elif isinstance(value, list):
        for v in value:
            out += _secret_keys(v, path)
    return out


def fields_doc(op: Op) -> Any:
    body = info(op).body
    if body is None:
        return None
    schema = body.model_json_schema()
    return _strip_secrets(_compact(schema, schema.get("$defs", {})))


def _field_keys() -> list[str]:
    from app.modules.merchant_profiling.domain.profile_field_registry import PROFILE_FIELD_MAP

    return sorted(PROFILE_FIELD_MAP)


# ---------------------------------------------------------------- lookups ----
async def change_options(ctx: Ctx, args: dict) -> dict[str, Any]:
    area = text_arg(args, "area", max_len=40)
    mine = [o for o in OPERATIONS if allowed(ctx, o)]
    if not area:
        counts: dict[str, int] = {}
        for o in mine:
            counts[o.area] = counts.get(o.area, 0) + 1
        return {
            "areas": [{"area": a, "what": AREAS[a], "operations": counts[a]} for a in AREAS if a in counts],
            "note": "Call change_options again with one area to see its operations and fields.",
        }
    if area not in AREAS:
        raise ToolError(f"area must be one of: {', '.join(AREAS)}")
    ops = [o for o in mine if o.area == area]
    if not ops:
        return {"area": area, "operations": [], "note": "This person's role can't change anything in this area."}
    out = []
    for o in ops:
        entry: dict[str, Any] = {"operation": o.key, "does": o.does}
        ids = {p: e for p, e in o.params.items() if e}
        if ids:
            entry["ids"] = {p: f"a {e.replace('_', ' ')} id (find_records entity={e})" if e != "team_member"
                            else "an email from partner_team" for p, e in ids.items()}
        if "key" in o.params and o.params["key"] is None:
            entry["key"] = "profile field key, one of: " + ", ".join(_field_keys())
        doc = fields_doc(o)
        if doc:
            entry["fields"] = doc
        if o.destructive:
            entry["destructive"] = True
        notes = [txt for cap, txt in o.limits if not cap or not has_capability(ctx.user.role, cap)]  # type: ignore[arg-type]
        if notes:
            entry["limits"] = notes
        out.append(entry)
    return {"area": area, "operations": out,
            "note": "Fields marked * are required. Only send fields that should change."}


async def find_records(ctx: Ctx, args: dict) -> dict[str, Any]:
    name = text_arg(args, "entity", max_len=40)
    ent = ENTITIES.get(name or "")
    if not ent:
        raise ToolError(f"entity must be one of: {', '.join(ENTITIES)}")
    if not has_capability(ctx.user.role, ent.capability):  # type: ignore[arg-type]
        raise ToolError("This person's role can't see these records.")
    limit = limit_arg(args)
    params: dict[str, Any] = {"limit": limit}
    conds = [ent.where]
    search = text_arg(args, "search")
    if search and ent.search:
        params["q"] = f"%{search.replace(chr(92), chr(92) * 2).replace('%', chr(92) + '%').replace('_', chr(92) + '_')}%"
        conds.append("(" + " or ".join(f"cast(t.{c} as text) ilike :q" for c in ent.search) + ")")
    merchant_id = text_arg(args, "merchant_id", max_len=40)
    if merchant_id:
        if not ent.parent:
            raise ToolError(f"{name} records don't belong to a merchant; leave merchant_id out.")
        params["mid"] = merchant_id
        conds.append(f"t.{ent.parent} = :mid")
    label = ent.label.replace("{catalog}", qualified("catalog"))
    cols = ent.columns
    sql = (f"select t.{ent.id_col} as id, {label} as label{', ' + cols if cols else ''} "
           f"from {ent.sql_table()} t where {' and '.join(conds)} order by 2 nulls last limit :limit")
    rows = (await ctx.db.execute(text(sql), params)).mappings().all()
    return {"entity": name, "records": [jsonable(dict(r)) for r in rows], "count": len(rows),
            "note": "Use these ids with propose_change." if rows else "Nothing matched."}


async def labels_for(ctx: Ctx, entity: str, ids: list[str]) -> dict[str, str]:
    ent = ENTITIES.get(entity)
    if not ent or not ids:
        return {}
    label = ent.label.replace("{catalog}", qualified("catalog"))
    rows = (await ctx.db.execute(
        text(f"select cast(t.{ent.id_col} as text) as id, {label} as label from {ent.sql_table()} t "
             f"where cast(t.{ent.id_col} as text) = any(:ids)"),
        {"ids": ids},
    )).mappings().all()
    return {r["id"]: str(r["label"] or r["id"]) for r in rows}


# --------------------------------------------------------------- propose ----
def _show(v: Any) -> str:
    """A field's value for the card, in full: the card must show everything the step will write."""
    if isinstance(v, bool):
        return "yes" if v else "no"
    if v is None:
        return "(empty)"
    if isinstance(v, (dict, list)):
        return json.dumps(v, default=str, ensure_ascii=False)
    return str(v)


_ID_FIELD = re.compile(r"(^ids?$|Ids?$|_ids?$)")


def _words(key: str) -> str:
    """restaurantName -> restaurant name (for the card)."""
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r" \1", key).replace("_", " ").lower()


def _body_ids(value: Any, into: list[str], key: str = "") -> None:
    if isinstance(value, dict):
        for k, v in value.items():
            _body_ids(v, into, k)
    elif isinstance(value, list):
        for v in value:
            _body_ids(v, into, key)
    elif key and _ID_FIELD.search(key) and isinstance(value, (str, int)) and str(value):
        into.append(str(value))


def _jsonable_body(model: BaseModel) -> dict[str, Any]:
    """The validated body as JSON (by alias, as the endpoint reads it), only the fields given."""
    return model.model_dump(mode="json", exclude_unset=True, by_alias=True)


async def propose_change(ctx: Ctx, args: dict) -> dict[str, Any]:
    from app.modules.assistant import actions  # the shared "save as pending + card" step

    key = text_arg(args, "operation", max_len=60)
    op = BY_KEY.get(key or "")
    if not op:
        raise ToolError("operation must be one from change_options.")
    if not allowed(ctx, op):
        raise ToolError("This person's role can't do that, so it can't be proposed.")
    changes = args.get("changes")
    if isinstance(changes, dict):
        changes = [changes]
    if not isinstance(changes, list) or not changes:
        raise ToolError("changes must be a list of {ids, fields} (one entry per record).")
    if len(changes) > MAX_CHANGES:
        raise ToolError(f"At most {MAX_CHANGES} changes per proposal. Split it up.")
    body_model = info(op).body
    keys = _field_keys() if "key" in op.params else []

    planned: list[tuple[dict[str, str], Optional[dict[str, Any]]]] = []
    for n, ch in enumerate(changes, 1):
        if not isinstance(ch, dict):
            raise ToolError(f"change {n}: must be an object with ids and fields")
        ids_in = ch.get("ids") or {}
        if not isinstance(ids_in, dict):
            raise ToolError(f"change {n}: ids must be an object like {{\"id\": \"...\"}}")
        path_vals: dict[str, str] = {}
        for p, ent in op.params.items():
            v = str(ids_in.get(p) or "").strip()
            if not v:
                raise ToolError(f"change {n}: ids.{p} is required")
            if len(v) > 254 or not re.match(r"^[A-Za-z0-9._@+-]+$", v) or set(v) <= {"."}:
                raise ToolError(f"change {n}: ids.{p} doesn't look like an id")
            if ent is None:
                if p == "key" and keys and v not in keys:
                    raise ToolError(f"change {n}: unknown profile field key {v!r}")
            elif ent == "team_member":
                v = v.lower()
                if v not in ctx.seen_ids:
                    raise ToolError("Look the person up with partner_team first (in this answer).")
            elif v not in ctx.seen_ids:
                raise ToolError(f"Look the {ent.replace('_', ' ')} up first (find_records, in this answer), "
                                f"then propose the change: {v}")
            path_vals[p] = v
        fields_in = ch.get("fields")
        secret = _secret_keys(fields_in)
        if secret:
            raise ToolError(f"change {n}: {', '.join(secret[:3])} can't be set through the assistant (passwords and "
                            "secrets never go through the chat). Do that on the screen.")
        body: Optional[dict[str, Any]] = None
        if body_model is not None:
            if not isinstance(fields_in, dict):
                fields_in = {}
            try:
                model = body_model.model_validate(fields_in)
            except ValidationError as e:
                problems = "; ".join(f"{'.'.join(map(str, x['loc'])) or 'fields'}: {x['msg']}" for x in e.errors()[:6])
                raise ToolError(f"change {n}: {problems}")
            body = _jsonable_body(model)
            ref_ids: list[str] = []
            _body_ids(body, ref_ids)
            unseen = [i for i in ref_ids if i not in ctx.seen_ids]
            if unseen:
                raise ToolError(f"change {n}: look these up first (in this answer): {', '.join(unseen[:5])}")
        elif fields_in:
            raise ToolError(f"{op.key} takes no fields; leave fields out.")
        planned.append((path_vals, body))

    # Names for the card, one query per kind of record.
    names: dict[str, dict[str, str]] = {}
    for p, ent in op.params.items():
        if ent and ent != "team_member":
            vals = list({pv[p] for pv, _ in planned})
            names[p] = await labels_for(ctx, ent, vals)
            gone = [v for v in vals if v not in names[p]]
            if gone:
                raise ToolError(f"No {ent.replace('_', ' ')} with id(s) {', '.join(gone[:5])}. Look them up again.")

    title = op.does.split(" (")[0]  # "(link shown once)" etc. is for change_options, not the card
    items, steps = [], []
    for path_vals, body in planned:
        path = op.path
        for p, v in path_vals.items():
            path = path.replace("{" + p + "}", quote(v, safe="@+"))
        who = ", ".join(names.get(p, {}).get(v, v) for p, v in path_vals.items() if op.params.get(p) or p == "key")
        detail = "; ".join(f"{_words(k)} → {_show(v)}" for k, v in (body or {}).items())
        line = title + (f": {who}" if who else "") + (f" — {detail}" if detail else "")
        items.append(line)
        step = {"method": op.method, "path": path, "json": body, "label": who or op.does}
        if op.reveal:
            step["reveal"] = list(op.reveal)
        steps.append(step)

    plan = actions.Plan(title=title if len(steps) == 1 else f"{title} ({len(steps)})", items=items, steps=steps,
                        destructive=op.destructive)
    return await actions.save_plan(ctx, f"change:{op.key}", plan)


# ------------------------------------------------------------------ tools ----
CATALOG_TOOLS: list[Tool] = [
    Tool(
        name="change_options", label="Checking what can be changed", capability=None, run=change_options,
        description=("What this person can change, beyond the propose_ tools: first call with no area for the list of "
                     "areas, then with one area for its operations and their fields. Only operations this person's "
                     "role allows are listed."),
        properties={"area": {"type": "string", "enum": list(AREAS)}},
    ),
    Tool(
        name="find_records", label="Finding records", capability=None, run=find_records,
        description=("Find records to change and their ids: " + ", ".join(ENTITIES) + ". Optional search (words) and "
                     "merchant_id (for a merchant's contacts, locations, keywords, competitors, connections, "
                     "merchant_service, promotions, documents, brand assets)."),
        properties={"entity": {"type": "string", "enum": list(ENTITIES)}, "search": {"type": "string"},
                    "merchant_id": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 50}},
        required=("entity",),
    ),
    Tool(
        name="propose_change", label="Preparing a change", capability=None, run=propose_change,
        description=("Propose any change from change_options: operation, and changes = a list (max 25) of "
                     "{ids: {path ids}, fields: {...}}. Ids must come from a lookup in this answer. Only PROPOSES: "
                     "the person sees a card and nothing changes until they click Confirm. Never say it's done."),
        properties={
            "operation": {"type": "string"},
            "changes": {"type": "array", "maxItems": MAX_CHANGES, "items": {
                "type": "object", "properties": {"ids": {"type": "object"}, "fields": {"type": "object"}}}},
        },
        required=("operation", "changes"),
    ),
]
