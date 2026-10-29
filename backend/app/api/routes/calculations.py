"""Calculation API Routes."""

from fastapi import APIRouter, HTTPException, status
from app.schemas.calculations import (
    CalibrationRequest,
    CalibrationResponse,
    CourseDistanceRequest,
    CourseDistanceResponse,
    ComparisonRequest,
    ComparisonResponse,
    ProblemDetail,
    ResolvedRideSchema,
    SpreadSchema,
)
from app.services.calculation_engine import (
    calculate_calibration,
    calculate_course_distance,
    compare_calibrations,
    RideInput,
    RolloverConfig,
    RolloverMode,
    FinalConstantRule,
    ENGINE_VERSION,
    RULESET_VERSION,
)

router = APIRouter(prefix="/calculations", tags=["Calculations"])


@router.post(
    "/calibration",
    response_model=CalibrationResponse,
    responses={422: {"model": ProblemDetail, "description": "Validation or Calculation Error"}},
    summary="Authoritative Calibration Calculation",
)
def compute_calibration_endpoint(request: CalibrationRequest) -> CalibrationResponse:
    """Compute counts per kilometre (CPK) and working constant (WC) from calibration rides."""
    try:
        engine_rides = [
            RideInput(
                start=r.start,
                finish=r.finish,
                start_overridden=r.start_overridden,
                override_reason=r.override_reason,
            )
            for r in request.rides
        ]
        rollover_cfg = RolloverConfig(
            mode=RolloverMode(request.rollover.mode.value),
            max_reading=request.rollover.max_reading,
        )
        res = calculate_calibration(
            rides=engine_rides,
            course_length_m=request.course_length_m,
            rollover=rollover_cfg,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return CalibrationResponse(
        rides=[
            ResolvedRideSchema(
                ride_number=r.ride_number,
                start=r.start,
                finish=r.finish,
                count=r.count,
                linked=r.linked,
                overridden=r.overridden,
                override_reason=r.override_reason,
                adjustment=r.adjustment,
            )
            for r in res.rides
        ],
        counts=res.counts,
        total_count=res.total_count,
        average_count=res.average_count,
        course_length_m=res.course_length_m,
        course_length_km=res.course_length_km,
        counts_per_km=res.counts_per_km,
        working_constant=res.working_constant,
        working_constant_formatted=res.working_constant_formatted,
        spread=SpreadSchema(
            high_ride=res.spread.high_ride,
            high_count=res.spread.high_count,
            low_ride=res.spread.low_ride,
            low_count=res.spread.low_count,
            range_count=res.spread.range_count,
        ),
        is_provisional=res.is_provisional,
        engine_version=res.engine_version,
        ruleset_version=res.ruleset_version,
        policy_notice=res.policy_notice,
    )


@router.post(
    "/course-distance",
    response_model=CourseDistanceResponse,
    responses={422: {"model": ProblemDetail, "description": "Validation or Calculation Error"}},
    summary="Authoritative Course Distance Calculation",
)
def compute_course_distance_endpoint(request: CourseDistanceRequest) -> CourseDistanceResponse:
    """Compute measured course distance from start, finish, and working constant."""
    try:
        rollover_cfg = RolloverConfig(
            mode=RolloverMode(request.rollover.mode.value),
            max_reading=request.rollover.max_reading,
        )
        res = calculate_course_distance(
            start=request.start_count,
            finish=request.finish_count,
            working_constant=request.working_constant,
            rollover=rollover_cfg,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return CourseDistanceResponse(
        start_count=res.start_count,
        finish_count=res.finish_count,
        course_count=res.course_count,
        working_constant_applied=res.working_constant_applied,
        distance_km=res.distance_km,
        distance_km_formatted=res.distance_km_formatted,
        is_provisional=res.is_provisional,
        engine_version=res.engine_version,
        ruleset_version=res.ruleset_version,
        policy_notice=res.policy_notice,
    )


@router.post(
    "/compare",
    response_model=ComparisonResponse,
    responses={422: {"model": ProblemDetail, "description": "Validation or Calculation Error"}},
    summary="Compare Pre and Post Calibration Constants",
)
def compare_constants_endpoint(request: ComparisonRequest) -> ComparisonResponse:
    """Compare pre and post calibration working constants and evaluate final constant."""
    try:
        rule_enum = FinalConstantRule(request.rule.value)
        res = compare_calibrations(
            pre_wc=request.pre_working_constant,
            post_wc=request.post_working_constant,
            rule=rule_enum,
            policy_approved=request.policy_approved,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    policy_notice = (
        "OFFICIALLY RATIFIED"
        if request.policy_approved and request.post_working_constant is not None
        else "PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION (Unratified Policy MP-01..MP-09)"
    )

    return ComparisonResponse(
        pre_working_constant=res.pre_wc,
        post_working_constant=res.post_wc,
        difference=res.difference,
        percent_change=res.percent_change,
        selected_rule=res.selected_rule.value,
        final_working_constant=res.final_working_constant,
        is_provisional=res.is_provisional,
        reasons=res.reasons,
        policy_notice=policy_notice,
    )
