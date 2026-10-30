/** SEO module types — mirror the API's modules/seo responses (camelCase). */

export type Severity = "S1" | "S2" | "S3";
export type FindingState = "detected" | "recommended" | "task_created" | "in_progress" | "awaiting_verification" | "closed";
export type FindingGroup = "needs_decision" | "in_flight" | "awaiting_verification" | "closed";
export type Package = "normal" | "199" | "299" | "internal";
export type Cadence = "biweekly" | "monthly" | "quarterly";
export type SiteSyncState = "ok" | "issue" | "never";
export type SourceState = "connected" | "pending" | "error" | "sample" | "placeholder";
export type PillarKey = "cp" | "ws" | "au" | "rt" | "ls" | "pa";
export type ReportStatus = "awaiting_signoff" | "signed" | "sent" | "failed";

export interface Ref {
  id: string;
  name: string | null;
}
export interface SiteRef {
  id: string;
  name: string;
  domain: string;
}

export interface SyncRun {
  id: string;
  trigger: "manual" | "schedule" | "connect";
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  sites: number;
  sitesFailed: number;
  gscDays: number;
  pagesChecked: number;
  error: string | null;
}

export interface Source {
  key: string;
  label: string;
  state: SourceState;
  detail?: string;
}

export interface SeoStatus {
  missingEnv: string[];
  redirectUri: string;
  connected: boolean;
  connection: {
    email: string | null;
    status: "connected" | "error";
    error: string | null;
    connectedAt: string;
    connectedBy: string | null;
    lastSyncAt: string | null;
    scopes: { searchConsole: boolean; analytics: boolean; gmail: boolean };
    ga4Properties: number;
  } | null;
  keys: { pagespeed: boolean; email: boolean };
  /** Client-report e-mail: sent through Gmail as the Google account connected for SEO. */
  email: { configured: boolean; state: "ready" | "not_connected" | "no_permission" | "error"; provider: string; from: string | null; fromName: string };
  lastRun: SyncRun | null;
  running: boolean;
  sites: { google: number; manual: number; demo: number };
  dataThrough: string | null;
  canManage: boolean;
  canApprove: boolean;
  autoSync: { enabled: boolean; hour: number; timezone: string; nextAt: string | null };
  sources: Source[];
}

export interface PillarMeta {
  key: PillarKey;
  label: string;
  long: string;
  weight: number;
  source: string;
}

export interface OverviewRow extends SiteRef {
  segment: string;
  package: Package;
  status: "active" | "paused";
  source: string;
  isDemo: boolean;
  owner: Ref | null;
  merchant: Ref | null;
  health: number | null;
  grade: string | null;
  pillars: Record<PillarKey, number | null>;
  localGrade: string | null;
  s1: number;
  s2: number;
  s3: number;
  crit: number;
  clicks: number;
  clicksChange: number | null;
  sessions: number | null;
  spark: number[] | null;
  auditedAt: string | null;
  gscLinked: boolean;
  ga4Linked: boolean;
  trackingBroken: boolean | null;
  syncState: SiteSyncState;
}

export interface Overview {
  dataThrough: string | null;
  summary: {
    sites: number;
    active: number;
    s1: number;
    s2: number;
    s3: number;
    s1Overdue: number;
    tracking: { linked: number; healthy: number; broken: number; pct: number | null };
    pendingConnections: number;
    reportsDue7: number;
    avgHealth: number | null;
    scored: number;
  };
  sources: Source[];
  pillarMeta: PillarMeta[];
  rows: OverviewRow[];
}

export interface WatchItem {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  state: FindingState;
  site: SiteRef;
  detectedAt: string;
  overdue: boolean;
  team: string;
}
export interface Watchdog {
  counts: Record<Severity, number>;
  data: WatchItem[];
}

export interface Finding {
  id: string;
  site: SiteRef;
  code: string;
  severity: Severity;
  team: string;
  title: string;
  detail: string;
  recommendation: string;
  confidence: string;
  impact: string;
  effort: string;
  pageUrl: string | null;
  evidence: Record<string, unknown>;
  state: FindingState;
  outcome: "fixed" | "resolved" | "dismissed" | null;
  note: string | null;
  owner: Ref | null;
  detectedAt: string;
  lastSeenAt: string;
  closedAt: string | null;
  slaDue: string;
  overdue: boolean;
  isDemo: boolean;
}

export interface FindingList {
  counts: { needsDecision: number; inFlight: number; awaitingVerification: number; closed7d: number };
  total: number;
  data: Finding[];
}

export interface FindingQuery {
  severity?: Severity;
  group?: FindingGroup;
  team?: string;
  owner?: string;
  siteId?: string;
  q?: string;
}

export interface PillarPart {
  label: string;
  value: string;
  points: number;
  max: number;
}
export interface Pillar {
  label: string;
  weight: number;
  score: number | null;
  grade: string | null;
  parts: PillarPart[];
  missing: string | null;
}
export interface Scorecard {
  health: number | null;
  grade: string | null;
  method: string;
  pillarsScored: number;
  pillars: Record<PillarKey, Pillar>;
}

export interface QueryRow {
  query: string;
  clicks: number;
  impressions?: number;
  position: number | null;
  prevClicks: number | null;
  prevPosition: number | null;
}

export interface KeywordRow {
  id: string;
  keyword: string;
  source: "gsc" | "manual";
  active: boolean;
  /** Search Console average position, last full month; null = no impressions that month. */
  position: number | null;
  /** The month before. */
  previous: number | null;
  hasPrevious: boolean;
  clicks: number;
  prevClicks: number;
  impressions: number;
}

export interface ReportRef {
  id: string;
  status: ReportStatus;
  periodStart: string;
  periodEnd: string;
  cadence: Cadence;
  generatedAt: string;
  signedAt: string | null;
  sentAt: string | null;
  error: string | null;
  auto: boolean;
  label: string | null;
}

export interface SiteDetail extends SiteRef {
  homeUrl: string;
  segment: string;
  package: Package;
  packageLabel: string;
  status: "active" | "paused";
  source: string;
  isDemo: boolean;
  owner: Ref | null;
  reportCadence: Cadence;
  links: {
    merchant: Ref | null;
    gbpLocation: { id: string; title: string; isDemo: boolean } | null;
    adsAccount: Ref | null;
  };
  gscProperty: string | null;
  ga4Property: string | null;
  ga4Name: string | null;
  sync: {
    state: SiteSyncState;
    lastSyncedAt: string | null;
    error: string | null;
    warning: string | null;
    gscThrough: string | null;
    ga4Through: string | null;
    lastCrawlAt: string | null;
    lastPsiAt: string | null;
  };
  score: Scorecard | null;
  health: number | null;
  grade: string | null;
  pillarMeta: PillarMeta[];
  kpis: Partial<{
    clicks: number;
    clicksPrev: number;
    impressions: number;
    impressionsPrev: number;
    ctr: number | null;
    ctrPrev: number | null;
    position: number | null;
    positionPrev: number | null;
    sessions: number;
    sessionsPrev: number;
    organicSessions: number;
    organicSessionsPrev: number;
    keyEvents: number;
    keyEventsPrev: number;
    /** Different searches the site showed up for in Search Console (last full month / the one before). */
    rankingSearches: number;
    rankingSearchesPrev: number | null;
    top10Searches: number;
    top10SearchesPrev: number | null;
    rankingMonth: string;
    rankingPrevMonth: string;
  }>;
  trend: { weeks: number; clicks: number[] | null; sessions: number[] | null; end: string };
  findings: Finding[];
  local: {
    locationId: string;
    title: string;
    profilePct: number;
    verification: string;
    openStatus: string;
    rating: number | null;
    reviews: number | null;
    websiteUrl: string | null;
    websiteMatches: boolean;
    hoursSet: boolean;
    categoriesSet: boolean;
    missingFields: string[];
    actions: { calls: number; directions: number; website: number; callsPrev: number; directionsPrev: number; websitePrev: number; through: string } | null;
  } | null;
  queries: { month: string | null; prevMonth: string | null; rows: QueryRow[] };
  topPages: { url: string; path: string; clicks: number; impressions: number; position: number | null }[];
  keywords: KeywordRow[];
  keywordMonths: { month: string | null; prevMonth: string | null };
  reports: ReportRef[];
  nextReport: { periodStart: string; periodEnd: string; due: string };
  placeholders: { key: string; label: string; source: string }[];
  /** Extra data from the newest Screaming Frog crawl (null fields = not in that export → stays Pending). */
  sfExtras: SfExtras;
}

export interface PageIssue {
  code: string;
  severity: Severity;
  label: string;
}
export interface PageRow {
  url: string;
  path: string;
  type: string;
  clicks: number;
  impressions: number;
  position: number | null;
  checked: boolean;
  statusCode: number | null;
  crawlError: string | null;
  title: string | null;
  titleLength: number | null;
  metaLength: number | null;
  metaDescription: string | null;
  canonical: string | null;
  wordCount: number | null;
  imgTotal: number | null;
  imgWithAlt: number | null;
  h1Count: number | null;
  noindex: boolean | null;
  schemaTypes: string[];
  indexVerdict: string | null;
  coverageState: string | null;
  psiScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  cwv: "pass" | "fail" | "none" | null;
  issues: PageIssue[];
  lastCrawlAt: string | null;
}
export interface SitePages {
  site: SiteRef;
  month: string | null;
  isDemo: boolean;
  types: Record<string, number>;
  rows: PageRow[];
}

export interface SiteSettingsRow extends SiteRef {
  homeUrl: string;
  source: string;
  isDemo: boolean;
  status: "active" | "paused";
  segment: string;
  package: Package;
  reportCadence: Cadence;
  /** Typed by hand in Site settings. */
  reportRecipients: string[];
  /** Owner / Marketing contacts of the linked merchant (automatic). */
  merchantRecipients: MerchantRecipient[];
  /** Both lists merged, no duplicates — who gets the report. */
  allRecipients: string[];
  owner: Ref | null;
  gscProperty: string | null;
  gscPermission: string | null;
  ga4Property: string | null;
  ga4Name: string | null;
  merchant: Ref | null;
  gbpLocation: { id: string; title: string } | null;
  adsAccount: Ref | null;
  syncState: SiteSyncState;
  syncError: string | null;
  syncWarning: string | null;
  lastSyncedAt: string | null;
}
export interface SitesList {
  data: SiteSettingsRow[];
  packages: Record<Package, { label: string; cadence: Cadence; reports: string }>;
  segments: string[];
  cadences: Cadence[];
}

export interface SiteInput {
  name?: string;
  merchantId?: string | null;
  gbpLocationId?: string | null;
  adsAccountId?: string | null;
  ga4Property?: string | null;
  package?: Package;
  segment?: string;
  ownerId?: string | null;
  reportCadence?: Cadence;
  reportRecipients?: string[];
  status?: "active" | "paused";
}

export interface LinkOptions {
  merchants: Ref[];
  gbpLocations: { id: string; title: string; city: string | null; isDemo: boolean }[];
  adsAccounts: { id: string; name: string; isDemo: boolean }[];
  owners: Ref[];
  ga4Properties: { property: string; name: string; account: string | null; hosts: string[] }[];
}

export interface ReportsCenter {
  days: number;
  tiles: { sent: number; awaitingSignoff: number; signed: number; failed: number; due7: number; overdue: number; autoAssembled: number; total: number };
  packages: { key: Package; label: string; reports: string; projects: number; series: number[]; avgClicks4w: number | null; change: number | null }[];
  topRisk: (SiteRef & { package: Package; isDemo: boolean; health: number | null; grade: string | null; clicksChange: number | null; risk: number; open: Record<Severity, number> })[];
  topPerforming: (SiteRef & { package: Package; isDemo: boolean; health: number | null; grade: string | null; clicksChange: number | null })[];
  projects: (SiteRef & {
    package: Package;
    cadence: Cadence;
    status: "active" | "paused";
    isDemo: boolean;
    health: number | null;
    grade: string | null;
    recipients: number;
    latest: ReportRef | null;
    due: { periodStart: string; periodEnd: string; due: string; inDays: number; reportId: string | null; reportStatus: ReportStatus | null } | null;
  })[];
  emailConfigured: boolean;
}

export interface Metric {
  value: number;
  prev: number;
  change: number | null;
}
export interface ReportMonthRow {
  month: string;
  label: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  clicksChange: number | null;
}
export interface BrandBucket {
  clicks: number;
  impressions: number;
  queries: number;
  ctr: number | null;
}
export interface ReportOppQuery {
  query: string;
  clicks: number;
  impressions: number;
  position: number | null;
}
export type ReportNoteKey = "metrics" | "brand" | "highlight" | "progress" | "queries" | "pages" | "devices" | "geo" | "crawl";

export interface ReportV2 {
  version: 2;
  month: string;
  monthLabel: string;
  prevMonth: string;
  prevMonthLabel: string;
  alert: { title: string; text: string } | null;
  summary: string[];
  summaryEdited: boolean;
  /** Paragraph(s) under each table, written from rules; editable until sign-off. Older reports don't have them. */
  notes?: Partial<Record<ReportNoteKey, string[]>>;
  notesEdited?: ReportNoteKey[];
  progress?: { title: string; note: string; items: { text: string; evidence: string | null }[] } | null;
  /** Largest non-branded searches by impressions (chart); older reports don't have it. */
  genericQueries?: { query: string; impressions: number; clicks: number; position: number | null }[];
  keyMetrics: { cur: ReportMonthRow | null; prev: ReportMonthRow | null };
  months: ReportMonthRow[];
  brand: { branded: BrandBucket; generic: BrandBucket; trackedClicks: number; brandedShare: number | null; tokens: string[] } | null;
  brandPrev: { branded: BrandBucket; generic: BrandBucket; trackedClicks: number; brandedShare: number | null } | null;
  highlight: {
    kind: "security" | "opportunity";
    title: string;
    text: string;
    rows?: { path: string; impressions: number; prevImpressions: number; position: number | null; status: string }[];
    queries?: ReportOppQuery[];
  } | null;
  queries: { query: string; clicks: number; impressions: number; ctr: number | null; position: number | null; prevClicks: number | null; prevPosition: number | null }[];
  pages: { path: string; clicks: number; impressions: number; position: number | null; prevClicks: number | null; prevImpressions: number | null; spam: boolean }[];
  devices: { device: string; clicks: number; prevClicks: number | null; impressions: number; prevImpressions: number | null; ctr: number | null; position: number | null; prevPosition: number | null }[];
  countries: { home: string; homeClicks: number; totalClicks: number; homeShare: number | null; otherImpressions: number; otherClicks: number; top: { country: string; clicks: number; impressions: number }[] } | null;
  spam: { path: string; impressions: number; prevImpressions: number; position: number | null; status: string }[];
  recommendations: string[];
  dataNotes: string[];
  sources: string;
}
export interface ReportSnapshot {
  site: { name: string; domain: string; package: Package; packageLabel: string; segment: string };
  period: { start: string; end: string; label: string; cadence: Cadence };
  previous: { start: string; end: string };
  health: number | null;
  grade: string | null;
  method: string;
  pillars: Record<string, { label: string; score: number | null; grade: string | null }>;
  firstGlance: Partial<{
    organicClicks: Metric;
    impressions: Metric;
    ctr: { value: number | null; prev: number | null };
    position: { value: number | null; prev: number | null };
    users: Metric;
    sessions: Metric;
    organicSessions: Metric;
    keyEvents: Metric;
  }>;
  whatChanged: string[];
  dailyClicks: { date: string; clicks: number }[];
  /** Added Oct 2026 — older snapshots don't have these. */
  prevDailyClicks?: { date: string; clicks: number }[];
  queriesMonth: string;
  prevQueriesMonth?: string;
  nextSteps?: string[];
  queries: QueryRow[];
  pages: { path: string; clicks: number; impressions: number }[];
  keywords: { keyword: string; position: number | null; previous: number | null; hasPrevious: boolean }[];
  local: { calls: Metric; directions: Metric; website: Metric; views?: Metric } | null;
  findings: { fixed: { severity: Severity; title: string }[]; open: { severity: Severity; title: string }[]; openCount: number };
  pending: string[];
  /** Newest full-site crawl (Screaming Frog import), if any. */
  crawl?: ReportCrawl | null;
  /** Monthly report in the SEO team's format (reports generated after 2026-10-20). */
  v2?: ReportV2;
  notes: string[];
  isDemo: boolean;
}
export interface Report extends ReportRef {
  site: SiteRef | null;
  snapshot: ReportSnapshot;
  generatedBy: Ref | null;
  signedBy: Ref | null;
  recipients: string[];
  defaultRecipients: string[];
  recipientSources: { fromMerchant: MerchantRecipient[]; manual: string[] };
  emailConfigured: boolean;
}

export interface KpiCurrent {
  text: string;
  n: number | null;
  tone: "neutral" | "ok" | "warning" | "hold";
}
export interface Kpi {
  key: string;
  name: string;
  grader: "score" | "band" | "sla" | "gate" | "trend";
  target: string;
  source: string;
  status: "proposed" | "active" | "retired";
  custom: boolean;
  current: KpiCurrent | null;
}
export interface KpiStudio {
  sets: { set: number; label: string; note: string; kpis: Kpi[] }[];
  graders: Kpi["grader"][];
  statuses: Kpi["status"][];
}

export interface CompareSite extends SiteRef {
  package: Package;
  segment: string;
  isDemo: boolean;
  health: number | null;
  grade: string | null;
  pillars: Record<PillarKey, number | null>;
  kpis: SiteDetail["kpis"];
  trend: SiteDetail["trend"];
  open: Record<Severity, number>;
  queries: QueryRow[];
  localGrade: string | null;
  psiAvg: number | null;
}
export interface Compare {
  pillarMeta: PillarMeta[];
  sites: CompareSite[];
}

export interface MerchantSeoSite extends SiteRef {
  health: number | null;
  grade: string | null;
  pillars: Record<PillarKey, number | null>;
  open: Record<Severity, number>;
  isDemo: boolean;
}

export interface MerchantRecipient {
  email: string;
  name: string | null;
  role: string;
}

/* ------------------------------------------- full-site crawl (Screaming Frog import) ---- */
export interface CrawlTotals {
  urls: number;
  html: number;
  indexable: number;
  nonIndexable: number;
  statuses: Record<string, number>;
  errors4xx: number;
  errors5xx: number;
  redirects: number;
  avgWords: number | null;
  avgResponseMs: number | null;
  depth: Record<string, number>;
  issueTypes: Partial<Record<"High" | "Medium" | "Low", number>>;
  issuesWithUrls: number;
  orphans: number | null;
  redirectChains: number | null;
  schemaErrors: number | null;
  nearDuplicatePages: number;
}
export interface CrawlIssue {
  key: string;
  name: string;
  type: "Issue" | "Warning" | "Opportunity" | string;
  priority: "High" | "Medium" | "Low" | string;
  urls: number;
  pct: number | null;
  description: string | null;
  howToFix: string | null;
  helpUrl: string | null;
  sample: ({ url: string | null } & Record<string, string | null>)[];
  linksSample: { source: string | null; destination: string | null; anchor: string | null; status: string | null }[];
  prevUrls: number | null;
}
export interface NapItem {
  state: "match" | "different" | "not_found" | "no_listing_value";
  site: string | null;
  google: string | null;
  other?: string | null;
  missing?: string | null;
}
export interface SfExtras {
  crawledAt: string | null;
  linkMetrics: {
    provider: "Moz" | "Majestic" | "Ahrefs";
    authorityLabel: string;
    authority: number | null;
    referringDomains: number | null;
    backlinks: number | null;
    pageAuthorityHome: number | null;
    spamScore: number | null;
    pages: number;
    top: { path: string; referringDomains: number | null; backlinks: number | null }[];
  } | null;
  nap: {
    pages: number;
    extractors: string[];
    phones: { value: string; digits: string; pages: number }[];
    streets: { value: string; pages: number }[];
    hours: { value: string; pages: number }[];
  } | null;
  /** The website's phone / address / hours vs the linked Google Business Profile listing. */
  napCheck: { phone: NapItem; address: NapItem; hours: NapItem } | null;
}
export interface CrawlSection {
  key: "home" | "menu" | "info" | "location" | "blog" | "other";
  label: string;
  pages: number;
  broken: number;
  /** HTML pages answering 200 that Google isn't allowed to index. */
  blocked: number;
  withErrors: number;
  /** % of the section's pages with no errors (same rule as the Audits pillar). */
  clean: number;
  avgWords: number | null;
  thin: boolean;
  examples: string[];
  topIssue: { key: string; name: string; priority: string; pages: number } | null;
}
export interface CrawlOverview {
  crawl: { id: string; source: string; crawledAt: string | null; importedAt: string; totals: CrawlTotals } | null;
  issues: CrawlIssue[];
  /** The crawl broken down by part of the site (read-only; doesn't change any score). */
  sections: CrawlSection[];
  history: { id: string; crawledAt: string | null; urls: number; issueTypes: CrawlTotals["issueTypes"] }[];
}
export interface CrawlPageQuery {
  q?: string;
  issue?: string;
  kind?: "html" | "all" | "nonindexable" | "errors";
  sort?: "score" | "depth" | "words" | "inlinks" | "issues" | "response";
  offset?: number;
  limit?: number;
}
export interface CrawlPageRow {
  url: string;
  path: string;
  contentType: string | null;
  statusCode: number | null;
  indexable: boolean | null;
  indexabilityStatus: string | null;
  title: string | null;
  titleLength: number | null;
  metaDescription: string | null;
  metaLength: number | null;
  h1: string | null;
  canonical: string | null;
  wordCount: number | null;
  readability: number | null;
  crawlDepth: number | null;
  inlinks: number | null;
  outlinks: number | null;
  externalOutlinks: number | null;
  linkScore: number | null;
  responseMs: number | null;
  sizeBytes: number | null;
  redirectUrl: string | null;
  issues: string[];
}
export interface CrawlPages {
  total: number;
  rows: CrawlPageRow[];
  issueNames: Record<string, string>;
}

export interface ReportCrawl {
  source: string;
  crawledAt: string | null;
  pages: number | null;
  indexable: number | null;
  nonIndexable: number | null;
  broken: number;
  redirects: number | null;
  orphans: number | null;
  avgWords: number | null;
  issueTypes: Partial<Record<"High" | "Medium" | "Low", number>>;
  hasPrevious: boolean;
  top: { name: string; type: string; priority: string; urls: number; prevUrls: number | null }[];
}

/* ------------------------------------------------------- Blog Impact ---- */
/** API modules/seo/blog_router.py. Impact numbers use final Search Console days only. */
export interface BlogSchedule {
  enabled: boolean;
  times: string[]; // "HH:MM"
  timezone: string;
  nextAt: string | null;
  checkEveryMinutes: number;
  updatedAt: string | null;
}
export interface BlogRun {
  id: string;
  trigger: "schedule" | "manual";
  status: "running" | "success" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  sites: number;
  sitesUnchanged: number;
  sitesFailed: number;
  rows: number;
  error: string | null;
}
export interface BlogStatus {
  schedule: BlogSchedule;
  lastRun: BlogRun | null;
  running: boolean;
  /** While a run is going: how many sites it has to do (lastRun.sites = done so far). */
  sitesTotal: number | null;
  connected: boolean;
  inline: boolean;
}
export interface BlogSiteOption {
  id: string;
  name: string;
  domain: string;
  status: string;
  posts: number;
  checkedAt: string | null;
}
export interface BlogPostRow {
  id: string;
  url: string;
  path: string;
  title: string | null;
  publishedOn: string | null;
  source: "wordpress" | "sitemap" | "crawler";
  indexVerdict: string | null;
  coverageState: string | null;
  indexed: boolean;
  indexedOn: string | null;
  daysToIndex: number | null;
  lastCrawlAt: string | null;
  inspectedAt: string | null;
  clicks: number;
  impressions: number;
  ctr: number | null; // percent
  position: number | null;
  freshClicks: number;
  freshImpressions: number;
  topQuery: string | null;
  sessions: number;
  organicSessions: number;
  orderClicks: number;
}
export interface BlogEarly {
  id: string;
  title: string | null;
  url: string;
  publishedOn: string | null;
  lastCrawlAt: string | null;
  indexed: boolean;
  daysToIndex: number | null;
  impressions: number;
  clicks: number;
  series: { date: string; impressions: number }[];
}
export interface BlogBeforeAfter {
  firstPostOn: string;
  available: boolean;
  reason?: string;
  days?: number;
  before?: { start: string; end: string };
  after?: { start: string; end: string };
  metrics?: { key: string; label: string; before: number; after: number; changePct: number | null }[];
}
export interface BlogImpact {
  site: { id: string; name: string; domain: string; hasGa4: boolean };
  /** "us": Search Console searches and GA4 visitors from the United States only. */
  country: "all" | "us";
  /** false in US mode until a refresh has fetched the US numbers (right after the update). */
  countryReady: boolean;
  freshness: {
    checkedAt: string | null;
    changedAt: string | null;
    finalThrough: string | null;
    freshThroughHour: string | null;
    ga4Through: string | null;
    discoveredOn: string | null;
    error: string | null;
    warning: string | null;
    brandTerms: string[];
  };
  window: { days: number; start: string; end: string; prevStart: string; prevEnd: string; ga4Start: string; ga4End: string };
  kpis: {
    postsLive: number;
    postsThisMonth: number;
    postsIndexed: number;
    avgDaysToIndex: number | null;
    clicks: number;
    clicksPrev: number;
    clicksChangePct: number | null;
    impressions: number;
    impressionsPrev: number;
    impressionsChangePct: number | null;
    shareOfOrganicClicks: number | null;
    shareOfOrganicClicksPrev: number | null;
    orderClicks: number;
    orderClicksPrev: number;
  };
  weeks: { start: string; end: string; blogClicks: number; otherClicks: number; published: number }[];
  beforeAfter: BlogBeforeAfter | null;
  early: BlogEarly[];
  posts: BlogPostRow[];
}

/* ------------------------------------------------- Screaming Frog crawler ---- */

/** saving: the helper's export arrived and the Super App is storing it and updating the scores. */
export type CrawlJobStatus = "queued" | "running" | "saving" | "done" | "failed" | "cancelled";

export interface CrawlJob {
  id: string;
  siteId: string;
  siteName: string | null;
  domain: string;
  url: string;
  status: CrawlJobStatus;
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  /** The helper PC that took it, e.g. "Usama laptop". */
  helper: string | null;
  message: string | null;
  crawlId: string | null;
  urls: number | null;
  durationSec: number | null;
}

export interface CrawlerKey {
  id: string;
  name: string;
  /** Last 4 characters of the key. */
  hint: string;
  createdAt: string | null;
  revokedAt: string | null;
  lastSeenAt: string | null;
  helperName: string | null;
  helperVersion: string | null;
  online: boolean;
}

export interface CrawlerStatus {
  helpers: CrawlerKey[];
  online: number;
  lastSeenAt: string | null;
  queued: number;
  running: number;
  saving: number;
  /** Latest job per site, with the site's last crawl time. */
  sites: Record<string, CrawlJob & { lastCrawledAt: string | null }>;
  recent: CrawlJob[];
}

export interface QueueResult {
  queued: number;
  skipped: number;
  jobs: CrawlJob[];
}
