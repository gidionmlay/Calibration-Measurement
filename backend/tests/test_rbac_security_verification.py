"""Independent Security Verification tests for Phase 10.3.3.

Demonstrates and verifies:
- SEC-10-3-01: Session Creator Identity Forgery / Separation of Duties Bypass
- SEC-10-3-02: IDOR on Session Details (GET /sessions/{id})
- SEC-10-3-03: IDOR on Session Audit Trail (GET /sessions/{id}/audit-trail)
- SEC-10-3-04: Missing expected_version & Workflow State Validation in Session Review (TOCTOU Review Race)
- SEC-10-3-05: Missing Mandatory Reason Validation on Role Assignment & Revocation
- SEC-10-3-06: Database IntegrityError on Concurrent Duplicate Role Assignments
- Plus: Authorization freshness after role revocation, mass-assignment guards, and database constraints.
"""

import uuid
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.rbac import Role, Permission, UserRole
from app.models.session import MeasurementSession
from app.models.user import User
from app.auth.rbac import SystemRoles, SystemPermissions, RBACService
from tests.conftest import create_test_user_with_role, make_test_jwt, test_engine


# ==============================================================================
# SEC-10-3-01: Session Creator Identity Forgery & SoD Bypass
# ==============================================================================

def test_measurer_cannot_forge_session_creator_identity_in_payload(client: TestClient, db_session: Session):
    """VULNERABILITY REPRODUCTION (SEC-10-3-01):
    Measurer A attempts to create a session supplying Measurer B's user ID as `measurer_id`
    in the payload to disguise ownership and subsequently review their own work.
    
    EXPECTED SECURE BEHAVIOR:
    The server-side session creator MUST derive measurer_id from the authenticated user
    (current_user.id), ignoring or overriding any forged measurer_id in the payload.
    """
    measurer_a, token_a = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    measurer_b, _ = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    headers_a = {"Authorization": f"Bearer {token_a}"}

    payload = {
        "name": "Spoofed Ownership Session",
        "measurer_id": str(measurer_b.id),  # Forged measurer ID!
        "course_length_m": "1000.0000",
        "rides": [],
    }
    res = client.post("/api/v1/sessions", json=payload, headers=headers_a)
    assert res.status_code == 201
    data = res.json()

    # The persisted measurer_id MUST be measurer_a (the authenticated actor), NOT measurer_b
    assert data["measurer_id"] == str(measurer_a.id), (
        f"VULNERABILITY CONFIRMED: measurer_id was forged to {data['measurer_id']} instead of {measurer_a.id}"
    )


# ==============================================================================
# SEC-10-3-02: IDOR on Session Details (GET /sessions/{id})
# ==============================================================================

def test_measurer_cannot_read_another_measurers_unsubmitted_session(client: TestClient, db_session: Session):
    """VULNERABILITY REPRODUCTION (SEC-10-3-02):
    Measurer A creates a private draft session.
    Measurer B (holding only 'measurer' role) attempts to read Measurer A's session via GET /sessions/{id}.
    
    EXPECTED SECURE BEHAVIOR:
    Measurer B must receive HTTP 403 Forbidden (cross-user draft access denied).
    """
    measurer_a, token_a = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    measurer_b, token_b = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "Measurer A Private Draft", "course_length_m": "1000.0000", "rides": []},
        headers=headers_a,
    )
    assert create_res.status_code == 201
    session_id = create_res.json()["id"]

    # Measurer B attempts to read Measurer A's session
    get_res = client.get(f"/api/v1/sessions/{session_id}", headers=headers_b)
    assert get_res.status_code == 403, (
        f"VULNERABILITY CONFIRMED (IDOR): Measurer B was able to read Measurer A's session (status {get_res.status_code})"
    )


# ==============================================================================
# SEC-10-3-03: IDOR on Session Audit Trail (GET /sessions/{id}/audit-trail)
# ==============================================================================

def test_measurer_cannot_read_another_measurers_audit_trail(client: TestClient, db_session: Session):
    """VULNERABILITY REPRODUCTION (SEC-10-3-03):
    Measurer A creates a session with audit records.
    Measurer B attempts to read Measurer A's audit history via GET /sessions/{id}/audit-trail.
    
    EXPECTED SECURE BEHAVIOR:
    Measurer B must receive HTTP 403 Forbidden (cross-user audit access denied).
    """
    measurer_a, token_a = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    measurer_b, token_b = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "Measurer A Audit Test", "course_length_m": "1000.0000", "rides": []},
        headers=headers_a,
    )
    session_id = create_res.json()["id"]

    # Measurer B attempts to read Measurer A's audit trail
    trail_res = client.get(f"/api/v1/sessions/{session_id}/audit-trail", headers=headers_b)
    assert trail_res.status_code == 403, (
        f"VULNERABILITY CONFIRMED (Audit IDOR): Measurer B read Measurer A's audit trail (status {trail_res.status_code})"
    )


# ==============================================================================
# SEC-10-3-04: Missing expected_version & Workflow State in Session Review (TOCTOU)
# ==============================================================================

def test_review_requires_expected_version_and_needs_review_state(client: TestClient, db_session: Session):
    """VULNERABILITY REPRODUCTION (SEC-10-3-04):
    1. A reviewer attempts to review a session that is still in 'draft' status (not yet submitted).
    2. A reviewer attempts to submit a review without providing 'expected_version'.
    3. A reviewer submits a review with an outdated expected_version after the draft was modified.
    
    EXPECTED SECURE BEHAVIOR:
    - Attempting to review a 'draft' session must return HTTP 409 Conflict.
    - Review payload MUST require expected_version.
    - Stale expected_version must return HTTP 409 Conflict.
    """
    measurer, m_token = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    reviewer, r_token = create_test_user_with_role(db_session, role_name=SystemRoles.REVIEWER)
    m_headers = {"Authorization": f"Bearer {m_token}"}
    r_headers = {"Authorization": f"Bearer {r_token}"}

    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "TOCTOU Review Test", "course_length_m": "1000.0000", "rides": []},
        headers=m_headers,
    )
    session_id = create_res.json()["id"]

    # 1a. Attempt by reviewer to review draft session before submission -> 403 Forbidden (draft isolation)
    premature_review = client.post(
        f"/api/v1/sessions/{session_id}/reviews",
        json={"expected_version": 1, "status": "approved", "comments": "Premature review"},
        headers=r_headers,
    )
    assert premature_review.status_code == 403

    # 1b. Attempt by elevated supervisor to review draft session before submission -> 409 Conflict (invalid workflow state)
    supervisor, s_token = create_test_user_with_role(db_session, role_name=SystemRoles.SUPERVISOR)
    s_headers = {"Authorization": f"Bearer {s_token}"}
    sup_premature = client.post(
        f"/api/v1/sessions/{session_id}/reviews",
        json={"expected_version": 1, "status": "approved", "comments": "Premature supervisor review"},
        headers=s_headers,
    )
    assert sup_premature.status_code == 409
    assert "must be in 'needs_review' status" in sup_premature.json()["detail"]

    # Now measurer submits session (transitions to needs_review, version becomes 2)
    client.post(f"/api/v1/sessions/{session_id}/submit", headers=m_headers)

    # 2. Reviewer submits review without expected_version -> 422 Unprocessable Content
    missing_ver_res = client.post(
        f"/api/v1/sessions/{session_id}/reviews",
        json={"status": "approved", "comments": "Missing version"},
        headers=r_headers,
    )
    assert missing_ver_res.status_code == 422, (
        f"VULNERABILITY CONFIRMED: Review accepted without expected_version (status {missing_ver_res.status_code})"
    )

    # 3. Reviewer submits review with stale expected_version=1 when current version is 2 -> 409 Conflict
    stale_ver_res = client.post(
        f"/api/v1/sessions/{session_id}/reviews",
        json={"expected_version": 1, "status": "approved", "comments": "Stale version"},
        headers=r_headers,
    )
    assert stale_ver_res.status_code == 409, (
        f"VULNERABILITY CONFIRMED: Stale review accepted (status {stale_ver_res.status_code})"
    )


# ==============================================================================
# SEC-10-3-05: Missing Mandatory Reason on Role Assignment & Revocation
# ==============================================================================

def test_role_assignment_and_revocation_requires_mandatory_reason(client: TestClient, db_session: Session):
    """VULNERABILITY REPRODUCTION (SEC-10-3-05):
    Admin attempts to assign a role without a reason or with empty/whitespace reason.
    Admin attempts to revoke a role without a reason.
    
    EXPECTED SECURE BEHAVIOR:
    HTTP 422 Unprocessable Content when reason is missing, empty, or whitespace.
    """
    admin, admin_token = create_test_user_with_role(db_session, role_name=SystemRoles.ADMIN)
    target_user, _ = create_test_user_with_role(db_session, role_name=None)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Assign role without reason -> 422
    no_reason_assign = client.post(
        f"/api/v1/auth/users/{target_user.id}/roles",
        json={"role_name": "measurer"},
        headers=admin_headers,
    )
    assert no_reason_assign.status_code == 422, (
        f"VULNERABILITY CONFIRMED: Role assigned without mandatory reason (status {no_reason_assign.status_code})"
    )

    # 2. Assign role with whitespace reason -> 422
    ws_reason_assign = client.post(
        f"/api/v1/auth/users/{target_user.id}/roles",
        json={"role_name": "measurer", "reason": "    "},
        headers=admin_headers,
    )
    assert ws_reason_assign.status_code == 422, (
        f"VULNERABILITY CONFIRMED: Role assigned with empty whitespace reason (status {ws_reason_assign.status_code})"
    )

    # 3. Valid assignment with reason -> 201
    valid_assign = client.post(
        f"/api/v1/auth/users/{target_user.id}/roles",
        json={"role_name": "measurer", "reason": "Certified official measurer 2026"},
        headers=admin_headers,
    )
    assert valid_assign.status_code == 201

    # 4. Revocation without reason -> 422
    no_reason_revoke = client.delete(
        f"/api/v1/auth/users/{target_user.id}/roles/measurer",
        headers=admin_headers,
    )
    assert no_reason_revoke.status_code == 422, (
        f"VULNERABILITY CONFIRMED: Role revoked without mandatory reason (status {no_reason_revoke.status_code})"
    )


# ==============================================================================
# SEC-10-3-06: Database Integrity on Duplicate Role Assignment
# ==============================================================================

def test_duplicate_role_assignment_returns_clean_409_conflict(client: TestClient, db_session: Session):
    """VULNERABILITY REPRODUCTION (SEC-10-3-06):
    Assigning a role that the user already actively holds must return HTTP 409 Conflict,
    gracefully handling database IntegrityError rather than raising HTTP 500.
    """
    admin, admin_token = create_test_user_with_role(db_session, role_name=SystemRoles.ADMIN)
    target_user, _ = create_test_user_with_role(db_session, role_name=None)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # First assignment
    res1 = client.post(
        f"/api/v1/auth/users/{target_user.id}/roles",
        json={"role_name": "supervisor", "reason": "Initial promotion"},
        headers=admin_headers,
    )
    assert res1.status_code == 201

    # Duplicate assignment
    res2 = client.post(
        f"/api/v1/auth/users/{target_user.id}/roles",
        json={"role_name": "supervisor", "reason": "Duplicate promotion"},
        headers=admin_headers,
    )
    assert res2.status_code == 409
    assert "already has an active assignment" in res2.json()["detail"]


# ==============================================================================
# Verification Area D: Immediate Authorization Freshness after Revocation
# ==============================================================================

def test_revoked_role_immediately_fails_closed_with_same_token(client: TestClient, db_session: Session):
    """VERIFICATION (Area D):
    Verifies that when a role is revoked in the database:
    1. User's still-valid OIDC token is immediately denied with HTTP 403 on protected operations.
    2. No stale caching allows in-flight authorization bypass.
    """
    admin, admin_token = create_test_user_with_role(db_session, role_name=SystemRoles.ADMIN)
    user, user_token = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    user_headers = {"Authorization": f"Bearer {user_token}"}

    # User can create session while role is active
    res1 = client.post(
        "/api/v1/sessions",
        json={"name": "Before Revocation Session", "course_length_m": "1000.0000", "rides": []},
        headers=user_headers,
    )
    assert res1.status_code == 201

    # Admin revokes measurer role
    client.delete(
        f"/api/v1/auth/users/{user.id}/roles/measurer",
        params={"reason": "Revoked for security test"},
        headers=admin_headers,
    )

    # User immediately attempts to create another session with same token -> MUST FAIL (403)
    res2 = client.post(
        "/api/v1/sessions",
        json={"name": "After Revocation Session", "course_length_m": "1000.0000", "rides": []},
        headers=user_headers,
    )
    assert res2.status_code == 403
    assert "missing required permission" in res2.json()["detail"]


# ==============================================================================
# Verification Area H: Direct PostgreSQL Database Integrity
# ==============================================================================

def test_postgresql_database_constraints_enforce_rbac_integrity():
    """VERIFICATION (Area H):
    Verifies that PostgreSQL database schema constraints directly prevent invalid RBAC states
    even if application ORM layer were bypassed.
    """
    with test_engine.begin() as conn:
        # 1. Unique constraint on roles.name
        with pytest.raises(Exception):
            conn.execute(
                text("INSERT INTO roles (id, name, is_system_role) VALUES (gen_random_uuid(), 'measurer', true);")
            )

        # 2. Foreign key constraint on user_roles.role_id
        with pytest.raises(Exception):
            conn.execute(
                text(
                    "INSERT INTO user_roles (id, user_id, role_id) "
                    "VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid());"
                )
            )
