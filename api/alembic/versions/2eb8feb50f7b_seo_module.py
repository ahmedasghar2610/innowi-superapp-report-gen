"""marketing: SEO module (Search Console, GA4, PageSpeed, Serper)

Revision ID: 2eb8feb50f7b
Revises: d12f9487db22
Create Date: 2026-10-14

Local copy of the SEO data, filled by the daily sync (modules/seo/sync.py):

- marketing.seo_connection   connected Google account (Search Console + GA4) + encrypted refresh token
- marketing.seo_site         tracked websites, links to merchant / GBP listing / Ads account, cached scores
- marketing.seo_gsc_daily · seo_gsc_query · seo_gsc_page   Search Console
- marketing.seo_ga4_daily    Google Analytics 4
- marketing.seo_page         checked pages (on-page checks, URL Inspection, PageSpeed)
- marketing.seo_keyword · seo_keyword_rank   tracked keywords + positions (Serper)
- marketing.seo_finding      rule findings and their workflow (Intelligence)
- marketing.seo_report       client reports (sign-off, send)
- marketing.seo_kpi          KPI Studio
- marketing.seo_sync_run     sync history

New tables only; nothing existing changes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "2eb8feb50f7b"
down_revision: Union[str, None] = "d12f9487db22"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('seo_connection',
    sa.Column('id', sa.String(length=30), nullable=False),
    sa.Column('google_email', sa.String(length=255), nullable=True),
    sa.Column('refresh_token_encrypted', sa.Text(), nullable=False),
    sa.Column('scopes', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=16), server_default='connected', nullable=False),
    sa.Column('last_error', sa.Text(), nullable=True),
    sa.Column('ga4_properties', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('connected_by_id', sa.String(length=30), nullable=True),
    sa.Column('connected_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_sync_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['connected_by_id'], ['auth.user.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    schema='marketing'
    )
    op.create_table('seo_kpi',
    sa.Column('key', sa.String(length=20), nullable=False),
    sa.Column('set', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=200), nullable=False),
    sa.Column('grader', sa.String(length=12), nullable=False),
    sa.Column('target', sa.String(length=120), nullable=False),
    sa.Column('source', sa.String(length=80), nullable=False),
    sa.Column('status', sa.String(length=10), nullable=False),
    sa.Column('sort', sa.Integer(), nullable=False),
    sa.Column('custom', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('updated_by_id', sa.String(length=30), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['updated_by_id'], ['auth.user.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('key'),
    schema='marketing'
    )
    op.create_table('seo_sync_run',
    sa.Column('id', sa.String(length=30), nullable=False),
    sa.Column('trigger', sa.String(length=12), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('started_by_id', sa.String(length=30), nullable=True),
    sa.Column('sites', sa.Integer(), nullable=False),
    sa.Column('sites_failed', sa.Integer(), nullable=False),
    sa.Column('gsc_days', sa.Integer(), nullable=False),
    sa.Column('pages_checked', sa.Integer(), nullable=False),
    sa.Column('rank_checks', sa.Integer(), nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['started_by_id'], ['auth.user.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    schema='marketing'
    )
    op.create_index('ix_seo_sync_run_started_at', 'seo_sync_run', ['started_at'], unique=False, schema='marketing')
    op.create_table('seo_site',
    sa.Column('id', sa.String(length=30), nullable=False),
    sa.Column('source', sa.String(length=10), server_default='GOOGLE', nullable=False),
    sa.Column('name', sa.String(length=300), nullable=False),
    sa.Column('domain', sa.String(length=253), nullable=False),
    sa.Column('home_url', sa.String(length=500), nullable=False),
    sa.Column('gsc_property', sa.String(length=500), nullable=True),
    sa.Column('gsc_permission', sa.String(length=40), nullable=True),
    sa.Column('ga4_property', sa.String(length=60), nullable=True),
    sa.Column('ga4_name', sa.String(length=300), nullable=True),
    sa.Column('merchant_id', sa.String(length=30), nullable=True),
    sa.Column('gbp_location_id', sa.String(length=30), nullable=True),
    sa.Column('ads_account_id', sa.String(length=30), nullable=True),
    sa.Column('segment', sa.String(length=40), server_default='Restaurant', nullable=False),
    sa.Column('package', sa.String(length=12), server_default='normal', nullable=False),
    sa.Column('owner_id', sa.String(length=30), nullable=True),
    sa.Column('report_cadence', sa.String(length=12), server_default='monthly', nullable=False),
    sa.Column('report_recipients', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('status', sa.String(length=10), server_default='active', nullable=False),
    sa.Column('last_synced_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('sync_error', sa.Text(), nullable=True),
    sa.Column('sync_warning', sa.Text(), nullable=True),
    sa.Column('last_gsc_date', sa.Date(), nullable=True),
    sa.Column('last_ga4_date', sa.Date(), nullable=True),
    sa.Column('last_crawl_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_psi_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('last_rank_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('health', sa.Integer(), nullable=True),
    sa.Column('pillars', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('scored_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['ads_account_id'], ['marketing.ads_account.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['gbp_location_id'], ['marketing.gbp_location.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['merchant_id'], ['profiling.merchant.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['owner_id'], ['auth.user.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('domain'),
    sa.UniqueConstraint('gsc_property'),
    schema='marketing'
    )
    op.create_index('ix_seo_site_merchant_id', 'seo_site', ['merchant_id'], unique=False, schema='marketing')
    op.create_table('seo_finding',
    sa.Column('id', sa.String(length=30), nullable=False),
    sa.Column('site_id', sa.String(length=30), nullable=False),
    sa.Column('fkey', sa.String(length=1100), nullable=False),
    sa.Column('code', sa.String(length=40), nullable=False),
    sa.Column('severity', sa.String(length=2), nullable=False),
    sa.Column('team', sa.String(length=30), nullable=False),
    sa.Column('title', sa.String(length=300), nullable=False),
    sa.Column('detail', sa.Text(), nullable=False),
    sa.Column('recommendation', sa.Text(), nullable=False),
    sa.Column('confidence', sa.String(length=8), nullable=False),
    sa.Column('impact', sa.String(length=8), nullable=False),
    sa.Column('effort', sa.String(length=8), nullable=False),
    sa.Column('page_url', sa.String(length=1000), nullable=True),
    sa.Column('evidence', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('state', sa.String(length=24), server_default='detected', nullable=False),
    sa.Column('owner_id', sa.String(length=30), nullable=True),
    sa.Column('note', sa.Text(), nullable=True),
    sa.Column('outcome', sa.String(length=12), nullable=True),
    sa.Column('detected_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['auth.user.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['site_id'], ['marketing.seo_site.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('site_id', 'fkey', name='uq_seo_finding_site_fkey'),
    schema='marketing'
    )
    op.create_index('ix_seo_finding_state', 'seo_finding', ['state'], unique=False, schema='marketing')
    op.create_table('seo_ga4_daily',
    sa.Column('site_id', sa.String(length=30), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('sessions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('users', sa.Integer(), server_default='0', nullable=False),
    sa.Column('engaged_sessions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('key_events', sa.Float(), server_default='0', nullable=False),
    sa.Column('organic_sessions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('organic_key_events', sa.Float(), server_default='0', nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['marketing.seo_site.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'date'),
    schema='marketing'
    )
    op.create_index('ix_seo_ga4_daily_date', 'seo_ga4_daily', ['date'], unique=False, schema='marketing')
    op.create_table('seo_gsc_daily',
    sa.Column('site_id', sa.String(length=30), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('clicks', sa.Integer(), server_default='0', nullable=False),
    sa.Column('impressions', sa.Integer(), server_default='0', nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['marketing.seo_site.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'date'),
    schema='marketing'
    )
    op.create_index('ix_seo_gsc_daily_date', 'seo_gsc_daily', ['date'], unique=False, schema='marketing')
    op.create_table('seo_gsc_page',
    sa.Column('site_id', sa.String(length=30), nullable=False),
    sa.Column('month', sa.Date(), nullable=False),
    sa.Column('page', sa.String(length=1000), nullable=False),
    sa.Column('clicks', sa.Integer(), nullable=False),
    sa.Column('impressions', sa.Integer(), nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['marketing.seo_site.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'month', 'page'),
    schema='marketing'
    )
    op.create_table('seo_gsc_query',
    sa.Column('site_id', sa.String(length=30), nullable=False),
    sa.Column('month', sa.Date(), nullable=False),
    sa.Column('query', sa.String(length=400), nullable=False),
    sa.Column('clicks', sa.Integer(), nullable=False),
    sa.Column('impressions', sa.Integer(), nullable=False),
    sa.Column('position', sa.Float(), nullable=True),
    sa.ForeignKeyConstraint(['site_id'], ['marketing.seo_site.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('site_id', 'month', 'query'),
    schema='marketing'
    )
    op.create_table('seo_keyword',
    sa.Column('id', sa.String(length=30), nullable=False),
    sa.Column('site_id', sa.String(length=30), nullable=False),
    sa.Column('keyword', sa.String(length=300), nullable=False),
    sa.Column('source', sa.String(length=10), server_default='manual', nullable=False),
    sa.Column('location', sa.String(length=200), nullable=True),
    sa.Column('active', sa.Boolean(), server_default='true', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['marketing.seo_site.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('site_id', 'keyword', name='uq_seo_keyword_site_keyword'),
    schema='marketing'
    )
    op.create_table('seo_page',
    sa.Column('id', sa.String(length=30), nullable=False),
    sa.Column('site_id', sa.String(length=30), nullable=False),
    sa.Column('url', sa.String(length=1000), nullable=False),
    sa.Column('page_type', sa.String(length=12), server_default='other', nullable=False),
    sa.Column('status_code', sa.Integer(), nullable=True),
    sa.Column('final_url', sa.String(length=1000), nullable=True),
    sa.Column('title', sa.String(length=600), nullable=True),
    sa.Column('meta_description', sa.Text(), nullable=True),
    sa.Column('h1_count', sa.Integer(), nullable=True),
    sa.Column('canonical', sa.String(length=1000), nullable=True),
    sa.Column('noindex', sa.Boolean(), nullable=True),
    sa.Column('word_count', sa.Integer(), nullable=True),
    sa.Column('img_total', sa.Integer(), nullable=True),
    sa.Column('img_with_alt', sa.Integer(), nullable=True),
    sa.Column('schema_types', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('last_crawl_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('crawl_error', sa.Text(), nullable=True),
    sa.Column('index_verdict', sa.String(length=24), nullable=True),
    sa.Column('coverage_state', sa.String(length=200), nullable=True),
    sa.Column('inspected_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('psi_score', sa.Integer(), nullable=True),
    sa.Column('lcp_ms', sa.Integer(), nullable=True),
    sa.Column('cls', sa.Float(), nullable=True),
    sa.Column('inp_ms', sa.Integer(), nullable=True),
    sa.Column('cwv', sa.String(length=8), nullable=True),
    sa.Column('psi_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('issues', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['site_id'], ['marketing.seo_site.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('site_id', 'url', name='uq_seo_page_site_url'),
    schema='marketing'
    )
    op.create_table('seo_report',
    sa.Column('id', sa.String(length=30), nullable=False),
    sa.Column('site_id', sa.String(length=30), nullable=False),
    sa.Column('period_start', sa.Date(), nullable=False),
    sa.Column('period_end', sa.Date(), nullable=False),
    sa.Column('cadence', sa.String(length=12), nullable=False),
    sa.Column('status', sa.String(length=20), nullable=False),
    sa.Column('snapshot', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    sa.Column('generated_by_id', sa.String(length=30), nullable=True),
    sa.Column('generated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('signed_by_id', sa.String(length=30), nullable=True),
    sa.Column('signed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('sent_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('recipients', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False),
    sa.Column('error', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.ForeignKeyConstraint(['generated_by_id'], ['auth.user.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['signed_by_id'], ['auth.user.id'], ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['site_id'], ['marketing.seo_site.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('site_id', 'period_start', 'period_end', name='uq_seo_report_site_period'),
    schema='marketing'
    )
    op.create_index('ix_seo_report_status', 'seo_report', ['status'], unique=False, schema='marketing')
    op.create_table('seo_keyword_rank',
    sa.Column('keyword_id', sa.String(length=30), nullable=False),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('position', sa.Integer(), nullable=True),
    sa.Column('url', sa.String(length=1000), nullable=True),
    sa.Column('local_pack', sa.Boolean(), nullable=True),
    sa.ForeignKeyConstraint(['keyword_id'], ['marketing.seo_keyword.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('keyword_id', 'date'),
    schema='marketing'
    )


def downgrade() -> None:
    op.drop_table('seo_keyword_rank', schema='marketing')
    op.drop_index('ix_seo_report_status', table_name='seo_report', schema='marketing')
    op.drop_table('seo_report', schema='marketing')
    op.drop_table('seo_page', schema='marketing')
    op.drop_table('seo_keyword', schema='marketing')
    op.drop_table('seo_gsc_query', schema='marketing')
    op.drop_table('seo_gsc_page', schema='marketing')
    op.drop_index('ix_seo_gsc_daily_date', table_name='seo_gsc_daily', schema='marketing')
    op.drop_table('seo_gsc_daily', schema='marketing')
    op.drop_index('ix_seo_ga4_daily_date', table_name='seo_ga4_daily', schema='marketing')
    op.drop_table('seo_ga4_daily', schema='marketing')
    op.drop_index('ix_seo_finding_state', table_name='seo_finding', schema='marketing')
    op.drop_table('seo_finding', schema='marketing')
    op.drop_index('ix_seo_site_merchant_id', table_name='seo_site', schema='marketing')
    op.drop_table('seo_site', schema='marketing')
    op.drop_index('ix_seo_sync_run_started_at', table_name='seo_sync_run', schema='marketing')
    op.drop_table('seo_sync_run', schema='marketing')
    op.drop_table('seo_kpi', schema='marketing')
    op.drop_table('seo_connection', schema='marketing')
