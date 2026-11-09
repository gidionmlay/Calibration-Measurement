"""Comprehensive tests for OIDC Token Validation, User Identity Provisioning,
Authentication API Endpoints, and Audit Actor Attribution.

Covers Phase 10.3.1 requirements:
- Cryptographic token validation with RS256 RSA keys
- Fail-closed security against expired, forged, unsigned, or algorithm-confused tokens
- Provider-neutral user identity mapping on (issuer, subject)
- Atomic user provisioning and disabled account blocking
- Protected API routes enforcing Bearer authentication
- Authoritative audit ledger attribution using authenticated internal user UUID
"""

import time
import uuid
from decimal import Decimal
import pytest
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from sqlalchemy import select

from app.auth.oidc import (
    OIDCValidator,
    OIDCValidationError,
    TokenExpiredError,
    InvalidSignatureError,
    InvalidIssuerError,
    InvalidAudienceError,
    MissingClaimError,
    UnsupportedAlgorithmError,
    SigningKeyNotFoundError,
)
from app.auth.service import (
    IdentityService,
    UserAccountDisabledError,
    UserNotProvisionedError,
)
from app.core.config import settings
from app.models.user import User
from app.models.session import MeasurementSession
from app.models.audit import AuditEvent
from app.services.session_service import SessionService
from app.schemas.session import SessionCreateRequest
from tests.conftest import (
    TEST_RSA_KEY,
    TEST_RSA_PUB_KEY,
    TEST_KEY_ID,
    TEST_SECONDARY_RSA_KEY,
    TEST_SECONDARY_KEY_ID,
    make_test_jwt,
)


# ===========================================================================
# 1. Token Validation Tests
# ===========================================================================

def test_valid_signed_access_token_passes_validation():
    """Verify that a properly signed RS256 token passes cryptographic validation."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    token = make_test_jwt(
        sub="auth0|user-valid-123",
        email="user@test.org",
        name="Valid User",
    )
    payload = validator.validate_token(token)
    assert payload.sub == "auth0|user-valid-123"
    assert payload.iss == settings.OIDC_ISSUER_URL
    assert payload.email == "user@test.org"
    assert payload.email_verified is True
    assert payload.name == "Valid User"


def test_expired_token_is_rejected():
    """Verify that a token whose exp claim is in the past is rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    expired_token = make_test_jwt(exp_offset=-100)  # Expired 100s ago
    with pytest.raises(TokenExpiredError, match="Token has expired"):
        validator.validate_token(expired_token)


def test_invalid_signature_is_rejected():
    """Verify that a token signed with an unknown or attacker private key is rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    attacker_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    forged_token = make_test_jwt(key=attacker_key)
    with pytest.raises(InvalidSignatureError, match="Signature verification failed"):
        validator.validate_token(forged_token)


def test_wrong_issuer_is_rejected():
    """Verify that a token with an untrusted or mismatched issuer is rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    rogue_token = make_test_jwt(iss="https://rogue-idp.attacker.org")
    with pytest.raises(InvalidIssuerError, match="Token issuer mismatch"):
        validator.validate_token(rogue_token)


def test_wrong_audience_is_rejected():
    """Verify that a token intended for another audience/API is rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    other_aud_token = make_test_jwt(aud="unrelated-foreign-api")
    with pytest.raises(InvalidAudienceError, match="Token audience mismatch"):
        validator.validate_token(other_aud_token)


def test_missing_subject_is_rejected():
    """Verify that a token missing a valid 'sub' claim is rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    token = make_test_jwt(sub="")
    with pytest.raises(MissingClaimError, match="Token subject.*cannot be empty"):
        validator.validate_token(token)


def test_unsupported_algorithm_none_rejected():
    """Verify that insecure algorithm 'none' is rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    now = int(time.time())
    payload = {
        "sub": "user1",
        "iss": settings.OIDC_ISSUER_URL,
        "aud": settings.OIDC_AUDIENCE,
        "exp": now + 3600,
    }
    # Insecure 'none' algorithm token
    none_token = jwt.encode(payload, key="", algorithm="none")
    with pytest.raises(UnsupportedAlgorithmError, match="Algorithm 'none' is strictly prohibited"):
        validator.validate_token(none_token)


def test_symmetric_algorithm_hs256_rejected():
    """Verify that symmetric algorithm HS256 is strictly rejected (algorithm confusion defense)."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    now = int(time.time())
    payload = {
        "sub": "user1",
        "iss": settings.OIDC_ISSUER_URL,
        "aud": settings.OIDC_AUDIENCE,
        "exp": now + 3600,
    }
    hs256_token = jwt.encode(payload, key="a-super-secret-key-that-is-at-least-32-bytes-long", algorithm="HS256")
    with pytest.raises(UnsupportedAlgorithmError, match="is not in allowed algorithms"):
        validator.validate_token(hs256_token)


def test_invalid_nbf_not_yet_valid_rejected():
    """Verify that a token with future nbf (not before) is rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    future_nbf_token = make_test_jwt(nbf_offset=5000)  # Valid 5000s in the future
    with pytest.raises(OIDCValidationError, match="not yet valid"):
        validator.validate_token(future_nbf_token)


def test_unknown_kid_rejected():
    """Verify that a token specifying an unconfigured kid is rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    unknown_kid_token = make_test_jwt(kid="completely-unknown-kid-xyz")
    with pytest.raises(SigningKeyNotFoundError, match="not found"):
        validator.validate_token(unknown_kid_token)


def test_signing_key_rotation_support():
    """Verify that registering a rotated key allows immediate validation of tokens signed with it."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    # Token signed with rotated secondary key fails initially
    rotated_token = make_test_jwt(
        kid=TEST_SECONDARY_KEY_ID,
        key=TEST_SECONDARY_RSA_KEY,
    )
    with pytest.raises(SigningKeyNotFoundError):
        validator.validate_token(rotated_token)

    # Rotate / add new public key to validator
    validator.set_static_key(TEST_SECONDARY_KEY_ID, TEST_SECONDARY_RSA_KEY.public_key())

    # Token now validates successfully
    payload = validator.validate_token(rotated_token)
    assert payload.sub == "auth0|measurer-test-01"


def test_malformed_token_rejected():
    """Verify that malformed or gibberish token strings are rejected."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    for bad_token in ["not.a.jwt", "eyJhbGciOiJSUzI1NiJ9", "", "...", "Bearer xyz"]:
        with pytest.raises(OIDCValidationError):
            validator.validate_token(bad_token)


# ===========================================================================
# 2. User Identity Model & Provisioning Tests
# ===========================================================================

def test_first_time_user_provisioning(db_session: Session):
    """Verify that a valid token from a new user automatically provisions an active User."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    token = make_test_jwt(
        sub="auth0|new-user-001",
        email="newuser@example.com",
        name="New Measurer",
    )
    claims = validator.validate_token(token)

    user = IdentityService.resolve_or_provision_user(db_session, claims)
    assert user is not None
    assert isinstance(user.id, uuid.UUID)
    assert user.subject == "auth0|new-user-001"
    assert user.issuer == settings.OIDC_ISSUER_URL
    assert user.email == "newuser@example.com"
    assert user.display_name == "New Measurer"
    assert user.status == "active"
    assert user.last_authenticated_at is not None


def test_existing_user_resolution_and_profile_sync(db_session: Session):
    """Verify that returning users are resolved without duplicate creation and profile updates sync."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    # First login
    token_1 = make_test_jwt(sub="auth0|returning-user", name="Initial Name", email="init@example.com")
    u1 = IdentityService.resolve_or_provision_user(db_session, validator.validate_token(token_1))
    u1_id = u1.id

    # Second login with updated name in IdP
    token_2 = make_test_jwt(sub="auth0|returning-user", name="Updated Name", email="init@example.com")
    u2 = IdentityService.resolve_or_provision_user(db_session, validator.validate_token(token_2))

    # Same entity ID preserved
    assert u2.id == u1_id
    assert u2.display_name == "Updated Name"


def test_same_subject_under_different_issuers_creates_distinct_identities(db_session: Session):
    """Verify that sub collision across two distinct issuers produces two separate application users."""
    issuer_a = "https://idp-a.org"
    issuer_b = "https://idp-b.org"

    validator_a = OIDCValidator(issuer_url=issuer_a, static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    validator_b = OIDCValidator(issuer_url=issuer_b, static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})

    token_a = make_test_jwt(sub="user-shared-sub", iss=issuer_a)
    token_b = make_test_jwt(sub="user-shared-sub", iss=issuer_b)

    u_a = IdentityService.resolve_or_provision_user(db_session, validator_a.validate_token(token_a))
    u_b = IdentityService.resolve_or_provision_user(db_session, validator_b.validate_token(token_b))

    assert u_a.id != u_b.id
    assert u_a.issuer == issuer_a
    assert u_b.issuer == issuer_b
    assert u_a.subject == u_b.subject


def test_disabled_user_account_rejected(db_session: Session):
    """Verify that a user whose account is disabled cannot authenticate even with a valid IdP token."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    token = make_test_jwt(sub="auth0|disabled-target-user")
    claims = validator.validate_token(token)

    # Provision user and disable account
    user = IdentityService.resolve_or_provision_user(db_session, claims)
    user.status = "disabled"
    db_session.commit()

    # Subsequent authentication attempt must fail closed
    with pytest.raises(UserAccountDisabledError):
        IdentityService.resolve_or_provision_user(db_session, claims)


def test_missing_optional_profile_claims_handled_gracefully(db_session: Session):
    """Verify that tokens missing optional name or email claims provision cleanly."""
    validator = OIDCValidator(static_keys={TEST_KEY_ID: TEST_RSA_PUB_KEY})
    token = make_test_jwt(sub="auth0|minimal-user", email=None, name=None)
    claims = validator.validate_token(token)

    user = IdentityService.resolve_or_provision_user(db_session, claims)
    assert user.subject == "auth0|minimal-user"
    assert user.display_name is None
    assert user.email is None
    assert user.status == "active"


# ===========================================================================
# 3. Authentication API Endpoint Tests
# ===========================================================================

def test_auth_me_with_valid_bearer_token(auth_client: TestClient):
    """Verify GET /api/v1/auth/me returns the authenticated user's safe profile."""
    res = auth_client.get("/api/v1/auth/me")
    assert res.status_code == 200
    data = res.json()
    assert "id" in data
    assert data["subject"] == "auth0|measurer-test-01"
    assert data["issuer"] == settings.OIDC_ISSUER_URL
    assert data["email"] == "measurer@example.com"
    assert data["status"] == "active"
    # Never return secrets or tokens
    assert "access_token" not in data
    assert "client_secret" not in data


def test_auth_me_without_token_returns_401(client: TestClient):
    """Verify GET /api/v1/auth/me without an Authorization header returns 401 Problem Details."""
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401
    assert "Bearer" in res.headers.get("WWW-Authenticate", "")
    assert res.headers["content-type"] == "application/problem+json"
    problem = res.json()
    assert problem["status"] == 401
    assert "Authentication required" in problem["detail"]


def test_auth_me_with_invalid_token_returns_401(client: TestClient):
    """Verify GET /api/v1/auth/me with an invalid token returns 401."""
    res = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer invalid.garbage.jwt"})
    assert res.status_code == 401
    assert "invalid_token" in res.headers.get("WWW-Authenticate", "")


def test_auth_status_public_endpoint_without_secrets(client: TestClient):
    """Verify GET /api/v1/auth/status returns public configuration without disclosing secrets."""
    res = client.get("/api/v1/auth/status")
    assert res.status_code == 200
    data = res.json()
    assert data["environment"] == settings.ENVIRONMENT
    assert data["oidc_issuer"] == settings.OIDC_ISSUER_URL
    assert data["oidc_audience"] == settings.OIDC_AUDIENCE
    assert "RS256" in data["allowed_algorithms"]
    assert data["is_provisional"] is True
    assert "PROVISIONAL" in data["policy_notice"]


def test_protected_session_creation_without_token_returns_401(client: TestClient):
    """Verify POST /api/v1/sessions rejects unauthenticated requests with HTTP 401."""
    payload = {
        "name": "Unauthenticated Session",
        "course_length_m": "1000.0000",
        "rides": [],
    }
    res = client.post("/api/v1/sessions", json=payload)
    assert res.status_code == 401
    assert res.headers["content-type"] == "application/problem+json"


def test_protected_session_creation_with_valid_token_succeeds(auth_client: TestClient):
    """Verify POST /api/v1/sessions succeeds when presented with a valid Bearer token."""
    payload = {
        "name": "Authenticated Session",
        "course_length_m": "1000.0000",
        "rides": [],
    }
    res = auth_client.post("/api/v1/sessions", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["name"] == "Authenticated Session"
    assert data["version"] == 1


# ===========================================================================
# 4. Audit Identity Integration & Spoofing Defense Tests
# ===========================================================================

def test_authenticated_operations_record_internal_user_uuid_in_audit_ledger(
    auth_client: TestClient, db_session: Session
):
    """Verify that session creation and updates record the authenticated user's internal UUID in audit events."""
    # 1. Fetch user profile to get internal UUID
    me_res = auth_client.get("/api/v1/auth/me")
    assert me_res.status_code == 200
    internal_user_id = me_res.json()["id"]

    # 2. Create session
    create_res = auth_client.post(
        "/api/v1/sessions",
        json={"name": "Audit Identity Session", "course_length_m": "1000.0000", "rides": []},
    )
    assert create_res.status_code == 201
    session_id = create_res.json()["id"]

    # 3. Check audit trail
    audit_res = auth_client.get(f"/api/v1/sessions/{session_id}/audit-trail")
    assert audit_res.status_code == 200
    events = audit_res.json()
    assert len(events) == 1
    genesis_event = events[0]

    # Critical requirement: actor_id is the internal User UUID, not a client-supplied string!
    assert genesis_event["actor_id"] == internal_user_id
    assert genesis_event["event_type"] == "SESSION_CREATED"

    # Verify audit ledger passes cryptographic verification
    verify_res = auth_client.post(f"/api/v1/sessions/{session_id}/verify-audit")
    assert verify_res.status_code == 200
    assert verify_res.json()["is_valid"] is True


def test_client_supplied_actor_id_cannot_spoof_audit_identity(
    auth_client: TestClient, db_session: Session
):
    """Verify that an attacker attempting to send X-Actor-ID or spoofed actor headers
    is ignored, and the audit ledger strictly records the authenticated internal UUID.
    """
    me_res = auth_client.get("/api/v1/auth/me")
    internal_user_id = me_res.json()["id"]

    # Attempt to spoof actor as an official authority or administrator
    spoof_headers = {
        "X-Actor-ID": "admin:super-privileged-spoof",
        "X-User-ID": "spoofed-user-id",
    }
    create_res = auth_client.post(
        "/api/v1/sessions",
        json={"name": "Spoof Defense Session", "course_length_m": "1000.0000", "rides": []},
        headers=spoof_headers,
    )
    assert create_res.status_code == 201
    session_id = create_res.json()["id"]

    # Verify audit event records authenticated internal UUID, NOT the spoofed header
    audit_res = auth_client.get(f"/api/v1/sessions/{session_id}/audit-trail")
    events = audit_res.json()
    assert events[0]["actor_id"] == internal_user_id
    assert events[0]["actor_id"] != "admin:super-privileged-spoof"


def test_historical_provisional_audit_events_remain_verifiable(db_session: Session):
    """Verify that historical audit events using provisional actor identifiers (e.g. provisional:measurer)
    remain completely verifiable under the updated audit hash chain.
    """
    from app.audit.verifier import verify_audit_ledger
    from app.audit.canonical import compute_audit_event_hash, GENESIS_HASH
    from datetime import datetime, timezone

    session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
    ev_id = uuid.uuid4()

    # Historical event with provisional:measurer string
    hist_hash = compute_audit_event_hash(
        previous_event_hash=GENESIS_HASH,
        event_id=ev_id,
        session_id=session_id,
        sequence_num=1,
        timestamp=now,
        actor_id="provisional:measurer",
        event_type="SESSION_CREATED",
        payload={"legacy": True},
        event_summary="Historical provisional creation",
    )
    hist_event = AuditEvent(
        id=ev_id,
        session_id=session_id,
        sequence_num=1,
        event_type="SESSION_CREATED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Historical provisional creation",
        payload={"legacy": True},
        previous_event_hash=GENESIS_HASH,
        event_hash=hist_hash,
    )

    result = verify_audit_ledger([hist_event], expected_session_id=session_id)
    assert result.is_valid is True
    assert result.total_events == 1
    assert result.verified_events == 1
