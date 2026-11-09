"""Tests for transaction atomicity, rollback on failure, and audit immutability."""

import uuid
from decimal import Decimal
import pytest
from sqlalchemy import select, update, delete
from sqlalchemy.orm import Session

from app.models.session import MeasurementSession
from app.models.audit import AuditEvent
from app.services.session_service import SessionService
from app.schemas.session import SessionCreateRequest, SessionUpdateRequest, SessionRideCreateSchema


def test_atomic_session_creation_with_genesis_audit_event(db_session: Session):
    """Verify that creating a session and appending its genesis audit event succeed atomically."""
    req = SessionCreateRequest(
        name="Atomic Session Test",
        course_length_m=Decimal("1000.0000"),
        rides=[
            SessionRideCreateSchema(
                ride_type="pre_calibration",
                ride_number=1,
                start_count=1000,
                finish_count=2000,
            )
        ],
    )
    session = SessionService.create_session(
        db=db_session,
        session_in=req,
        actor_id="provisional:measurer-test",
    )

    # Both session and audit event must be committed
    db_session.expire_all()
    saved_session = db_session.scalar(select(MeasurementSession).where(MeasurementSession.id == session.id))
    assert saved_session is not None

    events = SessionService.get_session_audit_trail(db_session, session.id)
    assert len(events) == 1
    assert events[0].event_type == "SESSION_CREATED"
    assert events[0].sequence_num == 1


def test_audit_insertion_failure_causes_transaction_rollback(db_session: Session, monkeypatch):
    """Verify that if an audit event append fails, the entire transaction rolls back."""
    req = SessionCreateRequest(
        name="Rollback Candidate Session",
        course_length_m=Decimal("1000.0000"),
        rides=[],
    )

    # Monkeypatch append_audit_event to simulate an unexpected audit ledger crash
    from app.services import session_service
    def _exploding_audit(*args, **kwargs):
        raise RuntimeError("Simulated audit write disk failure")

    monkeypatch.setattr(session_service, "append_audit_event", _exploding_audit)

    with pytest.raises(RuntimeError, match="Simulated audit write disk failure"):
        SessionService.create_session(db=db_session, session_in=req)

    # Verify no partial session row was persisted in the database
    saved = db_session.scalar(
        select(MeasurementSession).where(MeasurementSession.name == "Rollback Candidate Session")
    )
    assert saved is None


def test_session_update_failure_leaves_no_partial_audit_events(db_session: Session):
    """Verify that an invalid update request rolls back and creates no stray audit events."""
    # 1. Create valid base session
    req = SessionCreateRequest(
        name="Base Session",
        course_length_m=Decimal("500.0000"),
        rides=[],
    )
    session = SessionService.create_session(db=db_session, session_in=req)
    initial_events_count = len(SessionService.get_session_audit_trail(db_session, session.id))
    assert initial_events_count == 1

    # 2. Attempt invalid update with negative counter readings (violates check constraint)
    update_req = SessionUpdateRequest(
        expected_version=1,
        rides=[
            SessionRideCreateSchema(
                ride_type="pre_calibration",
                ride_number=1,
                start_count=0,
                finish_count=1000,
            )
        ],
    )
    # Manually tamper start_count to negative to trigger DB check constraint failure
    update_req.rides[0].start_count = -100

    with pytest.raises(Exception):
        SessionService.update_session(
            db=db_session,
            session_id=session.id,
            update_in=update_req,
        )

    # Verify session remains version 1 and no extra audit events were written
    db_session.expire_all()
    fresh = db_session.scalar(select(MeasurementSession).where(MeasurementSession.id == session.id))
    assert fresh.version == 1
    events = SessionService.get_session_audit_trail(db_session, session.id)
    assert len(events) == initial_events_count


def test_audit_event_immutability_blocks_updates_and_deletes(db_session: Session):
    """Verify application-layer protection blocks UPDATE and DELETE on audit_events."""
    req = SessionCreateRequest(
        name="Immutability Session",
        course_length_m=Decimal("1000.0000"),
        rides=[],
    )
    session = SessionService.create_session(db=db_session, session_in=req)
    events = SessionService.get_session_audit_trail(db_session, session.id)
    event_id = events[0].id

    # Attempt direct ORM update on AuditEvent
    event = db_session.scalar(select(AuditEvent).where(AuditEvent.id == event_id))
    event.event_summary = "Forged summary"

    with pytest.raises(PermissionError, match="UPDATE operations on 'audit_events' are strictly prohibited"):
        db_session.commit()
    db_session.rollback()

    # Attempt direct ORM delete on AuditEvent
    event_to_delete = db_session.scalar(select(AuditEvent).where(AuditEvent.id == event_id))
    db_session.delete(event_to_delete)

    with pytest.raises(PermissionError, match="DELETE operations on 'audit_events' are strictly prohibited"):
        db_session.commit()
    db_session.rollback()


def test_database_trigger_blocks_raw_sql_mutation(db_session: Session):
    """Verify that PostgreSQL statement trigger trg_protect_audit_events_mutation
    strictly rejects raw SQL UPDATE, DELETE, and TRUNCATE even if ORM listeners are bypassed.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    req = SessionCreateRequest(
        name="Engine Immutability Session",
        course_length_m=Decimal("1000.0000"),
        rides=[],
    )
    session = SessionService.create_session(db=db_session, session_in=req)
    events = SessionService.get_session_audit_trail(db_session, session.id)
    event_id = events[0].id

    # 1. Raw SQL UPDATE
    with pytest.raises(DBAPIError, match="Table audit_events is append-only: UPDATE operations are strictly prohibited"):
        db_session.execute(
            text("UPDATE audit_events SET event_summary = 'Tampered via raw SQL' WHERE id = :eid"),
            {"eid": event_id},
        )
        db_session.commit()
    db_session.rollback()

    # 2. Raw SQL DELETE
    with pytest.raises(DBAPIError, match="Table audit_events is append-only: DELETE operations are strictly prohibited"):
        db_session.execute(
            text("DELETE FROM audit_events WHERE id = :eid"),
            {"eid": event_id},
        )
        db_session.commit()
    db_session.rollback()

    # 3. Raw SQL TRUNCATE
    with pytest.raises(DBAPIError, match="Table audit_events is append-only: TRUNCATE operations are strictly prohibited"):
        db_session.execute(text("TRUNCATE TABLE audit_events;"))
        db_session.commit()
    db_session.rollback()


def test_database_trigger_blocks_sqlalchemy_core_mutation(db_session: Session):
    """Verify that SQLAlchemy Core bulk update/delete statements (which bypass ORM mapper listeners)
    are caught and rejected by the PostgreSQL database trigger.
    """
    from sqlalchemy.exc import DBAPIError

    req = SessionCreateRequest(
        name="Core Immutability Session",
        course_length_m=Decimal("1000.0000"),
        rides=[],
    )
    session = SessionService.create_session(db=db_session, session_in=req)
    events = SessionService.get_session_audit_trail(db_session, session.id)
    event_id = events[0].id

    # Core bulk update
    with pytest.raises(DBAPIError, match="Table audit_events is append-only: UPDATE operations are strictly prohibited"):
        db_session.execute(
            update(AuditEvent).where(AuditEvent.id == event_id).values(event_summary="Core bypass attempt")
        )
        db_session.commit()
    db_session.rollback()

    # Core bulk delete
    with pytest.raises(DBAPIError, match="Table audit_events is append-only: DELETE operations are strictly prohibited"):
        db_session.execute(
            delete(AuditEvent).where(AuditEvent.id == event_id)
        )
        db_session.commit()
    db_session.rollback()


