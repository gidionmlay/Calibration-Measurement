"""Tests for SQLAlchemy persistence models, constraints, and Decimal precision."""

import uuid
from decimal import Decimal
import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.session import MeasurementSession
from app.models.ride import SessionRide
from app.models.override import SessionOverride
from app.models.review import SessionReview
from app.models.audit import AuditEvent
from app.audit.canonical import GENESIS_HASH


def test_session_creation_and_retrieval(db_session: Session):
    """Verify session model creation, persistence, and retrieval."""
    session_id = uuid.uuid4()
    session = MeasurementSession(
        id=session_id,
        version=1,
        schema_version=1,
        status="draft",
        name="Test Calibration Session",
        course_name="Olympic Blvd",
        course_length_m=Decimal("1000.0000"),
        course_length_unit="m",
        surface_type="asphalt",
        temperature_c=Decimal("18.50"),
        rollover_mode="none",
        constant_selection_rule="larger",
        working_spec_version="ws-0.3-provisional",
        policy_approval_status="unapproved",
    )
    db_session.add(session)
    db_session.commit()

    retrieved = db_session.scalar(select(MeasurementSession).where(MeasurementSession.id == session_id))
    assert retrieved is not None
    assert retrieved.name == "Test Calibration Session"
    assert retrieved.status == "draft"
    assert retrieved.course_length_m == Decimal("1000.0000")
    assert retrieved.temperature_c == Decimal("18.50")
    assert retrieved.version == 1
    assert retrieved.is_provisional is True


def test_decimal_numeric_precision_round_trip(db_session: Session):
    """Verify exact Decimal round-trip through PostgreSQL NUMERIC columns without float loss."""
    session_id = uuid.uuid4()
    # High-precision values from golden calibration vectors
    expected_course_length = Decimal("333.3333")
    expected_wc = Decimal("4967.462500")
    expected_drift = Decimal("0.0805")

    session = MeasurementSession(
        id=session_id,
        version=1,
        name="Precision Test Session",
        course_length_m=expected_course_length,
        pre_cal_working_constant=expected_wc,
        final_working_constant=expected_wc,
        cal_drift_percent=expected_drift,
    )
    db_session.add(session)
    db_session.commit()

    # Expire session cache to force fresh DB read
    db_session.expire_all()
    fresh = db_session.scalar(select(MeasurementSession).where(MeasurementSession.id == session_id))
    assert fresh is not None
    assert isinstance(fresh.course_length_m, Decimal)
    assert fresh.course_length_m == expected_course_length
    assert isinstance(fresh.final_working_constant, Decimal)
    # Compare with numeric equivalence
    assert fresh.final_working_constant.normalize() == expected_wc.normalize()
    assert fresh.cal_drift_percent == expected_drift


def test_ride_persistence_and_relationships(db_session: Session):
    """Verify raw ride records persist with relationships to session."""
    session_id = uuid.uuid4()
    session = MeasurementSession(
        id=session_id,
        name="Ride Test Session",
        course_length_m=Decimal("200.0000"),
    )
    db_session.add(session)
    db_session.flush()

    ride1 = SessionRide(
        session_id=session_id,
        ride_type="pre_calibration",
        ride_number=1,
        start_count=11082,
        finish_count=12021,
        count_delta=939,
        is_linked=True,
    )
    ride2 = SessionRide(
        session_id=session_id,
        ride_type="pre_calibration",
        ride_number=2,
        start_count=12021,
        finish_count=13042,
        count_delta=1021,
        is_linked=True,
    )
    db_session.add_all([ride1, ride2])
    db_session.commit()

    fresh = db_session.scalar(select(MeasurementSession).where(MeasurementSession.id == session_id))
    assert fresh is not None
    assert len(fresh.rides) == 2
    assert fresh.rides[0].count_delta == 939
    assert fresh.rides[1].count_delta == 1021


def test_override_persistence_and_reason_constraint(db_session: Session):
    """Verify override persistence and enforcement of mandatory non-empty reason constraint."""
    session_id = uuid.uuid4()
    session = MeasurementSession(
        id=session_id,
        name="Override Test Session",
        course_length_m=Decimal("200.0000"),
    )
    db_session.add(session)
    db_session.flush()

    # Valid override with reason
    override = SessionOverride(
        session_id=session_id,
        field_name="start_count",
        original_value="12021",
        replacement_value="12050",
        reason="Turnaround gap after vehicle obstacle",
        actor_id="provisional:measurer-1",
    )
    db_session.add(override)
    db_session.commit()

    retrieved = db_session.scalar(select(SessionOverride).where(SessionOverride.session_id == session_id))
    assert retrieved is not None
    assert retrieved.reason == "Turnaround gap after vehicle obstacle"

    # Attempting to persist override with empty or whitespace reason violates check constraint
    invalid_override = SessionOverride(
        session_id=session_id,
        field_name="start_count",
        original_value="13042",
        replacement_value="13050",
        reason="   ",  # whitespace only
    )
    db_session.add(invalid_override)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_database_enforces_non_negative_counter_counts(db_session: Session):
    """Verify PostgreSQL check constraint rejects negative start or finish counts."""
    session_id = uuid.uuid4()
    session = MeasurementSession(
        id=session_id,
        name="Negative Count Constraint Session",
        course_length_m=Decimal("1000.0000"),
    )
    db_session.add(session)
    db_session.flush()

    negative_ride = SessionRide(
        session_id=session_id,
        ride_type="pre_calibration",
        ride_number=1,
        start_count=-500,  # Negative count
        finish_count=1000,
        count_delta=1500,
    )
    db_session.add(negative_ride)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_database_enforces_unique_session_ride_number(db_session: Session):
    """Verify unique constraint on (session_id, ride_type, ride_number)."""
    session_id = uuid.uuid4()
    session = MeasurementSession(
        id=session_id,
        name="Duplicate Ride Session",
        course_length_m=Decimal("1000.0000"),
    )
    db_session.add(session)
    db_session.flush()

    ride1 = SessionRide(
        session_id=session_id,
        ride_type="pre_calibration",
        ride_number=1,
        start_count=1000,
        finish_count=2000,
        count_delta=1000,
    )
    ride2 = SessionRide(
        session_id=session_id,
        ride_type="pre_calibration",
        ride_number=1,  # Duplicate ride_number for same type and session
        start_count=2000,
        finish_count=3000,
        count_delta=1000,
    )
    db_session.add_all([ride1, ride2])
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_review_persistence_and_invalidation(db_session: Session):
    """Verify review state persistence and invalidation flags."""
    session_id = uuid.uuid4()
    session = MeasurementSession(
        id=session_id,
        name="Review Test Session",
        course_length_m=Decimal("1000.0000"),
    )
    db_session.add(session)
    db_session.flush()

    review = SessionReview(
        session_id=session_id,
        reviewer_id="provisional:reviewer-2",
        status="approved",
        comments="Calibration procedure verified against standards.",
        checklist_snapshot={"course_marked": True, "four_rides_complete": True},
    )
    db_session.add(review)
    db_session.commit()

    saved_review = db_session.scalar(select(SessionReview).where(SessionReview.session_id == session_id))
    assert saved_review is not None
    assert saved_review.status == "approved"
    assert saved_review.is_invalidated is False

    # Invalidate review
    saved_review.is_invalidated = True
    saved_review.invalidation_reason = "Upstream calibration ride 2 reading changed"
    db_session.commit()

    refreshed_review = db_session.scalar(select(SessionReview).where(SessionReview.session_id == session_id))
    assert refreshed_review.is_invalidated is True
    assert refreshed_review.invalidation_reason == "Upstream calibration ride 2 reading changed"

