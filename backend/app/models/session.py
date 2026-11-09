"""Measurement session model."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from sqlalchemy import (
    String,
    Text,
    Integer,
    BigInteger,
    Numeric,
    Boolean,
    DateTime,
    ForeignKey,
    CheckConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class MeasurementSession(Base):
    """Authoritative Measurement Session persistence model.
    
    Persists session identity, lifecycle state, configuration parameters,
    and server-computed authoritative derived metrics.
    """
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Optimistic concurrency control version
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Lifecycle state: draft, in_progress, needs_review, ready_for_final_review, finalized, superseded
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Actor attribution (provisional / unauthenticated until Phase 10.3 OIDC)
    measurer_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    supervisor_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Course & Environment parameters
    course_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    course_length_m: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    course_length_unit: Mapped[str] = mapped_column(String(20), nullable=False, default="m")
    surface_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    temperature_c: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)

    # Counter & Rollover Configuration
    rollover_mode: Mapped[str] = mapped_column(String(30), nullable=False, default="none")
    max_reading: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Policy & Calculation Rules
    constant_selection_rule: Mapped[str] = mapped_column(
        String(50), nullable=False, default="larger"
    )
    working_spec_version: Mapped[str] = mapped_column(
        String(50), nullable=False, default="ws-0.3-provisional"
    )
    policy_approval_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="unapproved"
    )

    # Authoritative Derived Values (Server-calculated cache, NOT source of truth)
    pre_cal_working_constant: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(16, 6), nullable=True
    )
    post_cal_working_constant: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(16, 6), nullable=True
    )
    final_working_constant: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(16, 6), nullable=True
    )
    cal_drift_percent: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 4), nullable=True
    )
    course_distance_km: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(16, 8), nullable=True
    )
    calculation_engine_version: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )
    is_provisional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    policy_notice: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Lineage / supersession
    supersedes_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )
    superseded_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True
    )
    revision_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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

    # Relationships
    rides: Mapped[List["SessionRide"]] = relationship(
        "SessionRide",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionRide.ride_number",
    )
    overrides: Mapped[List["SessionOverride"]] = relationship(
        "SessionOverride",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionOverride.created_at",
    )
    reviews: Mapped[List["SessionReview"]] = relationship(
        "SessionReview",
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="SessionReview.created_at",
    )
    audit_events: Mapped[List["AuditEvent"]] = relationship(
        "AuditEvent",
        back_populates="session",
        order_by="AuditEvent.sequence_num",
    )

    __table_args__ = (
        CheckConstraint("course_length_m > 0", name="chk_session_course_length_positive"),
        CheckConstraint("version >= 1", name="chk_session_version_positive"),
    )

