"""Pydantic validation schemas for calculation endpoints.

Provides strict request validation and explicit response serialization with
units and provisional policy notices.
"""

from decimal import Decimal
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator, model_validator


class RolloverModeEnum(str, Enum):
    NONE = "none"
    NOT_CONFIGURED = "notConfigured"
    WRAP = "wrap"


class FinalConstantRuleEnum(str, Enum):
    LARGER = "larger"
    AVERAGE = "average"
    NOT_CONFIGURED = "notConfigured"


class RolloverConfigSchema(BaseModel):
    mode: RolloverModeEnum = Field(
        default=RolloverModeEnum.NONE,
        description="Rollover behavior when finish count is less than start count."
    )
    max_reading: Optional[int] = Field(
        default=None,
        ge=0,
        description="Maximum counter reading before wrapping back to zero (required for 'wrap' mode)."
    )

    @model_validator(mode="after")
    def validate_wrap_has_max(self) -> "RolloverConfigSchema":
        if self.mode == RolloverModeEnum.WRAP and self.max_reading is None:
            raise ValueError("max_reading is required when rollover mode is 'wrap'.")
        return self


class RideInputSchema(BaseModel):
    start: int = Field(ge=0, description="Start counter reading (discrete non-negative whole count).")
    finish: int = Field(ge=0, description="Finish counter reading (discrete non-negative whole count).")
    start_overridden: bool = Field(default=False, description="Whether sequential linkage is overridden.")
    override_reason: str = Field(default="", description="Mandatory explanation when start is overridden.")

    @model_validator(mode="after")
    def validate_override_reason(self) -> "RideInputSchema":
        if self.start_overridden and len(self.override_reason.strip()) == 0:
            raise ValueError("An override reason must be provided when start_overridden is true.")
        return self


class CalibrationRequest(BaseModel):
    rides: List[RideInputSchema] = Field(
        min_length=1,
        description="Sequential calibration rides (typically 4 rides)."
    )
    course_length_m: Decimal = Field(
        gt=0,
        description="Calibration course length in metres (must be strictly positive)."
    )
    rollover: RolloverConfigSchema = Field(
        default_factory=RolloverConfigSchema,
        description="Counter rollover handling configuration."
    )

    @field_validator("course_length_m")
    @classmethod
    def validate_finite_course_length(cls, v: Decimal) -> Decimal:
        if not v.is_finite():
            raise ValueError("course_length_m must be a finite number.")
        return v


class ResolvedRideSchema(BaseModel):
    ride_number: int
    start: int
    finish: int
    count: int
    linked: bool
    overridden: bool
    override_reason: str
    adjustment: int = 0


class SpreadSchema(BaseModel):
    high_ride: int
    high_count: int
    low_ride: int
    low_count: int
    range_count: int


class CalibrationResponse(BaseModel):
    rides: List[ResolvedRideSchema]
    counts: List[int]
    total_count: int
    average_count: Decimal
    course_length_m: Decimal
    course_length_km: Decimal
    counts_per_km: Decimal
    working_constant: Decimal
    working_constant_formatted: str
    spread: SpreadSchema
    is_provisional: bool
    engine_version: str
    ruleset_version: str
    policy_notice: str


class CourseDistanceRequest(BaseModel):
    start_count: int = Field(ge=0, description="Starting counter reading.")
    finish_count: int = Field(ge=0, description="Finishing counter reading.")
    working_constant: Decimal = Field(gt=0, description="Governing working constant (counts per km).")
    rollover: RolloverConfigSchema = Field(
        default_factory=RolloverConfigSchema,
        description="Counter rollover configuration."
    )

    @field_validator("working_constant")
    @classmethod
    def validate_finite_wc(cls, v: Decimal) -> Decimal:
        if not v.is_finite():
            raise ValueError("working_constant must be a finite number.")
        return v


class CourseDistanceResponse(BaseModel):
    start_count: int
    finish_count: int
    course_count: int
    working_constant_applied: Decimal
    distance_km: Decimal
    distance_km_formatted: str
    is_provisional: bool
    engine_version: str
    ruleset_version: str
    policy_notice: str


class ComparisonRequest(BaseModel):
    pre_working_constant: Decimal = Field(gt=0, description="Pre-calibration working constant.")
    post_working_constant: Optional[Decimal] = Field(
        default=None,
        gt=0,
        description="Post-calibration working constant (optional when post-calibration is incomplete)."
    )
    rule: FinalConstantRuleEnum = Field(
        default=FinalConstantRuleEnum.LARGER,
        description="Governing constant selection rule."
    )
    policy_approved: bool = Field(
        default=False,
        description="Whether governing measurement policy has been officially ratified."
    )

    @field_validator("pre_working_constant", "post_working_constant")
    @classmethod
    def validate_finite_constants(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None and not v.is_finite():
            raise ValueError("Working constant must be a finite number.")
        return v


class ComparisonResponse(BaseModel):
    pre_working_constant: Decimal
    post_working_constant: Optional[Decimal] = None
    difference: Optional[Decimal] = None
    percent_change: Optional[Decimal] = None
    selected_rule: str
    final_working_constant: Optional[Decimal]
    is_provisional: bool
    reasons: List[str]
    policy_notice: str


class ProblemDetail(BaseModel):
    """RFC 7807 / RFC 9457 Problem Details object for structured error responses."""
    type: str = Field(default="about:blank", description="URI reference identifying problem type.")
    title: str = Field(description="Short, human-readable summary of problem.")
    status: int = Field(description="HTTP status code.")
    detail: str = Field(description="Human-readable explanation specific to this occurrence.")
    instance: Optional[str] = Field(default=None, description="URI reference identifying specific occurrence.")
    invalid_params: Optional[List[dict]] = Field(default=None, description="Specific field validation errors.")
