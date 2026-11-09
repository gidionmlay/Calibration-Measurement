"""User identity provisioning and account resolution service."""

import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.oidc import TokenPayload
from app.core.config import settings
from app.models.user import User


class UserAuthenticationError(Exception):
    """Base error for authentication-related user resolution failures."""


class UserAccountDisabledError(UserAuthenticationError):
    """Raised when an authenticated identity has status == 'disabled'."""
    def __init__(self, user_id: uuid.UUID):
        super().__init__(f"User account '{user_id}' has been disabled.")
        self.user_id = user_id


class UserNotProvisionedError(UserAuthenticationError):
    """Raised when auto-provisioning is disabled and the user does not exist."""
    def __init__(self, issuer: str, subject: str):
        super().__init__(
            f"User with sub '{subject}' under issuer '{issuer}' is not provisioned."
        )
        self.issuer = issuer
        self.subject = subject


class IdentityService:
    """Manages application identity mapping from verified OIDC tokens."""

    @staticmethod
    def resolve_or_provision_user(db: Session, claims: TokenPayload) -> User:
        """Atomically maps a verified OIDC TokenPayload to a persistent User entity.
        
        1. Queries existing user by (issuer, subject).
        2. Rejects disabled accounts with UserAccountDisabledError.
        3. Updates permitted profile information and last_authenticated_at.
        4. If absent and auto-provisioning is enabled, creates a new active user.
        5. Handles concurrent first-time provisioning gracefully via unique constraint recovery.
        """
        now = datetime.now(timezone.utc)
        stmt = (
            select(User)
            .where(User.issuer == claims.iss, User.subject == claims.sub)
            .with_for_update()
        )
        user = db.scalar(stmt)

        if user:
            # Enforce account active status
            if user.status != "active":
                raise UserAccountDisabledError(user.id)

            # Update profile claims and last authentication timestamp
            changed = False
            if claims.name and user.display_name != claims.name:
                user.display_name = claims.name
                changed = True
            if claims.email and user.email != claims.email:
                user.email = claims.email
                changed = True
            if user.email_verified != claims.email_verified:
                user.email_verified = claims.email_verified
                changed = True

            user.last_authenticated_at = now
            if changed:
                user.updated_at = now

            db.commit()
            db.refresh(user)
            return user

        # First-time user provisioning
        if not settings.OIDC_AUTO_PROVISION_USERS:
            raise UserNotProvisionedError(claims.iss, claims.sub)

        new_user = User(
            id=uuid.uuid4(),
            issuer=claims.iss,
            subject=claims.sub,
            display_name=claims.name,
            email=claims.email,
            email_verified=claims.email_verified,
            status="active",
            created_at=now,
            updated_at=now,
            last_authenticated_at=now,
        )

        try:
            db.add(new_user)
            db.commit()
            db.refresh(new_user)
            return new_user
        except IntegrityError:
            # Handle race condition where another concurrent thread inserted the user
            db.rollback()
            existing = db.scalar(
                select(User).where(User.issuer == claims.iss, User.subject == claims.sub)
            )
            if existing:
                if existing.status != "active":
                    raise UserAccountDisabledError(existing.id)
                existing.last_authenticated_at = now
                db.commit()
                db.refresh(existing)
                return existing
            raise

    @staticmethod
    def get_user_by_id(db: Session, user_id: uuid.UUID) -> Optional[User]:
        """Fetch user by primary UUID key."""
        return db.scalar(select(User).where(User.id == user_id))

