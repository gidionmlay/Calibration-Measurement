"""FastAPI authentication dependencies for OIDC token verification."""

import uuid
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from sqlalchemy.orm import Session

from app.auth.oidc import (
    OIDCValidationError,
    oidc_validator,
    OIDCValidator,
)
from app.auth.security import decode_local_token
from app.auth.service import (
    IdentityService,
    UserAccountDisabledError,
    UserNotProvisionedError,
)
from app.core.database import get_db
from app.models.user import User

# Standard HTTP Bearer scheme
bearer_scheme = HTTPBearer(auto_error=False)


def get_oidc_validator() -> OIDCValidator:
    """Dependency provider for OIDCValidator (enables test override)."""
    return oidc_validator


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
    validator: OIDCValidator = Depends(get_oidc_validator),
) -> User:
    """FastAPI dependency resolving the authenticated application user.
    
    1. Extracts Bearer token from Authorization header.
    2. Validates token signature, expiration, issuer, and audience.
    3. Resolves or provisions the persistent application User entity.
    4. Rejects disabled accounts with HTTP 403 Forbidden.
    5. Fails closed with HTTP 401 Unauthorized on missing/invalid tokens.
    """
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required: Bearer token missing or malformed.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    raw_token = credentials.credentials
    try:
        unverified_header = jwt.get_unverified_header(raw_token)
        alg = unverified_header.get("alg")
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token validation failed: malformed header.",
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        ) from exc

    if alg == "HS256":
        try:
            local_payload = decode_local_token(raw_token)
            if local_payload.get("type") != "access":
                raise ValueError("Expected an access token.")
            sub = local_payload.get("sub")
            if not sub:
                raise ValueError("Missing subject.")
            user_uuid = uuid.UUID(sub)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Invalid local authentication token: {exc}",
                headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
            ) from exc

        user = IdentityService.get_user_by_id(db, user_uuid)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found.",
                headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
            )
        if user.status != "active":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your user account is disabled. Contact your system supervisor.",
                headers={"WWW-Authenticate": 'Bearer error="insufficient_scope"'},
            )
        return user

    try:
        claims = validator.validate_token(raw_token)
    except OIDCValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {exc.message}",
            headers={"WWW-Authenticate": f'Bearer error="invalid_token", error_description="{exc.message}"'},
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token validation failed.",
            headers={"WWW-Authenticate": 'Bearer error="invalid_token"'},
        ) from exc

    try:
        user = IdentityService.resolve_or_provision_user(db=db, claims=claims)
        return user
    except UserAccountDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your user account is disabled. Contact your system supervisor.",
            headers={"WWW-Authenticate": 'Bearer error="insufficient_scope"'},
        ) from exc
    except UserNotProvisionedError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User identity is not provisioned in this system.",
            headers={"WWW-Authenticate": 'Bearer error="insufficient_scope"'},
        ) from exc

