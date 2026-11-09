"""Session ride model for raw counter readings and measurements."""

import uuid
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy import (
    String,
    Text,
    Integer,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    CheckConstraint,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class SessionRide(Base):
    """Raw ride count model.
    
    Stores discrete, unrounded integer counter readings for calibration
    and course measurement rides.
    """
    __tablename__ = "session_rides"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Ride type: pre_calibration, post_calibration, course_measurement
    ride_type: Mapped[str] = mapped_column(String(50), nullable=False)
    ride_number: Mapped[int] = mapped_column(Integer, nullable=False)

    # Discrete raw counter readings
    start_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    finish_count: Mapped[int] = mapped_column(BigInteger, nullable=False)
    count_delta: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Linkage and override tracking
    is_linked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_linked_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    override_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    adjustment: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )

    # Relationships
    session: Mapped["MeasurementSession"] = relationship("MeasurementSession", back_populates="rides")

    __table_args__ = (
        CheckConstraint(
            "start_count >= 0 AND finish_count >= 0",
            name="chk_rides_non_negative_counts",
        ),
        CheckConstraint(
            "(is_linked_override = false) OR (is_linked_override = true AND override_reason IS NOT NULL AND length(trim(override_reason)) > 0)",
            name="chk_ride_override_reason_required",
        ),
        UniqueConstraint("session_id", "ride_type", "ride_number", name="uq_session_ride_number"),
    )

