"""Entity -> response DTO mappers for merchant-profiling."""
from __future__ import annotations

from app.models.enums import MerchantStatus

from app.models.boundary import Promotion
from app.models.profiling import (
    AccessItem,
    AccountManager,
    BrandAsset,
    BrandProfile,
    CateringProfile,
    Competitor,
    Contact,
    Document,
    Keyword,
    Location,
    Merchant,
    MerchantService,
    Subscription,
)
from app.schemas.merchant_profiling import (
    AccountManagerRefDto,
    AccountManagerResponseDto,
    BrandAssetResponseDto,
    BrandProfileResponseDto,
    CateringProfileResponseDto,
    CompetitorResponseDto,
    ConnectionResponseDto,
    ContactResponseDto,
    DocumentResponseDto,
    KeywordResponseDto,
    LocationResponseDto,
    MerchantResponseDto,
    MerchantServiceResponseDto,
    MerchantSubscriptionDto,
    PromotionResponseDto,
    SubscriptionResponseDto,
)


def subscription_to_dto(sub: Subscription | None) -> MerchantSubscriptionDto | None:
    if not sub:
        return None
    return MerchantSubscriptionDto(
        package={"code": sub.package.code, "name": sub.package.name, "price": str(sub.package.price)},
        status=sub.status,
        startDate=sub.start_date,
        renewalDate=sub.renewal_date,
        mrr=str(sub.mrr) if sub.mrr is not None else None,
        isCurrent=sub.is_current,
    )


def merchant_to_dto(m: Merchant) -> MerchantResponseDto:
    return MerchantResponseDto(
        id=m.id,
        merchantCode=m.merchant_code,
        restaurantName=m.restaurant_name,
        status=m.status or MerchantStatus.ACTIVE,
        region=m.region,
        innowiSolution=m.innowi_solution,
        accountTier=m.account_tier,
        source=m.source,
        sourceDetail=m.source_detail,
        legalName=m.legal_name,
        cuisineCategory=m.cuisine_category,
        websiteUrl=m.website_url,
        websitePlatform=m.website_platform,
        onlineOrdering=m.online_ordering,
        posSystem=m.pos_system,
        customerListSource=m.customer_list_source,
        googleAdsBudget=str(m.google_ads_budget) if m.google_ads_budget is not None else None,
        metaAdsBudget=str(m.meta_ads_budget) if m.meta_ads_budget is not None else None,
        businessGoals=m.business_goals,
        targetAudience=m.target_audience,
        slowDayparts=m.slow_dayparts,
        seasonalPeaks=m.seasonal_peaks,
        alcoholLicense=m.alcohol_license,
        dietaryCerts=m.dietary_certs,
        locationCount=m.location_count,
        reportFrequency=m.report_frequency,
        reportRecipients=m.report_recipients,
        accountHealth=m.account_health,
        profileCompletionPct=m.profile_completion_pct,
        nextAction=m.next_action,
        openBlockers=m.open_blockers,
        notes=m.notes,
        onboardingDate=m.onboarding_date,
        goLiveDate=m.go_live_date,
        accountManagerId=m.account_manager_id,
        accountManager=AccountManagerRefDto(id=m.account_manager.id, name=m.account_manager.name) if m.account_manager else None,
        subscription=subscription_to_dto(m.subscription),
        createdAt=m.created_at,
        updatedAt=m.updated_at,
    )


def contact_to_dto(c: Contact) -> ContactResponseDto:
    return ContactResponseDto(
        id=c.id, merchantId=c.merchant_id, name=c.name, role=c.role, email=c.email, phone=c.phone,
        preferredChannel=c.preferred_channel, language=c.language, responsiveness=c.responsiveness,
        createdAt=c.created_at, updatedAt=c.updated_at,
    )


def location_to_dto(l: Location) -> LocationResponseDto:
    return LocationResponseDto(
        id=l.id, merchantId=l.merchant_id, address=l.address, city=l.city, state=l.state, zip=l.zip,
        hours=l.hours, timezone=l.timezone, isPrimary=l.is_primary, napStatus=l.nap_status,
        createdAt=l.created_at, updatedAt=l.updated_at,
    )


def merchant_service_to_dto(ms: MerchantService) -> MerchantServiceResponseDto:
    return MerchantServiceResponseDto(
        id=ms.id, merchantId=ms.merchant_id, serviceId=ms.service_id, serviceName=ms.service.name,
        serviceCategory=ms.service.category.value, status=ms.status, activatedAt=ms.activated_at,
        notes=ms.notes, createdAt=ms.created_at, updatedAt=ms.updated_at,
    )


def document_to_dto(d: Document, storage) -> DocumentResponseDto:
    has_file = storage.is_managed(d.storage_url)
    return DocumentResponseDto(
        id=d.id, merchantId=d.merchant_id, locationId=d.location_id, category=d.category, fileName=d.file_name,
        storageUrl=d.storage_url, mimeType=d.mime_type, sizeBytes=d.size_bytes, version=d.version,
        uploadedBy=d.uploaded_by, status=d.status, createdAt=d.created_at, updatedAt=d.updated_at,
        hasFile=has_file, downloadPath=f"/api/v1/documents/{d.id}/download" if has_file else None,
    )


def connection_to_dto(c: AccessItem) -> ConnectionResponseDto:
    return ConnectionResponseDto(
        id=c.id, merchantId=c.merchant_id, accessItem=c.access_item, criticality=c.criticality, status=c.status,
        flag=c.flag, owner=c.owner, notes=c.notes, dateRequested=c.date_requested, dateReceived=c.date_received,
        verified=c.verified, verifiedDate=c.verified_date, expiry=c.expiry, createdAt=c.created_at, updatedAt=c.updated_at,
    )


def keyword_to_dto(k: Keyword) -> KeywordResponseDto:
    return KeywordResponseDto(id=k.id, merchantId=k.merchant_id, term=k.term, type=k.type, createdAt=k.created_at)


def competitor_to_dto(c: Competitor) -> CompetitorResponseDto:
    return CompetitorResponseDto(id=c.id, merchantId=c.merchant_id, name=c.name, rank=c.rank, createdAt=c.created_at)


def brand_profile_to_dto(merchant_id: str, b: BrandProfile | None) -> BrandProfileResponseDto:
    if not b:
        return BrandProfileResponseDto(merchantId=merchant_id, exists=False)
    return BrandProfileResponseDto(
        merchantId=merchant_id, exists=True, brandColors=b.brand_colors, brandFonts=b.brand_fonts,
        logoVector=b.logo_vector, photoLibraryStatus=b.photo_library_status, menuFormat=b.menu_format,
        signatureDishes=b.signature_dishes, toneOfVoice=b.tone_of_voice, doNotSay=b.do_not_say,
        contentRestrictions=b.content_restrictions, updatedAt=b.updated_at,
    )


def catering_profile_to_dto(merchant_id: str, c: CateringProfile | None) -> CateringProfileResponseDto:
    if not c:
        return CateringProfileResponseDto(merchantId=merchant_id, exists=False)
    return CateringProfileResponseDto(
        merchantId=merchant_id, exists=True, offered=c.offered, contact=c.contact, leadFlow=c.lead_flow,
        minOrder=c.min_order, notes=c.notes, updatedAt=c.updated_at,
    )


def account_manager_to_dto(a: AccountManager, merchant_count: int) -> AccountManagerResponseDto:
    return AccountManagerResponseDto(
        id=a.id, name=a.name, team=a.team, email=a.email, merchantCount=merchant_count, createdAt=a.created_at,
    )


def subscription_to_response_dto(merchant_id: str, s: Subscription) -> SubscriptionResponseDto:
    return SubscriptionResponseDto(
        merchantId=merchant_id,
        package={"code": s.package.code, "name": s.package.name, "price": str(s.package.price)},
        status=s.status, startDate=s.start_date, renewalDate=s.renewal_date,
        mrr=str(s.mrr) if s.mrr is not None else None, isCurrent=s.is_current,
    )


def brand_asset_to_dto(a: BrandAsset, storage) -> BrandAssetResponseDto:
    has_file = storage.is_managed(a.url)
    return BrandAssetResponseDto(
        id=a.id, merchantId=a.merchant_id, type=a.type, name=a.name, status=a.status,
        mimeType=a.mime_type, sizeBytes=a.size_bytes, uploadedBy=a.uploaded_by, createdAt=a.created_at,
        hasFile=has_file,
        downloadPath=f"/api/v1/brand-assets/{a.id}/download" if has_file else None,
    )


def promotion_to_dto(p: Promotion) -> PromotionResponseDto:
    return PromotionResponseDto(
        id=p.id, merchantId=p.merchant_id, promoName=p.promo_name, offerType=p.offer_type,
        offerValue=p.offer_value, promoCode=p.promo_code, channels=p.channels,
        startDate=p.start_date, endDate=p.end_date, status=p.status, redemptions=p.redemptions,
        redemptionMethod=p.redemption_method, approvalOwner=p.approval_owner,
        staffBriefed=p.staff_briefed, blackoutDates=p.blackout_dates, notes=p.notes,
        createdAt=p.created_at,
    )
