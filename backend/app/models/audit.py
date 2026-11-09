"""Append-only audit event model."""

import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any
from sqlalchemy import (
    String,
    Text,
    BigInteger,
    DateTime,
    ForeignKey,
    JSON,
    UniqueConstraint,
    Index,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.models.base import Base


class AuditEvent(Base):
    """Cryptographically chained append-only audit event model.
    
    Persists deterministic, immutable audit records tracking all state modifications.
    Hash chaining enforces tamper detection.
    """
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Never cascade delete audit events!
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    sequence_num: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    actor_id: Mapped[str] = mapped_column(String(255), nullable=False)
    client_operation_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    event_summary: Mapped[str] = mapped_column(Text, nullable=False)
    affected_field: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    before_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    after_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    override_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Detailed structured context
    payload: Mapped[Dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)

    # Cryptographic SHA-256 hash chaining
    previous_event_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    event_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    # Relationships
    session: Mapped["MeasurementSession"] = relationship("MeasurementSession", back_populates="audit_events")

    __table_args__ = (
        UniqueConstraint("session_id", "sequence_num", name="uq_audit_session_sequence"),
        Index("ix_audit_events_session_sequence", "session_id", "sequence_num"),
    )


from sqlalchemy import event


@event.listens_for(AuditEvent, "before_update")
def _block_audit_event_update(mapper, connection, target):
    """Enforce append-only immutability: block all UPDATE attempts on audit events."""
    raise PermissionError(
        "Application-layer immutability violation: Audit events are append-only. "
        "UPDATE operations on 'audit_events' are strictly prohibited."
    )


@event.listens_for(AuditEvent, "before_delete")
def _block_audit_event_delete(mapper, connection, target):
    """Enforce append-only immutability: block all DELETE attempts on audit events."""
    raise PermissionError(
        "Application-layer immutability violation: Audit events are append-only. "
        "DELETE operations on 'audit_events' are strictly prohibited."
    )
