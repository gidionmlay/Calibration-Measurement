"""Tests for backend/scripts/create_admin.py account seeding tool."""

import pytest
from sqlalchemy.orm import Session

from app.auth.rbac import SystemRoles
from app.auth.security import verify_password
from app.models.rbac import Role, UserRole
from app.models.user import User
from scripts.create_admin import seed_admin_user, validate_email, validate_password, parse_args


def test_validate_email():
    assert validate_email("Admin@Test.COM") == "admin@test.com"
    with pytest.raises(ValueError, match="Invalid email address format"):
        validate_email("not-an-email")
    with pytest.raises(ValueError, match="Invalid email address format"):
        validate_email("")


def test_validate_password():
    assert validate_password("SuperSecret123") == "SuperSecret123"
    with pytest.raises(ValueError, match="at least 8 characters"):
        validate_password("short")
    with pytest.raises(ValueError, match="at least 8 characters"):
        validate_password("")


def test_seed_admin_user_success(db_session: Session):
    admin_user = seed_admin_user(
        db=db_session,
        email="sysadmin@example.org",
        password="AdminSecurePassword2026!",
        name="Chief Administrator",
        role_name=SystemRoles.ADMIN,
        organization="World Athletics Operations",
    )

    assert admin_user.id is not None
    assert admin_user.email == "sysadmin@example.org"
    assert admin_user.display_name == "Chief Administrator"
    assert admin_user.organization == "World Athletics Operations"
    assert admin_user.issuer == "local"
    assert admin_user.status == "active"
    assert admin_user.password_hash is not None
    assert verify_password("AdminSecurePassword2026!", admin_user.password_hash)

    # Check role assignment
    active_roles = (
        db_session.query(UserRole)
        .filter(UserRole.user_id == admin_user.id, UserRole.revoked_at.is_(None))
        .all()
    )
    assert len(active_roles) == 1
    assert active_roles[0].role.name == "admin"


def test_seed_admin_user_idempotent(db_session: Session):
    # First creation
    u1 = seed_admin_user(
        db=db_session,
        email="idempotent@example.org",
        password="FirstPassword123!",
        name="Original Name",
        role_name="admin",
    )

    # Second call without update
    u2 = seed_admin_user(
        db=db_session,
        email="idempotent@example.org",
        password="NewIgnoredPassword!",
        name="Ignored Name",
        role_name="admin",
        update=False,
    )

    assert u1.id == u2.id
    assert u2.display_name == "Original Name"
    assert verify_password("FirstPassword123!", u2.password_hash)

    # Third call WITH update
    u3 = seed_admin_user(
        db=db_session,
        email="idempotent@example.org",
        password="UpdatedPassword123!",
        name="Updated Name",
        role_name="admin",
        organization="Updated Org",
        update=True,
    )

    assert u3.id == u1.id
    assert u3.display_name == "Updated Name"
    assert u3.organization == "Updated Org"
    assert verify_password("UpdatedPassword123!", u3.password_hash)


def test_seed_admin_user_elevate_role(db_session: Session):
    # Create as measurer first
    measurer = seed_admin_user(
        db=db_session,
        email="measurer.to.admin@example.org",
        password="SafePassword123!",
        name="Evolving Operator",
        role_name="measurer",
    )

    # Re-run with admin role (elevation)
    admin = seed_admin_user(
        db=db_session,
        email="measurer.to.admin@example.org",
        role_name="admin",
        update=False,
    )

    assert measurer.id == admin.id
    # Should now have both active roles
    roles = (
        db_session.query(UserRole)
        .filter(UserRole.user_id == admin.id, UserRole.revoked_at.is_(None))
        .all()
    )
    role_names = {r.role.name for r in roles}
    assert "measurer" in role_names
    assert "admin" in role_names


def test_seed_admin_user_invalid_role(db_session: Session):
    with pytest.raises(ValueError, match="Role 'nonexistent_role' does not exist"):
        seed_admin_user(
            db=db_session,
            email="invalidrole@example.org",
            password="SafePassword123!",
            role_name="nonexistent_role",
        )


def test_parse_args():
    args = parse_args([
        "--email", "cli.admin@test.com",
        "--password", "CliPassword123!",
        "--name", "CLI Admin",
        "--role", "supervisor",
        "--organization", "Fed X",
        "--update",
        "--non-interactive",
    ])
    assert args.email == "cli.admin@test.com"
    assert args.password == "CliPassword123!"
    assert args.name == "CLI Admin"
    assert args.role == "supervisor"
    assert args.organization == "Fed X"
    assert args.update is True
    assert args.non_interactive is True


def test_seeded_admin_login_and_overview_access(db_session: Session, client):
    """Verifies that an admin user created via CLI can log in and access protected admin endpoints."""
    seed_admin_user(
        db=db_session,
        email="seeded.admin@ops.local",
        password="ProductionPassword2026!",
        name="Seeded Admin",
        role_name="admin",
        organization="Platform Ops",
    )

    # 1. Login via auth endpoint
    login_resp = client.post(
        "/api/v1/auth/login",
        json={"email": "seeded.admin@ops.local", "password": "ProductionPassword2026!"},
    )
    assert login_resp.status_code == 200
    token_data = login_resp.json()
    assert "access_token" in token_data
    access_token = token_data["access_token"]
    assert "admin" in token_data["user"]["roles"]

    # 2. Access Admin Overview endpoint with the bearer token
    overview_resp = client.get(
        "/api/v1/admin/overview",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert overview_resp.status_code == 200
    overview_data = overview_resp.json()
    assert "total_users" in overview_data
    assert "total_sessions" in overview_data
    assert "monthly_activity" in overview_data

