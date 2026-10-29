"""Authoritative Calculation Engine for Bicycle Calibration & Road Course Measurement.

This module implements pure, deterministic arithmetic using Python Decimal to guarantee
precision and eliminate floating-point rounding artifacts. It operates independently
of FastAPI, HTTP transports, databases, and browser state.
"""

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP
from enum import Enum
from typing import List, Optional, Union

# Governing Calculation Constants
CORRECTION_FACTOR = Decimal("1.001")  # Short-Course Prevention Factor (SCPF)
ENGINE_VERSION = "1.0.0-python"
RULESET_VERSION = "ws-0.3-provisional"
DISTANCE_DISPLAY_DECIMALS = 3
WC_DISPLAY_DECIMALS = 4


class RolloverMode(str, Enum):
    NONE = "none"
    NOT_CONFIGURED = "notConfigured"
    WRAP = "wrap"


class FinalConstantRule(str, Enum):
    LARGER = "larger"
    AVERAGE = "average"
    NOT_CONFIGURED = "notConfigured"


@dataclass(frozen=True)
class RolloverConfig:
    mode: RolloverMode = RolloverMode.NONE
    max_reading: Optional[int] = None


@dataclass(frozen=True)
class RideInput:
    start: int
    finish: int
    start_overridden: bool = False
    override_reason: str = ""


@dataclass(frozen=True)
class CountResult:
    ok: bool
    count: Optional[int] = None
    adjustment: int = 0
    error: Optional[str] = None


@dataclass(frozen=True)
class ResolvedRide:
    ride_number: int
    start: int
    finish: int
    count: int
    linked: bool
    overridden: bool
    override_reason: str
    adjustment: int = 0


@dataclass(frozen=True)
class SpreadResult:
    high_ride: int
    high_count: int
    low_ride: int
    low_count: int
    range_count: int


@dataclass(frozen=True)
class CalibrationCalculationResult:
    rides: List[ResolvedRide]
    counts: List[int]
    total_count: int
    average_count: Decimal
    course_length_m: Decimal
    course_length_km: Decimal
    counts_per_km: Decimal
    working_constant: Decimal
    working_constant_formatted: str
    spread: SpreadResult
    is_provisional: bool = True
    engine_version: str = ENGINE_VERSION
    ruleset_version: str = RULESET_VERSION
    policy_notice: str = "PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION (Unratified Policy MP-01..MP-09)"


@dataclass(frozen=True)
class CourseDistanceCalculationResult:
    start_count: int
    finish_count: int
    course_count: int
    working_constant_applied: Decimal
    distance_km: Decimal
    distance_km_formatted: str
    is_provisional: bool = True
    engine_version: str = ENGINE_VERSION
    ruleset_version: str = RULESET_VERSION
    policy_notice: str = "PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION"


@dataclass(frozen=True)
class ConstantComparisonResult:
    pre_wc: Decimal
    post_wc: Optional[Decimal] = None
    difference: Optional[Decimal] = None
    percent_change: Optional[Decimal] = None
    selected_rule: FinalConstantRule = FinalConstantRule.LARGER
    final_working_constant: Optional[Decimal] = None
    is_provisional: bool = True
    reasons: List[str] = field(default_factory=list)


def format_decimal(value: Optional[Decimal], decimals: int) -> str:
    """Format a Decimal to an exact number of decimal places using ROUND_HALF_UP."""
    if value is None:
        return "—"
    quantizer = Decimal("10") ** -decimals
    return str(value.quantize(quantizer, rounding=ROUND_HALF_UP))


def calculate_ride_difference(
    start: int,
    finish: int,
    rollover: RolloverConfig = RolloverConfig()
) -> CountResult:
    """Calculate the count difference between start and finish readings.
    
    Handles non-negative counter checks, standard forward progress, and
    configured rollover wrapping. Prohibits non-integer types (e.g. floats, booleans).
    """
    if isinstance(start, bool) or not isinstance(start, int) or isinstance(finish, bool) or not isinstance(finish, int):
        return CountResult(ok=False, error="Counter readings must be discrete whole integers, not floats or booleans.")

    if start < 0 or finish < 0:
        return CountResult(ok=False, error="Counter readings must be non-negative integers.")

    if finish >= start:
        return CountResult(ok=True, count=finish - start, adjustment=0)

    # Rollover conditions (finish < start)
    if rollover.mode == RolloverMode.NOT_CONFIGURED:
        return CountResult(
            ok=False,
            error="Finish is lower than start. Rollover handling is not configured, so no rollover is assumed."
        )
    if rollover.mode == RolloverMode.NONE:
        return CountResult(
            ok=False,
            error="Finish is lower than start, and this counter is set as non-wrapping. Verify both readings."
        )
    if rollover.mode == RolloverMode.WRAP:
        if rollover.max_reading is None:
            return CountResult(
                ok=False,
                error="Finish is lower than start, but counter maximum is not set. Add it in Setup to resolve rollover."
            )
        if start > rollover.max_reading or finish > rollover.max_reading:
            return CountResult(
                ok=False,
                error="A reading exceeds the configured counter maximum. Verify the readings."
            )
        adjustment = rollover.max_reading + 1
        count = finish + adjustment - start
        return CountResult(ok=True, count=count, adjustment=adjustment)

    return CountResult(ok=False, error=f"Unsupported rollover mode: {rollover.mode}")


def resolve_rides(
    rides: List[RideInput],
    rollover: RolloverConfig = RolloverConfig()
) -> List[ResolvedRide]:
    """Resolve sequential ride continuity, overrides, and counts."""
    if not rides:
        raise ValueError("At least one ride must be provided.")

    resolved: List[ResolvedRide] = []
    for idx, ride in enumerate(rides):
        ride_num = idx + 1
        is_first = idx == 0
        linked = not is_first and not ride.start_overridden

        # Sequential linkage: if linked, start comes from previous ride finish
        effective_start = rides[idx - 1].finish if linked else ride.start

        count_res = calculate_ride_difference(effective_start, ride.finish, rollover)
        if not count_res.ok or count_res.count is None:
            raise ValueError(f"Ride {ride_num} calculation failed: {count_res.error}")

        resolved.append(
            ResolvedRide(
                ride_number=ride_num,
                start=effective_start,
                finish=ride.finish,
                count=count_res.count,
                linked=linked,
                overridden=ride.start_overridden and not is_first,
                override_reason=ride.override_reason if ride.start_overridden else "",
                adjustment=count_res.adjustment,
            )
        )

    return resolved


def calculate_calibration(
    rides: List[RideInput],
    course_length_m: Union[Decimal, str, int],
    rollover: RolloverConfig = RolloverConfig()
) -> CalibrationCalculationResult:
    """Execute authoritative calibration calculation from raw rides and course length.
    
    Formulas:
        d_i = finish_i - start_i
        D = sum(d_i)
        C_avg = D / N
        L_km = course_length_m / 1000
        CPK = (C_avg * 1000) / course_length_m
        WC = CPK * 1.001
    """
    if isinstance(course_length_m, (float, bool)):
        raise TypeError("Binary float or boolean inputs are prohibited; use Decimal, int, or numeric string.")

    # Parse course length as exact Decimal
    try:
        dec_course_m = Decimal(str(course_length_m).strip())
    except Exception as exc:
        raise ValueError(f"Invalid course length in metres: '{course_length_m}'") from exc

    if not dec_course_m.is_finite():
        raise ValueError("Course length must be a finite number.")

    if dec_course_m <= Decimal("0"):
        raise ValueError("Course length must be greater than zero.")

    if len(rides) == 0:
        raise ValueError("Calibration requires at least one ride.")

    resolved = resolve_rides(rides, rollover)
    counts = [r.count for r in resolved]
    total_count = sum(counts)
    num_rides = Decimal(len(counts))
    average_count = Decimal(total_count) / num_rides

    course_length_km = dec_course_m / Decimal("1000")
    # Equivalent to Average / L_km, computed as (Average * 1000) / course_m for exact rational precision
    counts_per_km = (average_count * Decimal("1000")) / dec_course_m
    working_constant = counts_per_km * CORRECTION_FACTOR

    # Calculate spread
    hi_idx = 0
    lo_idx = 0
    for i, c in enumerate(counts):
        if c > counts[hi_idx]:
            hi_idx = i
        if c < counts[lo_idx]:
            lo_idx = i

    spread = SpreadResult(
        high_ride=hi_idx + 1,
        high_count=counts[hi_idx],
        low_ride=lo_idx + 1,
        low_count=counts[lo_idx],
        range_count=counts[hi_idx] - counts[lo_idx],
    )

    return CalibrationCalculationResult(
        rides=resolved,
        counts=counts,
        total_count=total_count,
        average_count=average_count,
        course_length_m=dec_course_m,
        course_length_km=course_length_km,
        counts_per_km=counts_per_km,
        working_constant=working_constant,
        working_constant_formatted=format_decimal(working_constant, WC_DISPLAY_DECIMALS),
        spread=spread,
        is_provisional=True,
    )


def calculate_course_distance(
    start: int,
    finish: int,
    working_constant: Union[Decimal, str, int],
    rollover: RolloverConfig = RolloverConfig()
) -> CourseDistanceCalculationResult:
    """Calculate measured course distance in kilometres.
    
    Formula:
        T = finish - start (with rollover if applicable)
        Distance_km = T / WC
    """
    if isinstance(working_constant, (float, bool)):
        raise TypeError("Binary float or boolean inputs are prohibited; use Decimal, int, or numeric string.")

    try:
        dec_wc = Decimal(str(working_constant).strip())
    except Exception as exc:
        raise ValueError(f"Invalid working constant: '{working_constant}'") from exc

    if not dec_wc.is_finite():
        raise ValueError("Working constant must be a finite number.")

    if dec_wc <= Decimal("0"):
        raise ValueError("Working constant must be strictly positive.")

    count_res = calculate_ride_difference(start, finish, rollover)
    if not count_res.ok or count_res.count is None:
        raise ValueError(count_res.error or "Invalid course distance count.")

    course_count = count_res.count
    distance_km = Decimal(course_count) / dec_wc

    return CourseDistanceCalculationResult(
        start_count=start,
        finish_count=finish,
        course_count=course_count,
        working_constant_applied=dec_wc,
        distance_km=distance_km,
        distance_km_formatted=format_decimal(distance_km, DISTANCE_DISPLAY_DECIMALS),
        is_provisional=True,
    )


def compare_calibrations(
    pre_wc: Union[Decimal, str, int],
    post_wc: Optional[Union[Decimal, str, int]] = None,
    rule: FinalConstantRule = FinalConstantRule.LARGER,
    policy_approved: bool = False
) -> ConstantComparisonResult:
    """Compare pre- and post-calibration working constants and evaluate governing constant."""
    if isinstance(pre_wc, (float, bool)):
        raise TypeError("Binary float or boolean inputs are prohibited; use Decimal, int, or numeric string.")

    try:
        dec_pre = Decimal(str(pre_wc).strip())
    except Exception as exc:
        raise ValueError(f"Invalid pre-calibration working constant: '{pre_wc}'") from exc

    if not dec_pre.is_finite() or dec_pre <= Decimal("0"):
        raise ValueError("Pre-calibration working constant must be a finite number strictly positive.")

    # Incomplete post-calibration case: post_wc is None
    if post_wc is None:
        return ConstantComparisonResult(
            pre_wc=dec_pre,
            post_wc=None,
            difference=None,
            percent_change=None,
            selected_rule=rule,
            final_working_constant=dec_pre,
            is_provisional=True,
            reasons=["postIncomplete"],
        )

    if isinstance(post_wc, (float, bool)):
        raise TypeError("Binary float or boolean inputs are prohibited; use Decimal, int, or numeric string.")

    try:
        dec_post = Decimal(str(post_wc).strip())
    except Exception as exc:
        raise ValueError(f"Invalid post-calibration working constant: '{post_wc}'") from exc

    if not dec_post.is_finite() or dec_post <= Decimal("0"):
        raise ValueError("Post-calibration working constant must be a finite number strictly positive.")

    difference = dec_post - dec_pre
    percent_change = (difference / dec_pre) * Decimal("100")

    final_wc: Optional[Decimal] = None
    reasons: List[str] = []

    if rule == FinalConstantRule.LARGER:
        final_wc = max(dec_pre, dec_post)
        if not policy_approved:
            reasons.append("ruleNotApproved")
    elif rule == FinalConstantRule.AVERAGE:
        final_wc = (dec_pre + dec_post) / Decimal("2")
        if not policy_approved:
            reasons.append("ruleNotApproved")
    elif rule == FinalConstantRule.NOT_CONFIGURED:
        final_wc = dec_pre
        reasons.append("ruleNotConfigured")

    return ConstantComparisonResult(
        pre_wc=dec_pre,
        post_wc=dec_post,
        difference=difference,
        percent_change=percent_change,
        selected_rule=rule,
        final_working_constant=final_wc,
        is_provisional=not policy_approved,
        reasons=reasons,
    )
