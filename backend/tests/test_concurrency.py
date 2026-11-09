"""Tests for optimistic concurrency control and conflict resolution."""

import uuid
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.session import MeasurementSession
from app.services.session_service import SessionService, ConcurrencyConflictError
from app.schemas.session import SessionCreateRequest, SessionUpdateRequest


def test_stale_session_version_update_rejected(db_session: Session):
    """Verify that submitting an update with an outdated version raises ConcurrencyConflictError."""
    req = SessionCreateRequest(
        name="Concurrency Baseline Session",
        course_length_m=Decimal("1000.0000"),
        rides=[],
    )
    session = SessionService.create_session(db=db_session, session_in=req)
    assert session.version == 1

    # Update 1: version 1 -> 2
    update_1 = SessionUpdateRequest(
        expected_version=1,
        name="Updated Once",
    )
    updated_session = SessionService.update_session(
        db=db_session,
        session_id=session.id,
        update_in=update_1,
    )
    assert updated_session.version == 2

    # Update 2: client attempts update using stale expected_version=1
    stale_update = SessionUpdateRequest(
        expected_version=1,  # Stale! Current version is 2
        name="Stale Overwrite Attempt",
    )
    with pytest.raises(ConcurrencyConflictError) as exc_info:
        SessionService.update_session(
            db=db_session,
            session_id=session.id,
            update_in=stale_update,
        )

    assert exc_info.value.expected_version == 1
    assert exc_info.value.current_version == 2


def test_api_returns_rfc_7807_problem_details_on_concurrency_conflict(auth_client: TestClient):
    """Verify that HTTP PUT returns HTTP 409 Conflict with structured Problem Details."""
    # 1. Create session via API
    create_payload = {
        "name": "API Concurrency Session",
        "course_length_m": "1000.0000",
        "rides": [],
    }
    create_res = auth_client.post("/api/v1/sessions", json=create_payload)
    assert create_res.status_code == 201
    created_data = create_res.json()
    session_id = created_data["id"]
    assert created_data["version"] == 1

    # 2. Client A updates session to version 2
    update_a = {
        "expected_version": 1,
        "name": "Client A Update",
    }
    res_a = auth_client.put(f"/api/v1/sessions/{session_id}", json=update_a)
    assert res_a.status_code == 200
    assert res_a.json()["version"] == 2

    # 3. Client B attempts update with stale version 1
    update_b = {
        "expected_version": 1,
        "name": "Client B Competing Update",
    }
    res_b = auth_client.put(f"/api/v1/sessions/{session_id}", json=update_b)
    assert res_b.status_code == 409
    assert res_b.headers["Content-Type"] == "application/problem+json"

    problem = res_b.json()
    assert problem["status"] == 409
    assert problem["title"] == "Conflict" or "409" in problem["type"]
    assert "Concurrency conflict" in problem["detail"]
    assert "expected version 1" in problem["detail"]


def test_audit_integrity_preserved_after_concurrency_conflict(db_session: Session):
    """Verify that a rejected concurrent update does not pollute or break the audit chain."""
    req = SessionCreateRequest(
        name="Integrity Preservation Session",
        course_length_m=Decimal("1000.0000"),
        rides=[],
    )
    session = SessionService.create_session(db=db_session, session_in=req)

    # Legitimate update (seq 2)
    SessionService.update_session(
        db=db_session,
        session_id=session.id,
        update_in=SessionUpdateRequest(expected_version=1, name="Legit 1"),
    )

    # Failed stale update
    with pytest.raises(ConcurrencyConflictError):
        SessionService.update_session(
            db=db_session,
            session_id=session.id,
            update_in=SessionUpdateRequest(expected_version=1, name="Failed Conflict"),
        )

    # Legitimate update 2 (seq 3)
    SessionService.update_session(
        db=db_session,
        session_id=session.id,
        update_in=SessionUpdateRequest(expected_version=2, name="Legit 2"),
    )

    # Verify audit ledger integrity
    audit_events = SessionService.get_session_audit_trail(db_session, session.id)
    assert len(audit_events) == 3
    assert [e.sequence_num for e in audit_events] == [1, 2, 3]

    verification = SessionService.verify_session_audit_trail(db_session, session.id)
    assert verification.is_valid is True
    assert verification.verified_events == 3

