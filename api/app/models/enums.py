"""All Postgres enums from schema.prisma, grouped by owning schema."""
from __future__ import annotations

import enum


# ---- profiling ----------------------------------------------------------
class AccountHealth(str, enum.Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"


class MerchantStatus(str, enum.Enum):
    """Where a restaurant is in its life with Innowi. Lives on the merchant
    itself (the marketing package has its own PackageStatus). A churned
    account stays a merchant: its history, contacts and churn record are the
    win-back list."""
    PROSPECT = "PROSPECT"
    ONBOARDING = "ONBOARDING"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    CHURNED = "CHURNED"


class WinbackStatus(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"
    CONTACTED = "CONTACTED"
    IN_TALKS = "IN_TALKS"
    WON_BACK = "WON_BACK"
    DECLINED = "DECLINED"
    CLOSED_PERMANENTLY = "CLOSED_PERMANENTLY"


# ---- spine: organizations + deals ----------------------------------------
class OrganizationKind(str, enum.Enum):
    PARTNER_ISO = "PARTNER_ISO"
    PARTNER_AGENT = "PARTNER_AGENT"
    PARTNER_RESELLER = "PARTNER_RESELLER"
    CONTRACTOR = "CONTRACTOR"
    OTHER = "OTHER"


class OrganizationStatus(str, enum.Enum):
    PROSPECT = "PROSPECT"
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class DealStage(str, enum.Enum):
    """Sales stages, then the onboarding stages ops tracks today in Salesforce
    (order form -> processor -> menu -> ready -> deployed -> live)."""
    NEW = "NEW"
    DEMO_BOOKED = "DEMO_BOOKED"
    DEMO_DONE = "DEMO_DONE"
    QUOTE_SENT = "QUOTE_SENT"
    ORDER_FORM_SIGNED = "ORDER_FORM_SIGNED"
    PROCESSOR_SETUP = "PROCESSOR_SETUP"
    MENU = "MENU"
    READY_TO_DEPLOY = "READY_TO_DEPLOY"
    DEPLOYED = "DEPLOYED"
    LIVE = "LIVE"
    LOST = "LOST"


class DeployedBy(str, enum.Enum):
    INNOWI = "INNOWI"
    CONTRACTOR = "CONTRACTOR"


class HiredBy(str, enum.Enum):
    INNOWI = "INNOWI"
    PARTNER = "PARTNER"


class DealEventKind(str, enum.Enum):
    CREATED = "CREATED"
    STAGE_CHANGED = "STAGE_CHANGED"
    NOTE = "NOTE"
    QUOTE_LINKED = "QUOTE_LINKED"
    QUOTE_EXECUTED = "QUOTE_EXECUTED"
    OWNER_CHANGED = "OWNER_CHANGED"


class YesNo(str, enum.Enum):
    YES = "YES"
    NO = "NO"
    PARTIAL = "PARTIAL"
    UNKNOWN = "UNKNOWN"


class PackageStatus(str, enum.Enum):
    ONBOARDING = "ONBOARDING"
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    AT_RISK = "AT_RISK"
    CHURNED = "CHURNED"


class ContactRole(str, enum.Enum):
    OWNER = "OWNER"
    MARKETING = "MARKETING"
    CONTENT_APPROVER = "CONTENT_APPROVER"
    BILLING = "BILLING"
    CATERING = "CATERING"


class PreferredChannel(str, enum.Enum):
    WHATSAPP = "WHATSAPP"
    EMAIL = "EMAIL"
    SMS = "SMS"
    PHONE = "PHONE"


class Responsiveness(str, enum.Enum):
    FAST = "FAST"
    NORMAL = "NORMAL"
    SLOW = "SLOW"
    VERY_SLOW = "VERY_SLOW"
    UNKNOWN = "UNKNOWN"


class KeywordType(str, enum.Enum):
    PRIMARY = "PRIMARY"
    SECONDARY = "SECONDARY"
    LOCATION = "LOCATION"


class AccessCriticality(str, enum.Enum):
    CRITICAL = "CRITICAL"
    CRITICAL_COMPLIANCE = "CRITICAL_COMPLIANCE"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class AccessStatus(str, enum.Enum):
    NOT_REQUESTED = "NOT_REQUESTED"
    REQUESTED = "REQUESTED"
    RECEIVED = "RECEIVED"
    VERIFIED = "VERIFIED"
    FAILED = "FAILED"
    NA = "NA"


class AccessFlag(str, enum.Enum):
    BLOCKER = "BLOCKER"
    OPEN = "OPEN"
    NONE = "NONE"


class VerificationConfidence(str, enum.Enum):
    CONFIRMED = "CONFIRMED"
    INFERRED = "INFERRED"
    UNVERIFIED = "UNVERIFIED"
    OUTDATED = "OUTDATED"
    PLACEHOLDER = "PLACEHOLDER"


class MerchantServiceStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    PAUSED = "PAUSED"


class DocumentCategory(str, enum.Enum):
    CONTRACT = "CONTRACT"
    TAX = "TAX"
    MENU = "MENU"
    CONSENT = "CONSENT"
    BRAND = "BRAND"
    REPORT = "REPORT"
    OTHER = "OTHER"


class DocumentStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"


# ---- catalog --------------------------------------------------------------
class OwnerTeam(str, enum.Enum):
    MARKETING = "MARKETING"
    SEO = "SEO"
    DESIGN = "DESIGN"
    WEB = "WEB"
    ACCOUNT_MGMT = "ACCOUNT_MGMT"
    REVIEW = "REVIEW"


class ServiceCategory(str, enum.Enum):
    CUSTOMER_MARKETING = "CUSTOMER_MARKETING"
    SEARCH = "SEARCH"
    REPUTATION = "REPUTATION"
    CONVERSION = "CONVERSION"
    RETENTION = "RETENTION"
    SOCIAL = "SOCIAL"
    CREATIVE = "CREATIVE"
    REPORTING = "REPORTING"
    REVIEW = "REVIEW"


class DeliveryFrequency(str, enum.Enum):
    WEEKLY = "WEEKLY"
    TWO_X_MONTHLY = "TWO_X_MONTHLY"
    THREE_X_WEEKLY = "THREE_X_WEEKLY"
    MONTHLY = "MONTHLY"
    QUARTERLY = "QUARTERLY"
    ONE_TIME = "ONE_TIME"
    ONGOING = "ONGOING"
    AS_NEEDED = "AS_NEEDED"
    NOT_INCLUDED = "NOT_INCLUDED"


# ---- delivery ---------------------------------------------------------------
class DeliveryStatus(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    DELIVERED = "DELIVERED"
    LIVE = "LIVE"
    PAUSED = "PAUSED"
    BLOCKED = "BLOCKED"
    NOT_INCLUDED = "NOT_INCLUDED"


# ---- marketing --------------------------------------------------------------
class PromotionStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    SCHEDULED = "SCHEDULED"
    ACTIVE = "ACTIVE"
    ENDED = "ENDED"
    EXPIRED = "EXPIRED"
    NO_PROMOTION = "NO_PROMOTION"


# ---- payments -----------------------------------------------------------------
class OpportunityStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    NOT_ACTIVE = "NOT_ACTIVE"
    RECOMMENDED = "RECOMMENDED"
    NOT_SET_UP = "NOT_SET_UP"
    DECLINED = "DECLINED"


class Priority(str, enum.Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


# ---- auth -----------------------------------------------------------------
class Role(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    ADMIN = "ADMIN"
    MARKETING_MANAGER = "MARKETING_MANAGER"
    MARKETING_EXECUTIVE = "MARKETING_EXECUTIVE"
    # Partner leads (and future sales tools) only — no marketing screens.
    # In the Sales module: only their own Salesforce records.
    SALES_EXECUTIVE = "SALES_EXECUTIVE"
    # Every salesperson's Salesforce records. Added by migration d9e0f1a2b3c4.
    SALES_MANAGER = "SALES_MANAGER"


class UserStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    SUSPENDED = "SUSPENDED"


# ---- audit -----------------------------------------------------------------
class AuditAction(str, enum.Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DELETE = "DELETE"


class AuditOutcome(str, enum.Enum):
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


# ---- ops (Ops CRM tickets) ---------------------------------------------------
class TicketType(str, enum.Enum):
    """Which team's work this is. Sets the category list (modules/ops/taxonomy.py)."""

    MARKETING = "MARKETING"
    DESIGN = "DESIGN"
    WEBSITE = "WEBSITE"
    INTERNAL = "INTERNAL"


class TicketPriority(str, enum.Enum):
    URGENT = "URGENT"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class TicketStatus(str, enum.Enum):
    """Workflow from the Ops CRM prototype, minus "Triaged": tickets are
    assigned straight to one person, so there is no queue to triage."""

    NEW = "NEW"
    IN_PROGRESS = "IN_PROGRESS"
    AWAITING_MERCHANT = "AWAITING_MERCHANT"
    IN_REVIEW = "IN_REVIEW"
    DONE = "DONE"


class TicketRequestType(str, enum.Enum):
    NEW_REQUEST = "NEW_REQUEST"
    UPDATE = "UPDATE"
    QUERY = "QUERY"
    ISSUE = "ISSUE"


class TicketSource(str, enum.Enum):
    """Where the ticket came from. Only MANUAL exists today; EMAIL, MODULE
    (SEO/GBP alerts) and MEETING (Fathom action items) arrive in later phases."""

    MANUAL = "MANUAL"
    EMAIL = "EMAIL"
    MODULE = "MODULE"
    MEETING = "MEETING"


class TicketEventKind(str, enum.Enum):
    CREATED = "CREATED"
    STATUS_CHANGED = "STATUS_CHANGED"
    ASSIGNED = "ASSIGNED"
    PRIORITY_CHANGED = "PRIORITY_CHANGED"
    DUE_DATE_CHANGED = "DUE_DATE_CHANGED"
    UPDATED = "UPDATED"
    SUBTASK_ADDED = "SUBTASK_ADDED"
    SUBTASK_COMPLETED = "SUBTASK_COMPLETED"
    SUBTASK_REOPENED = "SUBTASK_REOPENED"
    SUBTASK_REMOVED = "SUBTASK_REMOVED"
    ATTACHMENT_ADDED = "ATTACHMENT_ADDED"
    ATTACHMENT_REMOVED = "ATTACHMENT_REMOVED"


class LibrarySection(str, enum.Enum):
    """Where a Library page sits in the tree (prototype: Company · Merchants · Restricted)."""

    COMPANY = "COMPANY"  # guidelines, policies
    PROCESS = "PROCESS"  # processes & SOPs
    TEMPLATE = "TEMPLATE"  # briefs, request templates
    MERCHANT = "MERCHANT"  # one merchant's brand guidelines / notes


class CredentialAction(str, enum.Enum):
    CREATED = "CREATED"
    UPDATED = "UPDATED"
    REVEALED = "REVEALED"
    DELETED = "DELETED"


# ---- ops: meetings (Fathom) -----------------------------------------------
class MeetingSource(str, enum.Enum):
    FATHOM = "FATHOM"  # pulled by sync or pushed by the Fathom webhook
    DEMO = "DEMO"  # sample meetings from scripts/seed_meetings.py


class ActionItemStatus(str, enum.Enum):
    OPEN = "OPEN"  # waiting for Aima / Maheen to decide
    TICKET = "TICKET"  # turned into a ticket
    DISMISSED = "DISMISSED"  # not needed


class NotificationKind(str, enum.Enum):
    """In-app notices (the bell). Each maps to a choice in Settings →
    Notifications (modules/ops/alerts.PREF_FOR)."""

    ASSIGNED = "ASSIGNED"
    STATUS_CHANGED = "STATUS_CHANGED"
    COMMENTED = "COMMENTED"
    SLA_AT_RISK = "SLA_AT_RISK"
    SLA_BREACHED = "SLA_BREACHED"
    RESPONSE_OVERDUE = "RESPONSE_OVERDUE"
    MENTIONED = "MENTIONED"
    # Requests (modules/requests): a new request for the triage owners, and
    # activity on a request you submitted, upvoted or commented on.
    REQUEST_NEW = "REQUEST_NEW"
    REQUEST_UPDATED = "REQUEST_UPDATED"


class CommentVisibility(str, enum.Enum):
    """INTERNAL: team only (the default). MERCHANT: shared with / told to the
    merchant — the record of what the merchant was told (emailed to the
    merchant contact once Outlook is connected)."""

    INTERNAL = "INTERNAL"
    MERCHANT = "MERCHANT"
