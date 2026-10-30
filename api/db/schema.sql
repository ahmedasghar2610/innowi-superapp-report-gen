-- =============================================================================
-- First-boot initialization (runs once, before Alembic connects).
-- Creates the 8 ownership schemas from schema.prisma's multiSchema layout.
-- Alembic (via SQLAlchemy) manages TABLES inside them; this file only
-- establishes the schemas themselves, since `CREATE SCHEMA` isn't something
-- autogenerate will ever emit for you on a from-scratch database.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS profiling;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS delivery;
CREATE SCHEMA IF NOT EXISTS performance;
CREATE SCHEMA IF NOT EXISTS marketing;
CREATE SCHEMA IF NOT EXISTS payments;

BEGIN;

CREATE TABLE public.alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 5794397107b7

CREATE TYPE audit."AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

CREATE TYPE audit."AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

CREATE TABLE audit.audit_log (
    id VARCHAR(30) NOT NULL, 
    actor_id VARCHAR, 
    actor_email VARCHAR, 
    actor_role VARCHAR, 
    action audit."AuditAction" NOT NULL, 
    entity_type VARCHAR NOT NULL, 
    entity_id VARCHAR, 
    merchant_id VARCHAR, 
    before JSON, 
    after JSON, 
    changed_fields VARCHAR[] NOT NULL, 
    method VARCHAR NOT NULL, 
    path VARCHAR NOT NULL, 
    outcome audit."AuditOutcome" NOT NULL, 
    status_code INTEGER NOT NULL, 
    error_message VARCHAR, 
    ip VARCHAR, 
    user_agent VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id)
);

CREATE INDEX ix_audit_log_action ON audit.audit_log (action);

CREATE INDEX ix_audit_log_actor_created ON audit.audit_log (actor_id, created_at);

CREATE INDEX ix_audit_log_created_at ON audit.audit_log (created_at);

CREATE INDEX ix_audit_log_entity_created ON audit.audit_log (entity_type, entity_id, created_at);

CREATE INDEX ix_audit_log_merchant_created ON audit.audit_log (merchant_id, created_at);

CREATE TYPE auth."Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MARKETING_MANAGER', 'MARKETING_EXECUTIVE');

CREATE TYPE auth."UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

CREATE TABLE auth."user" (
    id VARCHAR(30) NOT NULL, 
    email VARCHAR NOT NULL, 
    password_hash VARCHAR NOT NULL, 
    first_name VARCHAR, 
    last_name VARCHAR, 
    role auth."Role" NOT NULL, 
    status auth."UserStatus" NOT NULL, 
    last_login_at TIMESTAMP WITH TIME ZONE, 
    password_changed_at TIMESTAMP WITH TIME ZONE, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (email)
);

CREATE INDEX ix_auth_user_role ON auth."user" (role);

CREATE INDEX ix_auth_user_status ON auth."user" (status);

CREATE TABLE catalog.package (
    code VARCHAR NOT NULL, 
    name VARCHAR NOT NULL, 
    price NUMERIC(10, 2) NOT NULL, 
    PRIMARY KEY (code)
);

CREATE TYPE catalog."ServiceCategory" AS ENUM ('CUSTOMER_MARKETING', 'SEARCH', 'REPUTATION', 'CONVERSION', 'RETENTION', 'SOCIAL', 'CREATIVE', 'REPORTING', 'REVIEW');

CREATE TYPE catalog."OwnerTeam" AS ENUM ('MARKETING', 'SEO', 'DESIGN', 'WEB', 'ACCOUNT_MGMT', 'REVIEW');

CREATE TABLE catalog.service (
    id VARCHAR(30) NOT NULL, 
    name VARCHAR NOT NULL, 
    category catalog."ServiceCategory" NOT NULL, 
    owner_team catalog."OwnerTeam" NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (name)
);

CREATE TABLE profiling.account_manager (
    id VARCHAR(30) NOT NULL, 
    name VARCHAR NOT NULL, 
    team VARCHAR, 
    email VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    UNIQUE (email)
);

CREATE TABLE auth.refresh_token (
    id VARCHAR(30) NOT NULL, 
    user_id VARCHAR(30) NOT NULL, 
    token_hash VARCHAR NOT NULL, 
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
    revoked_at TIMESTAMP WITH TIME ZONE, 
    replaced_by VARCHAR, 
    ip VARCHAR, 
    user_agent VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(user_id) REFERENCES auth."user" (id) ON DELETE CASCADE, 
    UNIQUE (token_hash)
);

CREATE INDEX ix_auth_refresh_token_expires_at ON auth.refresh_token (expires_at);

CREATE INDEX ix_auth_refresh_token_user_id ON auth.refresh_token (user_id);

CREATE TYPE catalog."DeliveryFrequency" AS ENUM ('WEEKLY', 'TWO_X_MONTHLY', 'THREE_X_WEEKLY', 'MONTHLY', 'QUARTERLY', 'ONE_TIME', 'ONGOING', 'AS_NEEDED', 'NOT_INCLUDED');

CREATE TABLE catalog.entitlement (
    id VARCHAR(30) NOT NULL, 
    service_id VARCHAR(30) NOT NULL, 
    package_code VARCHAR NOT NULL, 
    included BOOLEAN NOT NULL, 
    qty_per_period INTEGER, 
    frequency catalog."DeliveryFrequency" NOT NULL, 
    definition_of_done VARCHAR, 
    owner_team catalog."OwnerTeam" NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(package_code) REFERENCES catalog.package (code), 
    FOREIGN KEY(service_id) REFERENCES catalog.service (id), 
    CONSTRAINT uq_entitlement_service_package UNIQUE (service_id, package_code)
);

CREATE TYPE profiling."YesNo" AS ENUM ('YES', 'NO', 'PARTIAL', 'UNKNOWN');

CREATE TYPE profiling."AccountHealth" AS ENUM ('GREEN', 'YELLOW', 'RED');

CREATE TABLE profiling.merchant (
    id VARCHAR(30) NOT NULL, 
    merchant_code VARCHAR, 
    restaurant_name_dba VARCHAR NOT NULL, 
    legal_name VARCHAR, 
    cuisine_category VARCHAR, 
    website_url VARCHAR, 
    website_platform VARCHAR, 
    online_ordering VARCHAR, 
    pos_system VARCHAR, 
    customer_list_source VARCHAR, 
    google_ads_budget NUMERIC(10, 2), 
    meta_ads_budget NUMERIC(10, 2), 
    business_goals VARCHAR, 
    target_audience VARCHAR, 
    slow_dayparts VARCHAR, 
    seasonal_peaks VARCHAR, 
    alcohol_license profiling."YesNo", 
    dietary_certifications VARCHAR, 
    multi_location profiling."YesNo", 
    location_count INTEGER, 
    report_frequency VARCHAR, 
    report_recipients VARCHAR, 
    account_health profiling."AccountHealth", 
    profile_completion_pct INTEGER, 
    next_action VARCHAR, 
    open_blockers VARCHAR, 
    notes VARCHAR, 
    onboarding_date TIMESTAMP WITH TIME ZONE, 
    go_live_date TIMESTAMP WITH TIME ZONE, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    account_manager_id VARCHAR(30), 
    PRIMARY KEY (id), 
    FOREIGN KEY(account_manager_id) REFERENCES profiling.account_manager (id), 
    UNIQUE (merchant_code)
);

CREATE INDEX ix_merchant_account_health ON profiling.merchant (account_health);

CREATE INDEX ix_merchant_account_manager_id ON profiling.merchant (account_manager_id);

CREATE INDEX ix_merchant_created_at ON profiling.merchant (created_at);

CREATE INDEX ix_merchant_restaurant_name ON profiling.merchant (restaurant_name_dba);

CREATE TYPE delivery."DeliveryStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DELIVERED', 'LIVE', 'PAUSED', 'BLOCKED', 'NOT_INCLUDED');

CREATE TABLE delivery.delivery_item (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    service_id VARCHAR(30) NOT NULL, 
    entitlement_id VARCHAR(30), 
    status delivery."DeliveryStatus" NOT NULL, 
    assigned_to VARCHAR, 
    last_delivered TIMESTAMP WITH TIME ZONE, 
    next_due TIMESTAMP WITH TIME ZONE, 
    flag VARCHAR, 
    notes VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(entitlement_id) REFERENCES catalog.entitlement (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE, 
    FOREIGN KEY(service_id) REFERENCES catalog.service (id), 
    CONSTRAINT uq_delivery_item_merchant_service UNIQUE (merchant_id, service_id)
);

CREATE INDEX ix_delivery_item_merchant_id ON delivery.delivery_item (merchant_id);

CREATE TYPE marketing."PromotionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'EXPIRED', 'NO_PROMOTION');

CREATE TABLE marketing.promotion (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    promo_name VARCHAR, 
    offer_type VARCHAR, 
    offer_value VARCHAR, 
    promo_code VARCHAR, 
    channels VARCHAR, 
    start_date TIMESTAMP WITH TIME ZONE, 
    end_date TIMESTAMP WITH TIME ZONE, 
    status marketing."PromotionStatus" NOT NULL, 
    redemptions VARCHAR, 
    redemption_method VARCHAR, 
    approval_owner VARCHAR, 
    staff_briefed profiling."YesNo", 
    blackout_dates VARCHAR, 
    notes VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE INDEX ix_promotion_merchant_id ON marketing.promotion (merchant_id);

CREATE TYPE payments."OpportunityStatus" AS ENUM ('ACTIVE', 'NOT_ACTIVE', 'RECOMMENDED', 'NOT_SET_UP', 'DECLINED');

CREATE TYPE payments."Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TABLE payments.opportunity (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    opportunity VARCHAR NOT NULL, 
    current_status payments."OpportunityStatus" NOT NULL, 
    priority payments."Priority", 
    est_monthly_value NUMERIC(10, 2), 
    rationale VARCHAR, 
    owner VARCHAR, 
    next_step VARCHAR, 
    target_date TIMESTAMP WITH TIME ZONE, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE INDEX ix_opportunity_merchant_id ON payments.opportunity (merchant_id);

CREATE TABLE performance.baseline (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    category VARCHAR NOT NULL, 
    metric VARCHAR NOT NULL, 
    unit VARCHAR, 
    baseline_date TIMESTAMP WITH TIME ZONE, 
    baseline_value VARCHAR, 
    "current_date" TIMESTAMP WITH TIME ZONE, 
    current_value VARCHAR, 
    source VARCHAR, 
    notes VARCHAR, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE, 
    CONSTRAINT uq_baseline_merchant_category_metric UNIQUE (merchant_id, category, metric)
);

CREATE INDEX ix_baseline_merchant_id ON performance.baseline (merchant_id);

CREATE TABLE performance.scorecard_entry (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    service_id VARCHAR(30), 
    month VARCHAR NOT NULL, 
    area VARCHAR NOT NULL, 
    kpi VARCHAR NOT NULL, 
    target NUMERIC(12, 2), 
    actual NUMERIC(12, 2), 
    status VARCHAR, 
    commentary VARCHAR, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE, 
    FOREIGN KEY(service_id) REFERENCES catalog.service (id)
);

CREATE INDEX ix_scorecard_entry_merchant_month ON performance.scorecard_entry (merchant_id, month);

CREATE TYPE profiling."AccessCriticality" AS ENUM ('CRITICAL', 'CRITICAL_COMPLIANCE', 'HIGH', 'MEDIUM', 'LOW');

CREATE TYPE profiling."AccessStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'RECEIVED', 'VERIFIED', 'FAILED', 'NA');

CREATE TYPE profiling."AccessFlag" AS ENUM ('BLOCKER', 'OPEN', 'NONE');

CREATE TABLE profiling.access_item (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    access_item VARCHAR NOT NULL, 
    criticality profiling."AccessCriticality" NOT NULL, 
    status profiling."AccessStatus" NOT NULL, 
    date_requested TIMESTAMP WITH TIME ZONE, 
    date_received TIMESTAMP WITH TIME ZONE, 
    verified BOOLEAN NOT NULL, 
    verified_date TIMESTAMP WITH TIME ZONE, 
    expiry TIMESTAMP WITH TIME ZONE, 
    owner VARCHAR, 
    flag profiling."AccessFlag" NOT NULL, 
    why_it_matters VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE, 
    CONSTRAINT uq_access_item_merchant_item UNIQUE (merchant_id, access_item)
);

CREATE INDEX ix_access_item_flag ON profiling.access_item (flag);

CREATE INDEX ix_access_item_merchant_id ON profiling.access_item (merchant_id);

CREATE TABLE profiling.brand_asset (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    type VARCHAR NOT NULL, 
    name VARCHAR, 
    url VARCHAR, 
    status VARCHAR, 
    mime_type VARCHAR, 
    size_bytes INTEGER, 
    uploaded_by VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE INDEX ix_brand_asset_merchant_id ON profiling.brand_asset (merchant_id);

CREATE TABLE profiling.brand_profile (
    merchant_id VARCHAR(30) NOT NULL, 
    brand_colors VARCHAR, 
    brand_fonts VARCHAR, 
    logo_vector profiling."YesNo", 
    photo_library_status VARCHAR, 
    menu_format VARCHAR, 
    signature_dishes VARCHAR, 
    tone_of_voice VARCHAR, 
    do_not_say VARCHAR, 
    content_restrictions VARCHAR, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (merchant_id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE TABLE profiling.catering_profile (
    merchant_id VARCHAR(30) NOT NULL, 
    offered profiling."YesNo", 
    contact VARCHAR, 
    lead_flow VARCHAR, 
    min_order VARCHAR, 
    notes VARCHAR, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (merchant_id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE TABLE profiling.competitor (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    name VARCHAR NOT NULL, 
    rank INTEGER, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE INDEX ix_competitor_merchant_id ON profiling.competitor (merchant_id);

CREATE TYPE profiling."ContactRole" AS ENUM ('OWNER', 'MARKETING', 'CONTENT_APPROVER', 'BILLING', 'CATERING');

CREATE TYPE profiling."PreferredChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS', 'PHONE');

CREATE TYPE profiling."Responsiveness" AS ENUM ('FAST', 'NORMAL', 'SLOW', 'VERY_SLOW', 'UNKNOWN');

CREATE TABLE profiling.contact (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    name VARCHAR, 
    role profiling."ContactRole" NOT NULL, 
    email VARCHAR, 
    phone VARCHAR, 
    preferred_channel profiling."PreferredChannel", 
    language VARCHAR, 
    responsiveness profiling."Responsiveness", 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE INDEX ix_contact_merchant_id ON profiling.contact (merchant_id);

CREATE TYPE profiling."VerificationConfidence" AS ENUM ('CONFIRMED', 'INFERRED', 'UNVERIFIED', 'OUTDATED', 'PLACEHOLDER');

CREATE TABLE profiling.field_verification (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    entity_type VARCHAR NOT NULL, 
    entity_id VARCHAR NOT NULL, 
    field_name VARCHAR NOT NULL, 
    value VARCHAR, 
    source VARCHAR, 
    confidence profiling."VerificationConfidence" NOT NULL, 
    verified_by VARCHAR, 
    verified_at TIMESTAMP WITH TIME ZONE, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE, 
    CONSTRAINT uq_field_verification_entity_field UNIQUE (entity_type, entity_id, field_name)
);

CREATE INDEX ix_field_verification_merchant_id ON profiling.field_verification (merchant_id);

CREATE TYPE profiling."KeywordType" AS ENUM ('PRIMARY', 'SECONDARY', 'LOCATION');

CREATE TABLE profiling.keyword (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    term VARCHAR NOT NULL, 
    type profiling."KeywordType" NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE, 
    CONSTRAINT uq_keyword_merchant_term_type UNIQUE (merchant_id, term, type)
);

CREATE INDEX ix_keyword_merchant_id ON profiling.keyword (merchant_id);

CREATE TABLE profiling.location (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    address VARCHAR, 
    city VARCHAR, 
    state VARCHAR, 
    zip VARCHAR, 
    hours VARCHAR, 
    timezone VARCHAR, 
    is_primary BOOLEAN NOT NULL, 
    nap_status VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE INDEX ix_location_merchant_id ON profiling.location (merchant_id);

CREATE TYPE profiling."MerchantServiceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PAUSED');

CREATE TABLE profiling.merchant_service (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    service_id VARCHAR(30) NOT NULL, 
    status profiling."MerchantServiceStatus" NOT NULL, 
    activated_at TIMESTAMP WITH TIME ZONE, 
    notes VARCHAR, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE, 
    FOREIGN KEY(service_id) REFERENCES catalog.service (id), 
    CONSTRAINT uq_merchant_service_merchant_service UNIQUE (merchant_id, service_id)
);

CREATE INDEX ix_merchant_service_merchant_id ON profiling.merchant_service (merchant_id);

CREATE TYPE profiling."PackageStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED', 'AT_RISK', 'CHURNED');

CREATE TABLE profiling.subscription (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    package_code VARCHAR NOT NULL, 
    status profiling."PackageStatus" NOT NULL, 
    start_date TIMESTAMP WITH TIME ZONE, 
    renewal_date TIMESTAMP WITH TIME ZONE, 
    mrr NUMERIC(10, 2), 
    is_current BOOLEAN NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE, 
    FOREIGN KEY(package_code) REFERENCES catalog.package (code), 
    UNIQUE (merchant_id)
);

CREATE INDEX ix_subscription_package_code ON profiling.subscription (package_code);

CREATE TYPE profiling."DocumentCategory" AS ENUM ('CONTRACT', 'TAX', 'MENU', 'CONSENT', 'BRAND', 'REPORT', 'OTHER');

CREATE TYPE profiling."DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE profiling.document (
    id VARCHAR(30) NOT NULL, 
    merchant_id VARCHAR(30) NOT NULL, 
    location_id VARCHAR(30), 
    category profiling."DocumentCategory" NOT NULL, 
    file_name VARCHAR NOT NULL, 
    storage_url VARCHAR NOT NULL, 
    mime_type VARCHAR, 
    size_bytes INTEGER, 
    version INTEGER NOT NULL, 
    uploaded_by VARCHAR, 
    status profiling."DocumentStatus" NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id), 
    FOREIGN KEY(location_id) REFERENCES profiling.location (id) ON DELETE SET NULL, 
    FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE CASCADE
);

CREATE INDEX ix_document_location_id ON profiling.document (location_id);

CREATE INDEX ix_document_merchant_id ON profiling.document (merchant_id);

INSERT INTO public.alembic_version (version_num) VALUES ('5794397107b7') RETURNING public.alembic_version.version_num;

-- Running upgrade 5794397107b7 -> b1c2d3e4f5a6

CREATE TABLE marketing.website (
    id VARCHAR(40) NOT NULL, 
    slug VARCHAR(80) NOT NULL, 
    name VARCHAR(255) NOT NULL, 
    tagline VARCHAR(255) NOT NULL, 
    contact_email VARCHAR(320) NOT NULL, 
    status VARCHAR(16) NOT NULL, 
    values_json JSON NOT NULL, 
    notes TEXT NOT NULL, 
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
    PRIMARY KEY (id)
);

CREATE UNIQUE INDEX ix_marketing_website_slug ON marketing.website (slug);

CREATE INDEX ix_website_status ON marketing.website (status);

CREATE INDEX ix_website_name ON marketing.website (name);

CREATE INDEX ix_website_updated_at ON marketing.website (updated_at);

UPDATE public.alembic_version SET version_num='b1c2d3e4f5a6' WHERE public.alembic_version.version_num = '5794397107b7';

-- Running upgrade b1c2d3e4f5a6 -> c2d3e4f5a6b7

ALTER TABLE profiling.merchant DROP COLUMN multi_location;

UPDATE public.alembic_version SET version_num='c2d3e4f5a6b7' WHERE public.alembic_version.version_num = 'b1c2d3e4f5a6';

-- Running upgrade c2d3e4f5a6b7 -> d3e4f5a6b7c8

ALTER TABLE marketing.website ADD COLUMN admin_password_hash VARCHAR(255);

ALTER TABLE marketing.website ADD COLUMN editor_content JSON;

ALTER TABLE marketing.website ADD COLUMN editor_updated_at TIMESTAMP WITH TIME ZONE;

UPDATE public.alembic_version SET version_num='d3e4f5a6b7c8' WHERE public.alembic_version.version_num = 'c2d3e4f5a6b7';

-- Running upgrade d3e4f5a6b7c8 -> e4f5a6b7c8d9

ALTER TABLE marketing.website ADD COLUMN merchant_id VARCHAR(30);

CREATE INDEX ix_website_merchant_id ON marketing.website (merchant_id);

ALTER TABLE marketing.website ADD CONSTRAINT fk_website_merchant_id FOREIGN KEY(merchant_id) REFERENCES profiling.merchant (id) ON DELETE SET NULL;

UPDATE public.alembic_version SET version_num='e4f5a6b7c8d9' WHERE public.alembic_version.version_num = 'd3e4f5a6b7c8';

-- Running upgrade e4f5a6b7c8d9 -> f5a6b7c8d9e0

update profiling.merchant m
               set website_url = 'http://localhost:5050' || '/' || w.slug,
                   website_platform = 'Innowi'
              from marketing.website w
             where w.merchant_id = m.id
               and coalesce(trim(m.website_url), '') = '';

UPDATE public.alembic_version SET version_num='f5a6b7c8d9e0' WHERE public.alembic_version.version_num = 'e4f5a6b7c8d9';

-- Running upgrade f5a6b7c8d9e0 -> a6b7c8d9e0f1

ALTER TABLE marketing.website ALTER COLUMN status TYPE VARCHAR(32);

update marketing.website set status = 'in_creation' where status = 'draft';

update marketing.website set status = 'under_review' where status = 'in_review';

ALTER TABLE marketing.website ALTER COLUMN status DROP DEFAULT;

UPDATE public.alembic_version SET version_num='a6b7c8d9e0f1' WHERE public.alembic_version.version_num = 'f5a6b7c8d9e0';

-- Running upgrade a6b7c8d9e0f1 -> b7c8d9e0f1a2

ALTER TABLE marketing.website ADD COLUMN profile_overrides JSON DEFAULT '{}' NOT NULL;

UPDATE public.alembic_version SET version_num='b7c8d9e0f1a2' WHERE public.alembic_version.version_num = 'a6b7c8d9e0f1';

COMMIT;


-- ---------------------------------------------------------------------------
-- Default Super Admin (same as `python -m scripts.seed_admin`)
-- Login: superadmin@innowi.com / ChangeMe123!  -> CHANGE AFTER FIRST LOGIN
-- ---------------------------------------------------------------------------
INSERT INTO auth."user" (id, email, password_hash, first_name, last_name, role, status, password_changed_at)
VALUES ('c1a0ecc8b44bgspofl87i8r3z', 'superadmin@innowi.com', '$2b$12$mPDsFhIPMZJmcJ8YZSz4oOU7Ny..YaHFrY3QC57Gd4RnnuOvJphAa', 'Super', 'Admin', 'SUPER_ADMIN', 'ACTIVE', now())
ON CONFLICT (email) DO NOTHING;
