"""Comprehensive unit and integration tests for local email/password authentication."""

import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_local_token,
)
from app.models.user import User
from app.main import app

client = TestClient(app)


class TestPasswordSecurity:
    """Tests for password hashing and constant-time verification."""

    def test_hash_and_verify_success(self):
        pwd = "SecureFieldPassword123!"
        hashed = hash_password(pwd)
        assert hashed.startswith("scrypt$")
        assert verify_password(pwd, hashed) is True

    def test_verify_wrong_password_fails(self):
        pwd = "CorrectPassword123!"
        hashed = hash_password(pwd)
        assert verify_password("WrongPassword999!", hashed) is False

    def test_verify_corrupted_hash_fails_safely(self):
        assert verify_password("password", "invalid-hash-format") is False
        assert verify_password("password", "") is False

    def test_short_password_rejected(self):
        with pytest.raises(ValueError, match="at least 8 characters"):
            hash_password("short")


class TestLocalAuthEndpoints:
    """Integration tests for registration, login, token refresh, and protected route access."""

    def test_register_measurer_success(self, db_session: Session):
        test_email = f"measurer_{uuid.uuid4().hex[:8]}@athletics.org"
        payload = {
            "email": test_email,
            "password": "StrongPassword2026!",
            "display_name": "Autonomous Measurer Jane",
            "organization": "World Athletics Grade A",
        }

        resp = client.post("/api/v1/auth/register", json=payload)
        assert resp.status_code == 201, resp.text
        data = resp.json()

        assert "access_token" in data
        assert "refresh_token" in data
        assert data["token_type"] == "Bearer"
        assert data["expires_in"] > 0

        user = data["user"]
        assert user["email"] == test_email.lower()
        assert user["display_name"] == "Autonomous Measurer Jane"
        assert user["organization"] == "World Athletics Grade A"
        assert user["email_verified"] is True
        assert user["status"] == "active"
        assert "measurer" in user["roles"]
        assert "session:create" in user["permissions"]

        # Verify access to /auth/me with the issued token
        headers = {"Authorization": f"Bearer {data['access_token']}"}
        me_resp = client.get("/api/v1/auth/me", headers=headers)
        assert me_resp.status_code == 200
        me_data = me_resp.json()
        assert me_data["id"] == user["id"]
        assert me_data["display_name"] == "Autonomous Measurer Jane"

    def test_register_duplicate_email_conflict(self, db_session: Session):
        test_email = f"duplicate_{uuid.uuid4().hex[:8]}@aims.org"
        payload = {
            "email": test_email,
            "password": "StrongPassword2026!",
            "display_name": "First Measurer",
            "organization": "AIMS",
        }
        resp1 = client.post("/api/v1/auth/register", json=payload)
        assert resp1.status_code == 201

        # Attempt to register with the exact same email (different case)
        payload["email"] = test_email.upper()
        resp2 = client.post("/api/v1/auth/register", json=payload)
        assert resp2.status_code == 409
        assert "already exists" in resp2.json()["detail"]

    def test_register_validation_errors(self):
        # Invalid email
        resp = client.post("/api/v1/auth/register", json={
            "email": "not-an-email",
            "password": "validPassword123",
            "display_name": "Test",
        })
        assert resp.status_code == 422

        # Password too short (< 8 chars)
        resp2 = client.post("/api/v1/auth/register", json={
            "email": "valid@example.com",
            "password": "short",
            "display_name": "Test",
        })
        assert resp2.status_code == 422

    def test_login_success(self, db_session: Session):
        test_email = f"login_user_{uuid.uuid4().hex[:8]}@federation.org"
        password = "FieldMeasurerPassword#1"
        reg_payload = {
            "email": test_email,
            "password": password,
            "display_name": "Login Test User",
            "organization": "National Athletics Federation",
        }
        reg_resp = client.post("/api/v1/auth/register", json=reg_payload)
        assert reg_resp.status_code == 201

        # Login with valid credentials
        login_resp = client.post("/api/v1/auth/login", json={
            "email": test_email.upper(),  # case-insensitive email check
            "password": password,
        })
        assert login_resp.status_code == 200
        data = login_resp.json()
        assert "access_token" in data
        assert data["user"]["display_name"] == "Login Test User"

    def test_login_invalid_password(self, db_session: Session):
        test_email = f"user_{uuid.uuid4().hex[:8]}@federation.org"
        reg_payload = {
            "email": test_email,
            "password": "CorrectPassword123!",
            "display_name": "Measurer",
        }
        client.post("/api/v1/auth/register", json=reg_payload)

        # Wrong password
        resp = client.post("/api/v1/auth/login", json={
            "email": test_email,
            "password": "WrongPassword999!",
        })
        assert resp.status_code == 401
        assert "Invalid email or password" in resp.json()["detail"]

    def test_login_nonexistent_email(self):
        resp = client.post("/api/v1/auth/login", json={
            "email": "ghost@doesnotexist.org",
            "password": "SomePassword123!",
        })
        assert resp.status_code == 401
        assert "Invalid email or password" in resp.json()["detail"]

    def test_refresh_token_lifecycle(self, db_session: Session):
        test_email = f"refresh_{uuid.uuid4().hex[:8]}@field.org"
        reg_resp = client.post("/api/v1/auth/register", json={
            "email": test_email,
            "password": "PasswordForRefresh123!",
            "display_name": "Refresh Operator",
        })
        assert reg_resp.status_code == 201
        refresh_token = reg_resp.json()["refresh_token"]

        # Exchange refresh token for fresh access token
        ref_resp = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})
        assert ref_resp.status_code == 200
        ref_data = ref_resp.json()
        assert "access_token" in ref_data
        assert ref_data["token_type"] == "Bearer"

        # Test the newly issued access token against /auth/me
        headers = {"Authorization": f"Bearer {ref_data['access_token']}"}
        me_resp = client.get("/api/v1/auth/me", headers=headers)
        assert me_resp.status_code == 200
        assert me_resp.json()["email"] == test_email.lower()

