"""Comprehensive tests for Role-Based Access Control (RBAC), permission enforcement,
separation of duties, workflow state immutability, and role administration.
"""

import uuid
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.rbac import Role, Permission, UserRole
from app.models.session import MeasurementSession
from app.models.user import User
from app.auth.rbac import SystemRoles, SystemPermissions, RBACService
from tests.conftest import create_test_user_with_role, make_test_jwt


def test_rbac_seeding_and_role_permission_mappings(db_session: Session):
    """Verify that all 5 system roles and 10 capability permissions are correctly seeded."""
    roles = db_session.query(Role).all()
    role_names = {r.name for r in roles}
    assert role_names == {"measurer", "reviewer", "supervisor", "auditor", "admin"}

    permissions = db_session.query(Permission).all()
    perm_codes = {p.code for p in permissions}
    expected_perms = {
        "session:create",
        "session:read",
        "session:update_draft",
        "session:submit_review",
        "review:create",
        "review:decide",
        "audit:read",
        "audit:verify",
        "role:manage",
        "config:manage",
    }
    assert perm_codes == expected_perms

    # Check auditor is strictly read-only
    auditor = next(r for r in roles if r.name == "auditor")
    auditor_perms = {p.code for p in auditor.permissions}
    assert auditor_perms == {"session:read", "audit:read", "audit:verify"}


def test_unassigned_user_has_zero_permissions_deny_by_default(client: TestClient, db_session: Session):
    """Verify deny-by-default: a user with no assigned roles is rejected from protected operations."""
    user, token = create_test_user_with_role(db_session, role_name=None)
    headers = {"Authorization": f"Bearer {token}"}

    # /auth/me returns empty roles and permissions
    res_me = client.get("/api/v1/auth/me", headers=headers)
    assert res_me.status_code == 200
    me_data = res_me.json()
    assert me_data["roles"] == []
    assert me_data["permissions"] == []

    # Attempt to create session -> 403 Forbidden
    res_create = client.post(
        "/api/v1/sessions",
        json={"name": "Unassigned Session", "course_length_m": "1000.0000", "rides": []},
        headers=headers,
    )
    assert res_create.status_code == 403
    assert "missing required permission" in res_create.json()["detail"]


def test_measurer_role_permissions_and_boundaries(client: TestClient, db_session: Session):
    """Verify Measurer role permissions:
    - Can create sessions
    - Can read sessions
    - Can update draft sessions they measured
    - Can submit sessions for review
    - CANNOT decide reviews (403)
    - CANNOT verify audit (403)
    - CANNOT manage roles (403)
    """
    measurer, measurer_token = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    m_headers = {"Authorization": f"Bearer {measurer_token}"}

    # 1. Can create session
    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "Measurer Draft", "course_length_m": "1000.0000", "rides": []},
        headers=m_headers,
    )
    assert create_res.status_code == 201
    session_id = create_res.json()["id"]
    assert create_res.json()["measurer_id"] == str(measurer.id)

    # 2. Can read session
    get_res = client.get(f"/api/v1/sessions/{session_id}", headers=m_headers)
    assert get_res.status_code == 200

    # 3. Can update draft session they measured
    update_res = client.put(
        f"/api/v1/sessions/{session_id}",
        json={"expected_version": 1, "description": "Updated by measurer"},
        headers=m_headers,
    )
    assert update_res.status_code == 200
    assert update_res.json()["description"] == "Updated by measurer"

    # 4. CANNOT decide reviews
    review_res = client.post(
        f"/api/v1/sessions/{session_id}/reviews",
        json={"expected_version": 2, "status": "approved", "comments": "Self approval attempt"},
        headers=m_headers,
    )
    assert review_res.status_code == 403
    assert "review:decide" in review_res.json()["detail"]

    # 5. CANNOT verify audit
    verify_res = client.post(f"/api/v1/sessions/{session_id}/verify-audit", headers=m_headers)
    assert verify_res.status_code == 403
    assert "audit:verify" in verify_res.json()["detail"]

    # 6. CANNOT manage roles
    role_res = client.post(
        f"/api/v1/auth/users/{measurer.id}/roles",
        json={"role_name": "admin"},
        headers=m_headers,
    )
    assert role_res.status_code == 403
    assert "role:manage" in role_res.json()["detail"]


def test_measurer_cannot_modify_another_measurers_session(client: TestClient, db_session: Session):
    """Verify session-level access control: Measurer A cannot modify Measurer B's session."""
    measurer_a, token_a = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    measurer_b, token_b = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)

    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # Measurer A creates session
    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "Measurer A Session", "course_length_m": "1000.0000", "rides": []},
        headers=headers_a,
    )
    session_id = create_res.json()["id"]

    # Measurer B attempts to update Measurer A's session -> 403 Forbidden
    update_res = client.put(
        f"/api/v1/sessions/{session_id}",
        json={"expected_version": 1, "description": "Tamper by Measurer B"},
        headers=headers_b,
    )
    assert update_res.status_code == 403
    assert "not authorized to modify another measurer's session" in update_res.json()["detail"]


def test_strict_separation_of_duties_prevents_self_review(client: TestClient, db_session: Session):
    """Verify separation of duties invariant:
    A user who measured a session CANNOT review it, even if they have reviewer/supervisor/admin role.
    """
    # User has both measurer and supervisor roles
    user, token = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    admin_user, admin_token = create_test_user_with_role(db_session, role_name=SystemRoles.ADMIN)
    headers = {"Authorization": f"Bearer {token}"}
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Grant user supervisor role as well
    client.post(
        f"/api/v1/auth/users/{user.id}/roles",
        json={"role_name": "supervisor", "reason": "Dual role test"},
        headers=admin_headers,
    )

    # User creates session (so session.measurer_id == user.id)
    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "Self-Measurement Session", "course_length_m": "1000.0000", "rides": []},
        headers=headers,
    )
    session_id = create_res.json()["id"]

    # User submits for review
    client.post(f"/api/v1/sessions/{session_id}/submit", headers=headers)

    # User attempts to record review decision on their own session -> 403 SEPARATION_OF_DUTIES_VIOLATION
    review_res = client.post(
        f"/api/v1/sessions/{session_id}/reviews",
        json={"expected_version": 2, "status": "approved", "comments": "Self-review attempt"},
        headers=headers,
    )
    assert review_res.status_code == 403
    assert "SEPARATION_OF_DUTIES_VIOLATION" in review_res.json()["detail"]


def test_independent_reviewer_can_review_and_approve_session(client: TestClient, db_session: Session):
    """Verify independent reviewer workflow:
    - Measurer creates and submits session.
    - Distinct Reviewer reviews and approves session.
    """
    measurer, m_token = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    reviewer, r_token = create_test_user_with_role(db_session, role_name=SystemRoles.REVIEWER)

    m_headers = {"Authorization": f"Bearer {m_token}"}
    r_headers = {"Authorization": f"Bearer {r_token}"}

    # 1. Measurer creates session
    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "Measurer Course", "course_length_m": "1000.0000", "rides": []},
        headers=m_headers,
    )
    session_id = create_res.json()["id"]

    # 2. Measurer submits session
    submit_res = client.post(f"/api/v1/sessions/{session_id}/submit", headers=m_headers)
    assert submit_res.status_code == 200
    assert submit_res.json()["status"] == "needs_review"

    # 3. Independent Reviewer approves session
    review_res = client.post(
        f"/api/v1/sessions/{session_id}/reviews",
        json={"expected_version": 2, "status": "approved", "comments": "Calculations verified against manual check."},
        headers=r_headers,
    )
    assert review_res.status_code == 201
    assert review_res.json()["status"] == "approved"
    assert review_res.json()["reviewer_id"] == str(reviewer.id)

    # 4. Session status updated to approved
    get_res = client.get(f"/api/v1/sessions/{session_id}", headers=r_headers)
    assert get_res.json()["status"] == "approved"


def test_workflow_state_immutability(client: TestClient, db_session: Session):
    """Verify workflow state constraints:
    - Submitted session cannot be modified directly (409 Conflict).
    - Approved/finalized session is strictly immutable (409 Conflict).
    """
    measurer, m_token = create_test_user_with_role(db_session, role_name=SystemRoles.MEASURER)
    reviewer, r_token = create_test_user_with_role(db_session, role_name=SystemRoles.REVIEWER)
    m_headers = {"Authorization": f"Bearer {m_token}"}
    r_headers = {"Authorization": f"Bearer {r_token}"}

    # Create session
    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "Immutability Session", "course_length_m": "1000.0000", "rides": []},
        headers=m_headers,
    )
    session_id = create_res.json()["id"]

    # Submit session -> status becomes 'needs_review'
    client.post(f"/api/v1/sessions/{session_id}/submit", headers=m_headers)

    # Attempt to modify while in review -> 409 Conflict
    update_submitted_res = client.put(
        f"/api/v1/sessions/{session_id}",
        json={"expected_version": 2, "description": "Edit during review"},
        headers=m_headers,
    )
    assert update_submitted_res.status_code == 409
    assert "submitted for review" in update_submitted_res.json()["detail"]

    # Reviewer approves session -> status becomes 'approved'
    client.post(
        f"/api/v1/sessions/{session_id}/reviews",
        json={"expected_version": 2, "status": "approved", "comments": "Approved"},
        headers=r_headers,
    )

    # Attempt to modify finalized session -> 409 Conflict
    update_finalized_res = client.put(
        f"/api/v1/sessions/{session_id}",
        json={"expected_version": 3, "description": "Edit after finalization"},
        headers=m_headers,
    )
    assert update_finalized_res.status_code == 409
    assert "strictly immutable" in update_finalized_res.json()["detail"]


def test_auditor_strictly_read_only(client: TestClient, db_session: Session):
    """Verify Auditor role:
    - Can read sessions
    - Can read audit trails
    - Can verify audit trails
    - CANNOT create sessions (403)
    - CANNOT update sessions (403)
    - CANNOT submit reviews (403)
    - CANNOT decide reviews (403)
    """
    admin, admin_token = create_test_user_with_role(db_session, role_name=SystemRoles.ADMIN)
    auditor, auditor_token = create_test_user_with_role(db_session, role_name=SystemRoles.AUDITOR)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    auditor_headers = {"Authorization": f"Bearer {auditor_token}"}

    # Admin creates session
    create_res = client.post(
        "/api/v1/sessions",
        json={"name": "Auditor Test Session", "course_length_m": "1000.0000", "rides": []},
        headers=admin_headers,
    )
    session_id = create_res.json()["id"]

    # Auditor reads session -> 200 OK
    get_res = client.get(f"/api/v1/sessions/{session_id}", headers=auditor_headers)
    assert get_res.status_code == 200

    # Auditor reads audit trail -> 200 OK
    trail_res = client.get(f"/api/v1/sessions/{session_id}/audit-trail", headers=auditor_headers)
    assert trail_res.status_code == 200
    assert len(trail_res.json()) >= 1

    # Auditor verifies audit trail -> 200 OK
    verify_res = client.post(f"/api/v1/sessions/{session_id}/verify-audit", headers=auditor_headers)
    assert verify_res.status_code == 200
    assert verify_res.json()["is_valid"] is True

    # Auditor cannot create session -> 403
    fail_create = client.post(
        "/api/v1/sessions",
        json={"name": "Auditor Create Attempt", "course_length_m": "1000.0000", "rides": []},
        headers=auditor_headers,
    )
    assert fail_create.status_code == 403

    # Auditor cannot update session -> 403
    fail_update = client.put(
        f"/api/v1/sessions/{session_id}",
        json={"expected_version": 1, "description": "Auditor Edit Attempt"},
        headers=auditor_headers,
    )
    assert fail_update.status_code == 403


def test_administrative_role_assignment_and_revocation_lifecycle(client: TestClient, db_session: Session):
    """Verify Admin role management lifecycle:
    - Admin lists system roles.
    - Admin assigns role with reason.
    - Duplicate assignment rejected (409 Conflict).
    - Non-admin cannot assign roles (403 Forbidden).
    - Admin revokes role with reason.
    - Revoking nonexistent role returns 404 Not Found.
    - Full assignment history is maintained.
    """
    admin, admin_token = create_test_user_with_role(db_session, role_name=SystemRoles.ADMIN)
    target_user, target_token = create_test_user_with_role(db_session, role_name=None)
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    target_headers = {"Authorization": f"Bearer {target_token}"}

    # 1. List system roles
    roles_res = client.get("/api/v1/auth/roles", headers=admin_headers)
    assert roles_res.status_code == 200
    assert len(roles_res.json()) == 5

    # 2. Target user inspects their own roles (currently empty)
    my_roles = client.get(f"/api/v1/auth/users/{target_user.id}/roles", headers=target_headers)
    assert my_roles.status_code == 200
    assert len(my_roles.json()) == 0

    # 3. Non-admin attempts to assign role -> 403 Forbidden
    unauth_assign = client.post(
        f"/api/v1/auth/users/{target_user.id}/roles",
        json={"role_name": "measurer"},
        headers=target_headers,
    )
    assert unauth_assign.status_code == 403

    # 4. Admin assigns 'measurer' role with reason
    assign_res = client.post(
        f"/api/v1/auth/users/{target_user.id}/roles",
        json={"role_name": "measurer", "reason": "Certified field measurer"},
        headers=admin_headers,
    )
    assert assign_res.status_code == 201
    assign_data = assign_res.json()
    assert assign_data["role_name"] == "measurer"
    assert assign_data["is_active"] is True
    assert assign_data["assignment_reason"] == "Certified field measurer"

    # 5. Duplicate active assignment rejected with 409 Conflict
    dup_res = client.post(
        f"/api/v1/auth/users/{target_user.id}/roles",
        json={"role_name": "measurer", "reason": "Duplicate attempt"},
        headers=admin_headers,
    )
    assert dup_res.status_code == 409

    # 6. Admin revokes 'measurer' role with reason
    revoke_res = client.delete(
        f"/api/v1/auth/users/{target_user.id}/roles/measurer",
        params={"reason": "Certification expired"},
        headers=admin_headers,
    )
    assert revoke_res.status_code == 200
    revoke_data = revoke_res.json()
    assert revoke_data["is_active"] is False
    assert revoke_data["revoked_at"] is not None

    # 7. Revoking already-revoked or non-assigned role returns 404
    second_revoke = client.delete(
        f"/api/v1/auth/users/{target_user.id}/roles/measurer",
        params={"reason": "Repeated revocation attempt"},
        headers=admin_headers,
    )
    assert second_revoke.status_code == 404

    # 8. Check history contains the assignment record
    history_res = client.get(f"/api/v1/auth/users/{target_user.id}/roles", headers=admin_headers)
    assert history_res.status_code == 200
    history = history_res.json()
    assert len(history) == 1
    assert history[0]["is_active"] is False
