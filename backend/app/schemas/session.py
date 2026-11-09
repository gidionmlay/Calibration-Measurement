"""Pydantic v2 schemas for Measurement Session persistence and API operations."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator
from app.schemas.calculations import (
    RolloverModeEnum,
    FinalConstantRuleEnum,
    RolloverConfigSchema,
    RideInputSchema,
    ResolvedRideSchema,
    SpreadSchema,
)


class SessionRideCreateSchema(BaseModel):
    ride_type: str = Field(default="pre_calibration", description="Type of ride: pre_calibration, post_calibration, or course_measurement.")
    ride_number: int = Field(ge=1, le=100, description="Sequential 1-based ride index.")
    start_count: int = Field(ge=0, description="Start counter reading (discrete non-negative whole count).")
    finish_count: int = Field(ge=0, description="Finish counter reading (discrete non-negative whole count).")
    is_linked_override: bool = Field(default=False, description="Whether sequential start linkage was manually overridden.")
    override_reason: Optional[str] = Field(default=None, description="Mandatory reason when is_linked_override is True.")

    @model_validator(mode="after")
    def validate_override_reason(self) -> "SessionRideCreateSchema":
        if self.is_linked_override:
            if not self.override_reason or len(self.override_reason.strip()) == 0:
                raise ValueError("An override reason must be provided when is_linked_override is True.")
        return self


class SessionCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255, description="Human-readable session title.")
    description: Optional[str] = Field(default=None, max_length=2000)
    measurer_id: Optional[str] = Field(default=None, max_length=255, description="Provisional measurer actor ID.")
    supervisor_id: Optional[str] = Field(default=None, max_length=255, description="Provisional supervisor actor ID.")
    course_name: Optional[str] = Field(default=None, max_length=255)
    course_length_m: Decimal = Field(gt=0, description="Calibration course length in metres.")
    course_length_unit: str = Field(default="m", max_length=20)
    surface_type: Optional[str] = Field(default=None, max_length=50)
    temperature_c: Optional[Decimal] = Field(default=None, description="Ambient temperature in degrees Celsius.")
    rollover: RolloverConfigSchema = Field(default_factory=RolloverConfigSchema)
    constant_selection_rule: FinalConstantRuleEnum = Field(default=FinalConstantRuleEnum.LARGER)
    working_spec_version: str = Field(default="ws-0.3-provisional", max_length=50)
    rides: List[SessionRideCreateSchema] = Field(default_factory=list, description="Raw calibration or measurement rides.")

    @field_validator("course_length_m")
    @classmethod
    def validate_course_length_precision(cls, v: Decimal) -> Decimal:
        if not v.is_finite():
            raise ValueError("course_length_m must be a finite number.")
        if v <= 0:
            raise ValueError("course_length_m must be strictly positive.")
        # Scale contract: NUMERIC(12, 4) rejects values exceeding 4 decimal places
        exponent = v.as_tuple().exponent
        if isinstance(exponent, int) and exponent < -4:
            raise ValueError("course_length_m precision cannot exceed 4 decimal places (scale <= 4).")
        if len(v.as_tuple().digits) > 12:
            raise ValueError("course_length_m total precision cannot exceed 12 digits.")
        return v

    @field_validator("temperature_c")
    @classmethod
    def validate_temperature_precision(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is None:
            return None
        if not v.is_finite():
            raise ValueError("temperature_c must be a finite number.")
        # Scale contract: NUMERIC(5, 2) rejects values exceeding 2 decimal places
        exponent = v.as_tuple().exponent
        if isinstance(exponent, int) and exponent < -2:
            raise ValueError("temperature_c precision cannot exceed 2 decimal places (scale <= 2).")
        if len(v.as_tuple().digits) > 5 or abs(v) > Decimal("999.99"):
            raise ValueError("temperature_c out of allowable bounds (-999.99 to 999.99 °C).")
        return v


class SessionUpdateRequest(BaseModel):
    expected_version: int = Field(ge=1, description="Expected session version for optimistic locking.")
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2000)
    course_name: Optional[str] = Field(default=None, max_length=255)
    course_length_m: Optional[Decimal] = Field(default=None, gt=0)
    temperature_c: Optional[Decimal] = Field(default=None)
    rollover: Optional[RolloverConfigSchema] = None
    constant_selection_rule: Optional[FinalConstantRuleEnum] = None
    rides: Optional[List[SessionRideCreateSchema]] = None
    change_reason: Optional[str] = Field(default=None, description="Optional explanation for audit logging.")

    @field_validator("course_length_m")
    @classmethod
    def validate_course_length_precision(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is None:
            return None
        if not v.is_finite():
            raise ValueError("course_length_m must be a finite number.")
        if v <= 0:
            raise ValueError("course_length_m must be strictly positive.")
        exponent = v.as_tuple().exponent
        if isinstance(exponent, int) and exponent < -4:
            raise ValueError("course_length_m precision cannot exceed 4 decimal places (scale <= 4).")
        if len(v.as_tuple().digits) > 12:
            raise ValueError("course_length_m total precision cannot exceed 12 digits.")
        return v

    @field_validator("temperature_c")
    @classmethod
    def validate_temperature_precision(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is None:
            return None
        if not v.is_finite():
            raise ValueError("temperature_c must be a finite number.")
        exponent = v.as_tuple().exponent
        if isinstance(exponent, int) and exponent < -2:
            raise ValueError("temperature_c precision cannot exceed 2 decimal places (scale <= 2).")
        if len(v.as_tuple().digits) > 5 or abs(v) > Decimal("999.99"):
            raise ValueError("temperature_c out of allowable bounds (-999.99 to 999.99 °C).")
        return v


class SessionRideResponseSchema(BaseModel):
    id: uuid.UUID
    ride_type: str
    ride_number: int
    start_count: int
    finish_count: int
    count_delta: int
    is_linked: bool
    is_linked_override: bool
    override_reason: Optional[str]
    adjustment: int
    created_at: datetime


class SessionReviewResponseSchema(BaseModel):
    id: uuid.UUID
    reviewer_id: str
    status: str
    comments: Optional[str]
    signed_at: Optional[datetime]
    is_invalidated: bool
    invalidated_at: Optional[datetime]
    invalidation_reason: Optional[str]


class SessionReviewCreateRequest(BaseModel):
    """Payload for submitting a peer review decision."""
    expected_version: int = Field(..., ge=1, description="Expected session version to prevent TOCTOU race conditions.")
    status: str = Field(..., pattern="^(approved|rejected)$", description="Review decision (approved, rejected)")
    comments: Optional[str] = Field(None, max_length=2000, description="Review feedback or rejection reasoning")
    checklist_snapshot: Optional[Dict[str, Any]] = Field(None, description="Snapshot of verification checklist items")


class SessionSubmitRequest(BaseModel):
    """Payload for submitting a session for peer review."""
    notes: Optional[str] = Field(None, max_length=1000, description="Submission notes for reviewers")


class SessionFinalizeRequest(BaseModel):
    """Payload for finalizing a measurement session into a locked, read-only record."""
    expected_version: int = Field(..., ge=1, description="Expected session version for optimistic concurrency.")
    supervisor_notes: Optional[str] = Field(None, max_length=2000, description="Supervisor final authorization notes.")
    confirm_provisional_policy: bool = Field(
        default=False,
        description="Explicit acknowledgment of unratified measurement policy MP-01 through MP-09.",
    )


class SessionRevisionCreateRequest(BaseModel):
    """Payload for initiating a formal revision of a finalized session."""
    revision_reason: str = Field(
        ...,
        min_length=10,
        max_length=2000,
        description="Mandatory detailed justification string for revising the finalized record.",
    )


class MigrationDiscrepancySchema(BaseModel):
    field: str
    legacy_value: Optional[str]
    authoritative_value: Optional[str]
    delta: Optional[str]


class MigrationResponseSchema(BaseModel):
    success: bool
    dry_run: bool
    session_id: Optional[uuid.UUID] = None
    session_name: str
    reference: str
    discrepancy_count: int
    discrepancies: List[MigrationDiscrepancySchema] = Field(default_factory=list)
    authoritative_calculations: Dict[str, Any] = Field(default_factory=dict)


class SessionMigrationRequest(BaseModel):
    """Payload for importing legacy v1.0 / v2.0 JSON session exports."""
    payload: Dict[str, Any] = Field(..., description="Legacy JSON session data (raw or export envelope).")
    measurer_id: Optional[str] = Field(None, description="Optional override for measurer attribution.")


class SessionResponseSchema(BaseModel):
    id: uuid.UUID
    version: int
    schema_version: int
    status: str
    name: str
    description: Optional[str]
    measurer_id: Optional[str]
    supervisor_id: Optional[str]
    course_name: Optional[str]
    course_length_m: Decimal
    course_length_unit: str
    surface_type: Optional[str]
    temperature_c: Optional[Decimal]
    rollover_mode: str
    max_reading: Optional[int]
    constant_selection_rule: str
    working_spec_version: str
    policy_approval_status: str
    
    # Authoritative derived calculations
    pre_cal_working_constant: Optional[Decimal]
    post_cal_working_constant: Optional[Decimal]
    final_working_constant: Optional[Decimal]
    cal_drift_percent: Optional[Decimal]
    course_distance_km: Optional[Decimal]
    calculation_engine_version: Optional[str]
    is_provisional: bool
    policy_notice: Optional[str]

    # Lineage
    supersedes_id: Optional[uuid.UUID]
    superseded_by_id: Optional[uuid.UUID]
    revision_reason: Optional[str]

    # Associated models
    rides: List[SessionRideResponseSchema] = Field(default_factory=list)
    reviews: List[SessionReviewResponseSchema] = Field(default_factory=list)

    created_at: datetime
    updated_at: datetime


class SessionLineageResponseSchema(BaseModel):
    """Lineage response detailing ancestors and descendants of a session."""
    current_session_id: uuid.UUID
    ancestors: List[SessionResponseSchema] = Field(default_factory=list)
    descendants: List[SessionResponseSchema] = Field(default_factory=list)


