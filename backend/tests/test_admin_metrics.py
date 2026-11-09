"""Unit and integration tests for Admin Overview & Metrics endpoint."""

from decimal import Decimal
import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.session import MeasurementSession
from tests.conftest import create_test_user_with_role


def test_admin_overview_requires_authentication(client: TestClient):
    """Anonymous access to /admin/overview is rejected with HTTP 401."""
    resp = client.get("/api/v1/admin/overview")
    assert resp.status_code == 401


def test_admin_overview_forbidden_for_standard_user(client: TestClient, db_session: Session):
    """Standard measurer cannot view admin overview metrics (HTTP 403)."""
    user, token = create_test_user_with_role(db_session, role_name="measurer")
    headers = {"Authorization": f"Bearer {token}"}

    resp = client.get("/api/v1/admin/overview", headers=headers)
    assert resp.status_code == 403
    assert "Admin or Supervisor role required" in resp.json()["detail"]


def test_admin_overview_success_for_admin(client: TestClient, db_session: Session):
    """Admin role accesses overview metrics, counts, and recent activity."""
    # 1. Create admin user
    admin_user, admin_token = create_test_user_with_role(db_session, role_name="admin")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 2. Create another active user (measurer)
    measurer, _ = create_test_user_with_role(db_session, role_name="measurer", email="measurer1@example.com")

    # 3. Create sample draft and finalized sessions
    draft_session = MeasurementSession(
        id=uuid.uuid4(),
        version=1,
        schema_version=1,
        status="draft",
        name="BC-2026-DRAFT",
        measurer_id=str(measurer.id),
        course_name="Downtown 5K",
        course_length_m=Decimal("1000.0000"),
        course_length_unit="m",
        rollover_mode="none",
        constant_selection_rule="larger",
        working_spec_version="ws-0.3-provisional",
        policy_approval_status="provisional",
        is_provisional=True,
    )
    finalized_session = MeasurementSession(
        id=uuid.uuid4(),
        version=4,
        schema_version=1,
        status="finalized",
        name="BC-2026-FINAL",
        measurer_id=str(measurer.id),
        course_name="Olympic 10K",
        course_length_m=Decimal("1000.0000"),
        course_length_unit="m",
        rollover_mode="none",
        constant_selection_rule="larger",
        working_spec_version="ws-0.3-provisional",
        policy_approval_status="provisional",
        is_provisional=True,
    )
    db_session.add_all([draft_session, finalized_session])
    db_session.commit()

    # 4. Fetch metrics
    resp = client.get("/api/v1/admin/overview", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()

    # Total users: admin_user + measurer >= 2
    assert data["total_users"] >= 2
    assert data["total_sessions"] == 2
    assert data["total_finalized_reports"] == 1
    assert data["total_draft_sessions"] == 1

    # Monthly activity contains 6 months
    assert len(data["monthly_activity"]) == 6

    # Recent activity contains both sessions
    assert len(data["recent_activity"]) == 2
    refs = {s["reference"] for s in data["recent_activity"]}
    assert "BC-2026-DRAFT" in refs
    assert "BC-2026-FINAL" in refs

