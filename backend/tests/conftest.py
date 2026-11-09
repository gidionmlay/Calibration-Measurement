"""Pytest configuration and test database fixtures."""

import os
import time
import uuid
import pytest
from typing import Generator, Dict, Any, Optional, Tuple
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import settings
from app.core.database import get_db
from app.models.base import Base
from app.models.user import User
from app.models.rbac import Role, UserRole
from app.auth.oidc import oidc_validator
from app.main import app

# Target dedicated test database
TEST_DB_URL = os.getenv("TEST_DATABASE_URL", settings.TEST_DATABASE_URL)

test_engine = create_engine(
    TEST_DB_URL,
    pool_pre_ping=True,
)

TestingSessionLocal = sessionmaker(
    bind=test_engine,
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
)

# Deterministic Session-Scoped RSA 2048-bit Key Pair for Testing
TEST_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
TEST_RSA_PUB_KEY = TEST_RSA_KEY.public_key()
TEST_KEY_ID = "test-key-2026-01"

# Secondary RSA key for key rotation / unknown key tests
TEST_SECONDARY_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
TEST_SECONDARY_KEY_ID = "test-key-secondary-2026"


@pytest.fixture(scope="session", autouse=True)
def setup_test_database():
    """Ensure all tables exist in test database prior to test execution."""
    Base.metadata.create_all(bind=test_engine)
    yield


@pytest.fixture(scope="session", autouse=True)
def configure_test_oidc_validator():
    """Register test RSA public key in the global OIDC validator."""
    oidc_validator.set_static_key(TEST_KEY_ID, TEST_RSA_PUB_KEY)
    yield
    oidc_validator.clear_static_keys()


def make_test_jwt(
    sub: str = "auth0|measurer-test-01",
    iss: str = settings.OIDC_ISSUER_URL,
    aud: str = settings.OIDC_AUDIENCE,
    exp_offset: int = 3600,
    nbf_offset: int = -10,
    email: str = "measurer@example.com",
    name: str = "Jane Measurer",
    kid: str = TEST_KEY_ID,
    key=TEST_RSA_KEY,
    algorithm: str = "RS256",
    extra_claims: Dict[str, Any] = None,
) -> str:
    """Helper to mint real, cryptographically valid or customized test JWTs."""
    now = int(time.time())
    payload: Dict[str, Any] = {
        "sub": sub,
        "iss": iss,
        "aud": aud,
        "exp": now + exp_offset,
        "nbf": now + nbf_offset,
        "iat": now,
        "email": email,
        "email_verified": True,
        "name": name,
    }
    if extra_claims:
        payload.update(extra_claims)
    headers = {"kid": kid} if kid else {}
    return jwt.encode(payload, key, algorithm=algorithm, headers=headers)


@pytest.fixture
def auth_headers() -> Dict[str, str]:
    """Returns valid Authorization Bearer headers for testing."""
    token = make_test_jwt()
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    """Provides an isolated database session that truncates test data after each test."""
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        # Clean up data between tests with trigger temporarily suspended for test fixture isolation
        with test_engine.begin() as conn:
            conn.execute(text("ALTER TABLE audit_events DISABLE TRIGGER ALL;"))
            conn.execute(
                text(
                    "TRUNCATE TABLE audit_events, session_overrides, session_reviews, "
                    "session_rides, sessions, user_roles, users CASCADE;"
                )
            )
            conn.execute(text("ALTER TABLE audit_events ENABLE TRIGGER ALL;"))
        session.close()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """TestClient fixture with get_db overridden to use test database session."""
    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def auth_client(client: TestClient, db_session: Session, auth_headers: Dict[str, str]) -> TestClient:
    """TestClient preconfigured with valid Bearer authentication headers and admin role for general test suites."""
    from app.models.user import User
    from app.models.rbac import Role, UserRole
    from app.core.config import settings

    admin_role = db_session.query(Role).filter(Role.name == "admin").first()
    user = (
        db_session.query(User)
        .filter(User.issuer == settings.OIDC_ISSUER_URL, User.subject == "auth0|measurer-test-01")
        .first()
    )
    if not user:
        user = User(
            issuer=settings.OIDC_ISSUER_URL,
            subject="auth0|measurer-test-01",
            email="measurer@example.com",
            display_name="Jane Measurer",
            status="active",
        )
        db_session.add(user)
        db_session.flush()

    if admin_role:
        existing = (
            db_session.query(UserRole)
            .filter(
                UserRole.user_id == user.id,
                UserRole.role_id == admin_role.id,
                UserRole.revoked_at.is_(None),
            )
            .first()
        )
        if not existing:
            assignment = UserRole(
                user_id=user.id,
                role_id=admin_role.id,
                assignment_reason="Default test client role",
            )
            db_session.add(assignment)
            db_session.commit()

    client.headers.update(auth_headers)
    return client


def create_test_user_with_role(
    db: Session,
    role_name: Optional[str] = None,
    sub: Optional[str] = None,
    email: Optional[str] = None,
    name: Optional[str] = None,
) -> Tuple[User, str]:
    """Helper to create a user with a specific role and generate their valid JWT."""
    from app.models.user import User
    from app.models.rbac import Role, UserRole
    from app.core.config import settings

    user_sub = sub or f"user-{uuid.uuid4()}"
    user_email = email or f"{user_sub}@example.com"
    user_name = name or f"Test User {user_sub[:8]}"

    user = User(
        issuer=settings.OIDC_ISSUER_URL,
        subject=user_sub,
        email=user_email,
        display_name=user_name,
        status="active",
    )
    db.add(user)
    db.flush()

    if role_name:
        role = db.query(Role).filter(Role.name == role_name.lower()).first()
        if not role:
            raise ValueError(f"Role '{role_name}' does not exist.")
        assignment = UserRole(
            user_id=user.id,
            role_id=role.id,
            assignment_reason=f"Assigned {role_name} for test",
        )
        db.add(assignment)

    db.commit()
    db.refresh(user)

    token = make_test_jwt(sub=user_sub, email=user_email, name=user_name)
    return user, token

