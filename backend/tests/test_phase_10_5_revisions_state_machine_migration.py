"""Unit and integration test suite for Phase 10.5:
Lifecycle State Machine, Finalization Immutability Guards,
Formal Session Revisions with Lineage Tracking, and Legacy Migration.
"""

import uuid
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.session import MeasurementSession
from app.domain.state_machine import (
    SessionState,
    SessionStateMachine,
    InvalidStateTransitionError,
    SessionImmutableError,
    FinalizationBlockerError,
    PolicyRatificationError,
)
from app.services.session_service import SessionService
from app.schemas.session import SessionCreateRequest, SessionRideCreateSchema, SessionUpdateRequest
from tests.conftest import create_test_user_with_role


@pytest.fixture
def measurer_token_headers(db_session: Session) -> dict:
    user, token = create_test_user_with_role(db_session, "measurer")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def supervisor_token_headers(db_session: Session) -> dict:
    user, token = create_test_user_with_role(db_session, "supervisor")
    return {"Authorization": f"Bearer {token}"}



class TestSessionStateMachine:
    """Tests for the domain lifecycle state machine."""

    def test_allowed_transitions(self):
        assert SessionStateMachine.can_transition("draft", "in_progress")
        assert SessionStateMachine.can_transition("draft", "needs_review")
        assert SessionStateMachine.can_transition("needs_review", "approved")
        assert SessionStateMachine.can_transition("needs_review", "ready_for_final_review")
        assert SessionStateMachine.can_transition("approved", "finalized")
        assert SessionStateMachine.can_transition("ready_for_final_review", "finalized")
        assert SessionStateMachine.can_transition("finalized", "superseded")

    def test_forbidden_transitions(self):
        assert not SessionStateMachine.can_transition("draft", "finalized")
        assert not SessionStateMachine.can_transition("in_progress", "finalized")
        assert not SessionStateMachine.can_transition("finalized", "draft")
        assert not SessionStateMachine.can_transition("finalized", "needs_review")
        assert not SessionStateMachine.can_transition("superseded", "draft")
        assert not SessionStateMachine.can_transition("superseded", "finalized")

    def test_validate_transition_raises_on_illegal(self):
        with pytest.raises(InvalidStateTransitionError):
            SessionStateMachine.validate_transition("draft", "finalized")

    def test_check_immutability_raises_on_finalized_or_superseded(self):
        finalized_session = MeasurementSession(
            id=uuid.uuid4(),
            name="Finalized Session",
            course_length_m=Decimal("1000.0000"),
            status="finalized",
        )
        with pytest.raises(SessionImmutableError):
            SessionStateMachine.check_immutability(finalized_session)

        superseded_session = MeasurementSession(
            id=uuid.uuid4(),
            name="Superseded Session",
            course_length_m=Decimal("1000.0000"),
            status="superseded",
        )
        with pytest.raises(SessionImmutableError):
            SessionStateMachine.check_immutability(superseded_session)

    def test_finalization_blockers_raised_when_criteria_unmet(self):
        # Missing rides, missing peer review, invalid state
        session = MeasurementSession(
            id=uuid.uuid4(),
            name="Draft Session",
            course_length_m=Decimal("1000.0000"),
            status="draft",
        )
        session.rides = []
        session.reviews = []

        with pytest.raises(FinalizationBlockerError) as exc_info:
            SessionStateMachine.validate_finalization_readiness(session)

        assert "must be in 'ready_for_final_review'" in str(exc_info.value)
        assert "At least 4 pre-calibration rides are required" in str(exc_info.value)
        assert "approved peer review is required" in str(exc_info.value)


class TestFinalizationAndImmutabilityWorkflow:
    """Integration tests for finalization guards and permanent immutability."""

    def test_finalization_blocked_by_unratified_policy_without_confirmation(
        self, client: TestClient, db_session: Session, measurer_token_headers, supervisor_token_headers
    ):
        # Create session and rides as measurer
        rides = [
            SessionRideCreateSchema(ride_type="pre_calibration", ride_number=1, start_count=10000, finish_count=15000),
            SessionRideCreateSchema(ride_type="pre_calibration", ride_number=2, start_count=15000, finish_count=20000),
            SessionRideCreateSchema(ride_type="pre_calibration", ride_number=3, start_count=20000, finish_count=25000),
            SessionRideCreateSchema(ride_type="pre_calibration", ride_number=4, start_count=25000, finish_count=30000),
        ]
        create_resp = client.post(
            "/api/v1/sessions",
            headers=measurer_token_headers,
            json={
                "name": "Session for Finalization",
                "course_length_m": "1000.0000",
                "rides": [r.model_dump() for r in rides],
            },
        )
        assert create_resp.status_code == 201
        sess_data = create_resp.json()
        session_id = sess_data["id"]

        # Submit for review as measurer
        submit_resp = client.post(f"/api/v1/sessions/{session_id}/submit", headers=measurer_token_headers)
        assert submit_resp.status_code == 200

        # Review and approve as supervisor (distinct user, satisfying Separation of Duties)
        review_resp = client.post(
            f"/api/v1/sessions/{session_id}/reviews",
            headers=supervisor_token_headers,
            json={"expected_version": 2, "status": "approved", "comments": "Technical audit passed"},
        )
        assert review_resp.status_code == 201

        # Attempt to finalize without confirm_provisional_policy -> HTTP 422
        fin_resp_blocked = client.post(
            f"/api/v1/sessions/{session_id}/finalize",
            headers=supervisor_token_headers,
            json={"expected_version": 3, "confirm_provisional_policy": False},
        )
        assert fin_resp_blocked.status_code == 422
        assert "Policy ratification blocker" in fin_resp_blocked.json()["detail"]

        # Finalize WITH confirm_provisional_policy -> HTTP 200
        fin_resp_ok = client.post(
            f"/api/v1/sessions/{session_id}/finalize",
            headers=supervisor_token_headers,
            json={"expected_version": 3, "confirm_provisional_policy": True, "supervisor_notes": "Approved for pilot"},
        )
        assert fin_resp_ok.status_code == 200
        finalized_data = fin_resp_ok.json()
        assert finalized_data["status"] == "finalized"
        assert finalized_data["version"] == 4

        # Verify finalized session is strictly immutable
        update_blocked = client.put(
            f"/api/v1/sessions/{session_id}",
            headers=supervisor_token_headers,
            json={"expected_version": 4, "name": "Attempted Edit on Finalized"},
        )
        assert update_blocked.status_code == 409
        assert "immutable" in update_blocked.json()["detail"].lower()


class TestSessionRevisionsAndLineage:
    """Tests for creating linked revisions and lineage retrieval."""

    def test_create_revision_and_lineage_flow(
        self, client: TestClient, db_session: Session, measurer_token_headers, supervisor_token_headers
    ):
        # 1. Create, submit, approve, and finalize a parent session
        rides = [
            SessionRideCreateSchema(ride_type="pre_calibration", ride_number=1, start_count=10000, finish_count=15000),
            SessionRideCreateSchema(ride_type="pre_calibration", ride_number=2, start_count=15000, finish_count=20000),
            SessionRideCreateSchema(ride_type="pre_calibration", ride_number=3, start_count=20000, finish_count=25000),
            SessionRideCreateSchema(ride_type="pre_calibration", ride_number=4, start_count=25000, finish_count=30000),
        ]
        create_resp = client.post(
            "/api/v1/sessions",
            headers=measurer_token_headers,
            json={"name": "Original Course 10K", "course_length_m": "1000.0000", "rides": [r.model_dump() for r in rides]},
        )
        parent_id = create_resp.json()["id"]

        client.post(f"/api/v1/sessions/{parent_id}/submit", headers=measurer_token_headers)
        client.post(
            f"/api/v1/sessions/{parent_id}/reviews",
            headers=supervisor_token_headers,
            json={"expected_version": 2, "status": "approved"},
        )
        client.post(
            f"/api/v1/sessions/{parent_id}/finalize",
            headers=supervisor_token_headers,
            json={"expected_version": 3, "confirm_provisional_policy": True},
        )

        # 2. Cannot revise with too short a reason (< 10 chars)
        rev_fail = client.post(
            f"/api/v1/sessions/{parent_id}/revisions",
            headers=supervisor_token_headers,
            json={"revision_reason": "Too short"},
        )
        assert rev_fail.status_code == 422

        # 3. Create valid formal revision
        rev_resp = client.post(
            f"/api/v1/sessions/{parent_id}/revisions",
            headers=supervisor_token_headers,
            json={"revision_reason": "Official recalculation due to updated course temperature calibration"},
        )
        assert rev_resp.status_code == 201
        child_data = rev_resp.json()
        child_id = child_data["id"]

        assert child_data["status"] == "draft"
        assert child_data["supersedes_id"] == parent_id
        assert len(child_data["rides"]) == 4

        # 4. Check parent is now superseded
        parent_get = client.get(f"/api/v1/sessions/{parent_id}", headers=supervisor_token_headers)
        assert parent_get.status_code == 200
        parent_fresh = parent_get.json()
        assert parent_fresh["status"] == "superseded"
        assert parent_fresh["superseded_by_id"] == child_id

        # 5. Check Lineage endpoint
        lineage_resp = client.get(f"/api/v1/sessions/{child_id}/lineage", headers=supervisor_token_headers)
        assert lineage_resp.status_code == 200
        lineage_data = lineage_resp.json()
        assert len(lineage_data["ancestors"]) == 1
        assert lineage_data["ancestors"][0]["id"] == parent_id
        assert len(lineage_data["descendants"]) == 0

        # Parent's lineage should list child as descendant
        parent_lineage = client.get(f"/api/v1/sessions/{parent_id}/lineage", headers=supervisor_token_headers)
        assert parent_lineage.status_code == 200
        p_lineage_data = parent_lineage.json()
        assert len(p_lineage_data["ancestors"]) == 0
        assert len(p_lineage_data["descendants"]) == 1
        assert p_lineage_data["descendants"][0]["id"] == child_id


class TestLegacySessionMigration:
    """Tests for the legacy JSON backup migration endpoint."""

    def test_migration_dry_run_and_persistence(
        self, client: TestClient, db_session: Session, supervisor_token_headers
    ):
        legacy_backup = {
            "format": "CALIBRATION_SESSION_EXPORT_V1",
            "version": 1,
            "session": {
                "reference": "BC-2026-MIGRATE",
                "operator": "J. Okafor",
                "courseLength": "1000",
                "rolloverMode": "none",
                "pre": [
                    {"start": "10000", "finish": "15000", "startOverridden": False},
                    {"start": "15000", "finish": "20000", "startOverridden": False},
                    {"start": "20000", "finish": "25000", "startOverridden": False},
                    {"start": "25000", "finish": "30000", "startOverridden": False},
                ],
                "logged": {
                    "preWC": "5000.0000",  # Intentionally slightly different from 5005.0000 to verify discrepancy detection
                },
            },
        }

        # 1. Dry run
        dry_run_resp = client.post(
            "/api/v1/sessions/migrate?dry_run=true",
            headers=supervisor_token_headers,
            json={"payload": legacy_backup},
        )
        assert dry_run_resp.status_code == 200
        dry_data = dry_run_resp.json()
        assert dry_data["dry_run"] is True
        assert dry_data["session_id"] is None
        assert dry_data["discrepancy_count"] == 1
        assert dry_data["discrepancies"][0]["field"] == "pre_cal_working_constant"
        assert Decimal(dry_data["authoritative_calculations"]["pre_cal_working_constant"]) == Decimal("5005.0000")


        # 2. Persisted migration
        persist_resp = client.post(
            "/api/v1/sessions/migrate?dry_run=false",
            headers=supervisor_token_headers,
            json={"payload": legacy_backup},
        )
        assert persist_resp.status_code == 200
        persist_data = persist_resp.json()
        assert persist_data["dry_run"] is False
        assert persist_data["session_id"] is not None

        # Verify migrated session exists in database
        migrated_id = persist_data["session_id"]
        sess_get = client.get(f"/api/v1/sessions/{migrated_id}", headers=supervisor_token_headers)
        assert sess_get.status_code == 200
        sess_obj = sess_get.json()
        assert sess_obj["name"] == "BC-2026-MIGRATE"
        assert sess_obj["status"] == "draft"
        assert len(sess_obj["rides"]) == 4
