"""Real multi-threaded concurrency and transaction verification against PostgreSQL.

Covers Verification Area C of Phase 10.2.1:
- Real multi-threaded execution using threading.Barrier
- Scenario 1: Two simultaneous updates against the same session with same expected_version.
  Exactly one succeeds; the other fails with ConcurrencyConflictError (HTTP 409).
- Scenario 2: Concurrent audit appends for the same session across multiple threads.
  Row-level locking serializes appends, ensuring monotonic sequence numbers and unbroken hash links.
- Scenario 3: Transaction rollback under failure leaves no partial state or orphan audit events.
- Scenario 4: Concurrent updates on two distinct sessions run simultaneously without conflict.
"""

import threading
import uuid
from decimal import Decimal
from typing import List, Tuple
import pytest
from sqlalchemy import select

from app.audit.ledger import append_audit_event
from app.audit.verifier import verify_audit_ledger
from app.models.audit import AuditEvent
from app.models.session import MeasurementSession
from app.schemas.session import (
    SessionCreateRequest,
    SessionRideCreateSchema,
    SessionUpdateRequest,
)
from app.services.session_service import SessionService, ConcurrencyConflictError
from tests.conftest import TestingSessionLocal


def test_concurrent_session_updates_optimistic_concurrency():
    """Scenario 1: Two simultaneous updates against the same session.
    
    Both threads start with expected_version=1.
    A threading.Barrier ensures simultaneous execution.
    Exactly one thread must succeed; the competing thread must raise ConcurrencyConflictError.
    """
    # 1. Setup session in DB
    with TestingSessionLocal() as db:
        req = SessionCreateRequest(
            name="Concurrency Test Session",
            course_length_m=Decimal("1000.0000"),
            rides=[],
        )
        session = SessionService.create_session(db=db, session_in=req)
        session_id = session.id

    barrier = threading.Barrier(2)
    results: List[Tuple[str, str]] = []
    lock = threading.Lock()

    def worker(worker_id: str, new_name: str):
        with TestingSessionLocal() as thread_db:
            update_req = SessionUpdateRequest(
                expected_version=1,
                name=new_name,
                rides=[],
            )
            # Synchronize thread start
            barrier.wait()
            try:
                SessionService.update_session(
                    db=thread_db,
                    session_id=session_id,
                    update_in=update_req,
                    actor_id=f"worker_{worker_id}",
                )
                with lock:
                    results.append((worker_id, "SUCCESS"))
            except ConcurrencyConflictError:
                with lock:
                    results.append((worker_id, "CONFLICT"))
            except Exception as e:
                with lock:
                    results.append((worker_id, f"ERROR: {type(e).__name__}"))

    t1 = threading.Thread(target=worker, args=("1", "Updated By Thread 1"))
    t2 = threading.Thread(target=worker, args=("2", "Updated By Thread 2"))

    t1.start()
    t2.start()
    t1.join(timeout=10)
    t2.join(timeout=10)

    # Assertions
    statuses = [status for _, status in results]
    assert len(statuses) == 2
    assert "SUCCESS" in statuses
    assert "CONFLICT" in statuses
    assert statuses.count("SUCCESS") == 1
    assert statuses.count("CONFLICT") == 1

    # Verify database final state
    with TestingSessionLocal() as db:
        final_session = db.scalar(select(MeasurementSession).where(MeasurementSession.id == session_id))
        assert final_session.version == 2
        events = SessionService.get_session_audit_trail(db, session_id)
        # Genesis (seq 1) + NAME_UPDATED (seq 2) + READINGS_UPDATED (seq 3) = 3 audit events from winning thread
        assert len(events) == 3
        seq_nums = [e.sequence_num for e in events]
        assert seq_nums == [1, 2, 3]
        verification = verify_audit_ledger(events, expected_session_id=session_id)
        assert verification.is_valid is True


def test_concurrent_audit_appends_serialize_with_unbroken_chain():
    """Scenario 2: Concurrent audit appends for the same session across 5 threads.
    
    Verifies that row-level locking (SELECT FOR UPDATE on parent session) serializes
    appends so that sequence numbers are strictly monotonic and the hash chain is unbroken.
    """
    with TestingSessionLocal() as db:
        req = SessionCreateRequest(
            name="Audit Concurrency Session",
            course_length_m=Decimal("1000.0000"),
            rides=[],
        )
        session = SessionService.create_session(db=db, session_in=req)
        session_id = session.id

    num_threads = 5
    barrier = threading.Barrier(num_threads)
    errors: List[Exception] = []
    lock = threading.Lock()

    def append_worker(worker_idx: int):
        with TestingSessionLocal() as thread_db:
            barrier.wait()
            try:
                with thread_db.begin():
                    append_audit_event(
                        db=thread_db,
                        session_id=session_id,
                        event_type="CONCURRENT_MEASUREMENT_LOG",
                        actor_id=f"measurer_{worker_idx}",
                        event_summary=f"Concurrent log event from worker {worker_idx}",
                        payload={"worker_idx": worker_idx},
                    )
            except Exception as e:
                with lock:
                    errors.append(e)

    threads = [threading.Thread(target=append_worker, args=(i,)) for i in range(num_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=15)

    assert len(errors) == 0, f"Encountered errors during concurrent audit appends: {errors}"

    # Verify ledger integrity in DB
    with TestingSessionLocal() as db:
        events = SessionService.get_session_audit_trail(db, session_id)
        # Genesis (seq 1) + 5 worker events = 6 events total
        assert len(events) == 6
        seq_nums = [e.sequence_num for e in events]
        assert seq_nums == [1, 2, 3, 4, 5, 6]

        verification = verify_audit_ledger(events, expected_session_id=session_id)
        assert verification.is_valid is True
        assert verification.total_events == 6
        assert verification.verified_events == 6
        assert len(verification.errors) == 0


def test_transaction_rollback_under_failure_leaves_no_partial_state():
    """Scenario 3: Transaction rollback under failure.
    
    Verifies that a failure during an update rolls back completely, leaving
    no partial database records, orphan rides, or partial audit events.
    """
    with TestingSessionLocal() as db:
        req = SessionCreateRequest(
            name="Rollback Stress Session",
            course_length_m=Decimal("1000.0000"),
            rides=[],
        )
        session = SessionService.create_session(db=db, session_in=req)
        session_id = session.id

    # Attempt an update that violates database constraints (e.g., negative counter)
    with TestingSessionLocal() as db:
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
        # Violate non-negative check constraint
        update_req.rides[0].start_count = -500

        with pytest.raises(Exception):
            SessionService.update_session(
                db=db,
                session_id=session_id,
                update_in=update_req,
            )

    # Verify session remains at version 1 and has zero rides and only 1 genesis audit event
    with TestingSessionLocal() as db:
        fresh = db.scalar(select(MeasurementSession).where(MeasurementSession.id == session_id))
        assert fresh.version == 1
        assert len(fresh.rides) == 0
        events = SessionService.get_session_audit_trail(db, session_id)
        assert len(events) == 1
        assert events[0].event_type == "SESSION_CREATED"


def test_concurrent_updates_to_distinct_sessions_succeed_independently():
    """Scenario 4: Concurrent updates on two distinct sessions run without blocking each other."""
    with TestingSessionLocal() as db:
        s1 = SessionService.create_session(
            db=db,
            session_in=SessionCreateRequest(name="Session A", course_length_m=Decimal("1000.0000"), rides=[]),
        )
        s2 = SessionService.create_session(
            db=db,
            session_in=SessionCreateRequest(name="Session B", course_length_m=Decimal("500.0000"), rides=[]),
        )
        id1, id2 = s1.id, s2.id

    barrier = threading.Barrier(2)
    outcomes: dict[str, str] = {}
    lock = threading.Lock()

    def worker(sess_id: uuid.UUID, key: str, new_name: str):
        with TestingSessionLocal() as thread_db:
            barrier.wait()
            try:
                SessionService.update_session(
                    db=thread_db,
                    session_id=sess_id,
                    update_in=SessionUpdateRequest(expected_version=1, name=new_name, rides=[]),
                )
                with lock:
                    outcomes[key] = "SUCCESS"
            except Exception as e:
                with lock:
                    outcomes[key] = f"ERROR: {e}"

    t1 = threading.Thread(target=worker, args=(id1, "s1", "Session A Renamed"))
    t2 = threading.Thread(target=worker, args=(id2, "s2", "Session B Renamed"))

    t1.start()
    t2.start()
    t1.join(timeout=10)
    t2.join(timeout=10)

    assert outcomes["s1"] == "SUCCESS"
    assert outcomes["s2"] == "SUCCESS"

    with TestingSessionLocal() as db:
        s1_fresh = db.scalar(select(MeasurementSession).where(MeasurementSession.id == id1))
        s2_fresh = db.scalar(select(MeasurementSession).where(MeasurementSession.id == id2))
        assert s1_fresh.version == 2
        assert s1_fresh.name == "Session A Renamed"
        assert s2_fresh.version == 2
        assert s2_fresh.name == "Session B Renamed"
