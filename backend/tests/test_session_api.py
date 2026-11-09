"""Integration tests for session persistence and audit API endpoints."""

import uuid
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.review import SessionReview


def test_session_lifecycle_with_authoritative_calculations(auth_client: TestClient):
    """Verify session creation and authoritative calculation with Golden Reference values:
    Course: 200m
    Rides: 939, 1021, 1010, 1000
    Total: 3970, Average: 992.5, CPK: 4962.5, WC: 4967.4625.
    """
    payload = {
        "name": "Golden Vector Session",
        "course_name": "Reference 200m Course",
        "course_length_m": "200.0000",
        "rides": [
            {"ride_type": "pre_calibration", "ride_number": 1, "start_count": 11082, "finish_count": 12021},
            {"ride_type": "pre_calibration", "ride_number": 2, "start_count": 12021, "finish_count": 13042},
            {"ride_type": "pre_calibration", "ride_number": 3, "start_count": 13042, "finish_count": 14052},
            {"ride_type": "pre_calibration", "ride_number": 4, "start_count": 14052, "finish_count": 15052},
        ],
    }
    res = auth_client.post("/api/v1/sessions", json=payload)
    assert res.status_code == 201
    data = res.json()
    session_id = data["id"]
    assert data["version"] == 1
    assert data["status"] == "draft"
    assert len(data["rides"]) == 4

    # Verify authoritative calculation results
    assert Decimal(str(data["pre_cal_working_constant"])) == Decimal("4967.4625")
    assert Decimal(str(data["final_working_constant"])) == Decimal("4967.4625")
    assert data["is_provisional"] is True
    assert "PROVISIONAL" in data["policy_notice"]

    # Retrieve session via GET
    get_res = auth_client.get(f"/api/v1/sessions/{session_id}")
    assert get_res.status_code == 200
    get_data = get_res.json()
    assert Decimal(str(get_data["pre_cal_working_constant"])) == Decimal("4967.4625")

    # Verify audit trail contains Genesis event
    audit_res = auth_client.get(f"/api/v1/sessions/{session_id}/audit-trail")
    assert audit_res.status_code == 200
    events = audit_res.json()
    assert len(events) == 1
    assert events[0]["event_type"] == "SESSION_CREATED"
    assert events[0]["sequence_num"] == 1

    # Verify audit ledger integrity
    verify_res = auth_client.post(f"/api/v1/sessions/{session_id}/verify-audit")
    assert verify_res.status_code == 200
    verify_data = verify_res.json()
    assert verify_data["is_valid"] is True
    assert verify_data["verified_events"] == 1
    assert len(verify_data["errors"]) == 0


def test_upstream_reading_modification_invalidates_downstream_review(
    auth_client: TestClient, db_session: Session
):
    """Verify that updating calibration readings invalidates previously approved reviews."""
    # 1. Create session
    create_res = auth_client.post(
        "/api/v1/sessions",
        json={"name": "Review Invalidation Session", "course_length_m": "1000.0000", "rides": []},
    )
    session_id = create_res.json()["id"]

    # 2. Add an approved review directly in database
    review = SessionReview(
        session_id=uuid.UUID(session_id),
        reviewer_id="provisional:independent-reviewer",
        status="approved",
        comments="Initial review approved",
    )
    db_session.add(review)
    db_session.commit()

    # 3. Modify readings via API
    update_res = auth_client.put(
        f"/api/v1/sessions/{session_id}",
        json={
            "expected_version": 1,
            "rides": [
                {"ride_type": "pre_calibration", "ride_number": 1, "start_count": 5000, "finish_count": 6000}
            ],
            "change_reason": "Corrected ride 1 start count",
        },
    )
    assert update_res.status_code == 200
    updated_data = update_res.json()
    assert updated_data["version"] == 2

    # Verify review was invalidated
    assert len(updated_data["reviews"]) == 1
    rev = updated_data["reviews"][0]
    assert rev["is_invalidated"] is True
    assert "Upstream" in rev["invalidation_reason"]

    # Verify audit trail recorded both REVIEW_INVALIDATED and READINGS_UPDATED
    audit_res = auth_client.get(f"/api/v1/sessions/{session_id}/audit-trail")
    events = audit_res.json()
    event_types = [e["event_type"] for e in events]
    assert "REVIEW_INVALIDATED" in event_types
    assert "READINGS_UPDATED" in event_types

    # Cryptographic integrity of audit chain remains intact
    verify_res = auth_client.post(f"/api/v1/sessions/{session_id}/verify-audit")
    assert verify_res.json()["is_valid"] is True


def test_api_validation_rejects_missing_override_reason(auth_client: TestClient):
    """Verify that API rejects rides with is_linked_override=True and empty reason with HTTP 422."""
    payload = {
        "name": "Invalid Override Session",
        "course_length_m": "1000.0000",
        "rides": [
            {
                "ride_type": "pre_calibration",
                "ride_number": 1,
                "start_count": 1000,
                "finish_count": 2000,
                "is_linked_override": True,
                "override_reason": "   ",  # Empty / whitespace
            }
        ],
    }
    res = auth_client.post("/api/v1/sessions", json=payload)
    assert res.status_code == 422
    problem = res.json()
    assert problem["status"] == 422
    assert "override reason must be provided" in str(problem)

