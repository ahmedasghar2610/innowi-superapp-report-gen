from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from app.models.enums import DeliveryFrequency, OwnerTeam, ServiceCategory


class ServiceResponseDto(BaseModel):
    id: str
    name: str
    category: ServiceCategory
    ownerTeam: OwnerTeam = Field(..., validation_alias="owner_team")

    model_config = {"from_attributes": True, "populate_by_name": True}


class ServicesResponseDto(BaseModel):
    data: list[ServiceResponseDto]


class PackageResponseDto(BaseModel):
    code: str
    name: str
    price: str

    @classmethod
    def from_entity(cls, p) -> "PackageResponseDto":
        return cls(code=p.code, name=p.name, price=str(p.price))


class PackagesResponseDto(BaseModel):
    data: list[PackageResponseDto]


class EntitlementResponseDto(BaseModel):
    id: str
    service: ServiceResponseDto
    packageCode: str
    included: bool
    qtyPerPeriod: Optional[int]
    frequency: DeliveryFrequency
    definitionOfDone: Optional[str]
    ownerTeam: OwnerTeam

    @classmethod
    def from_entity(cls, e) -> "EntitlementResponseDto":
        return cls(
            id=e.id,
            service=ServiceResponseDto.model_validate(e.service),
            packageCode=e.package_code,
            included=e.included,
            qtyPerPeriod=e.qty_per_period,
            frequency=e.frequency,
            definitionOfDone=e.definition_of_done,
            ownerTeam=e.owner_team,
        )


class EntitlementsResponseDto(BaseModel):
    data: list[EntitlementResponseDto]


class PackageDetailResponseDto(PackageResponseDto):
    entitlements: list[EntitlementResponseDto]
