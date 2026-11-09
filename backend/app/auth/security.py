"""Local password hashing and JWT token issuance utilities.

Implements secure scrypt password derivation with constant-time comparison,
and standard JWT issuance/validation for local application users.
"""

import hmac
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
import jwt

from app.core.config import settings

# scrypt parameters (OWASP recommended baseline)
SCRYPT_N = 16384
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAXMEM = 32 * 1024 * 1024  # 32 MB
SALT_BYTES = 16


def hash_password(password: str) -> str:
    """Hashes a plaintext password using standard hashlib.scrypt with a CSPRNG salt."""
    if not password or len(password) < 8:
        raise ValueError("Password must be at least 8 characters long.")
    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=SCRYPT_MAXMEM,
    )
    return f"scrypt$n={SCRYPT_N},r={SCRYPT_R},p={SCRYPT_P}${salt.hex()}${derived.hex()}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plaintext password against a stored scrypt password hash in constant time."""
    if not plain_password or not hashed_password:
        return False

    try:
        parts = hashed_password.split("$")
        if len(parts) != 4 or parts[0] != "scrypt":
            return False

        # Parse params
        params_str = parts[1]
        param_dict = dict(item.split("=") for item in params_str.split(","))
        n = int(param_dict.get("n", SCRYPT_N))
        r = int(param_dict.get("r", SCRYPT_R))
        p = int(param_dict.get("p", SCRYPT_P))

        salt = bytes.fromhex(parts[2])
        expected_derived = bytes.fromhex(parts[3])

        actual_derived = hashlib.scrypt(
            plain_password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            maxmem=SCRYPT_MAXMEM,
        )
        return hmac.compare_digest(actual_derived, expected_derived)
    except Exception:
        return False


def create_access_token(
    user_id: uuid.UUID,
    email: Optional[str],
    display_name: Optional[str],
    roles: List[str],
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Generates a signed HS256 JWT access token for a local user."""
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    payload: Dict[str, Any] = {
        "sub": str(user_id),
        "iss": "local",
        "aud": settings.OIDC_AUDIENCE,
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "jti": str(uuid.uuid4()),
        "email": email,
        "email_verified": True,
        "name": display_name,
        "roles": roles,
        "type": "access",
    }

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(
    user_id: uuid.UUID,
    expires_delta: Optional[timedelta] = None,
) -> str:
    """Generates a signed HS256 JWT refresh token."""
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    payload: Dict[str, Any] = {
        "sub": str(user_id),
        "iss": "local",
        "aud": settings.OIDC_AUDIENCE,
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp()),
        "jti": str(uuid.uuid4()),
        "type": "refresh",
    }

    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_local_token(token: str) -> Dict[str, Any]:
    """Decodes and validates a local JWT token signed with settings.JWT_SECRET_KEY."""
    try:
        return jwt.decode(
            token,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            audience=settings.OIDC_AUDIENCE,
            issuer="local",
            leeway=settings.OIDC_CLOCK_SKEW_SECONDS,
        )
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("Token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise ValueError(f"Invalid token: {exc}") from exc

