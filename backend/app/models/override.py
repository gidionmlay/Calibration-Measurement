"""Session override model."""

import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    String,
    Text,
    DateTime,
    ForeignKey,
    CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class SessionOverride(Base):
    """Explicit override record for an overridden field or reading."""
    __tablename__ = "session_overrides"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    ride_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("session_rides.id", ondelete="SET NULL"),
        nullable=True,
    )
    field_name: Mapped[str] = mapped_column(String(100), nullable=False)
    original_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    replacement_value: Mapped[str] = mapped_column(Text, nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    session: Mapped["MeasurementSession"] = relationship("MeasurementSession", back_populates="overrides")

    __table_args__ = (
        CheckConstraint("length(trim(reason)) > 0", name="chk_override_reason_not_empty"),
    )

