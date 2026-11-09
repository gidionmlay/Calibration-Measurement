"""User identity persistence model."""

import uuid
from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import (
    String,
    Boolean,
    DateTime,
    UniqueConstraint,
    CheckConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class User(Base):
    """Persistent application user identity model.
    
    Establishes a stable application identity mapped to an external OIDC
    provider through the compound identity tuple (issuer, subject).
    
    The internal application identity is an immutable UUID (id), which
    is linked to audit ledger records and session ownership.
    """
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # OIDC Identity Provider Issuer URL (e.g., https://auth.example.com/realms/calib)
    issuer: Mapped[str] = mapped_column(String(512), nullable=False)

    # OIDC Subject identifier (unique within issuer, e.g., auth0|123456 or sub uuid)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)

    # Profile attributes
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(320), nullable=True, index=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    organization: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Local credentials (null for purely federated OIDC users)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Account status: active, disabled
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active", index=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )
    last_authenticated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Role assignments (active and historical)
    role_assignments: Mapped[List["UserRole"]] = relationship(
        "UserRole",
        back_populates="user",
        foreign_keys="UserRole.user_id",
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint("issuer", "subject", name="uq_users_issuer_subject"),
        CheckConstraint("status IN ('active', 'disabled')", name="chk_user_status"),
        Index("idx_users_issuer_subject", "issuer", "subject"),
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} sub={self.subject} status={self.status}>"

