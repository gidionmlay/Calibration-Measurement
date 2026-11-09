"""Transactional audit ledger service.

Enforces transactional coupling: every domain modification must write to
the audit ledger within the exact same database transaction.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Union
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.session import MeasurementSession
from app.models.audit import AuditEvent
from app.audit.canonical import compute_audit_event_hash, GENESIS_HASH


def append_audit_event(
    db: Session,
    session_id: Union[uuid.UUID, str],
    event_type: str,
    actor_id: str,
    event_summary: str,
    payload: Optional[Dict[str, Any]] = None,
    affected_field: Optional[str] = None,
    before_value: Optional[str] = None,
    after_value: Optional[str] = None,
    override_reason: Optional[str] = None,
    client_operation_id: Optional[Union[uuid.UUID, str]] = None,
    event_id: Optional[uuid.UUID] = None,
    timestamp: Optional[datetime] = None,
) -> AuditEvent:
    """Append a new, cryptographically chained audit event to the session's ledger.
    
    This function MUST be called within an active transaction. It does NOT commit,
    ensuring that the caller controls the atomic transaction boundary.
    """
    session_uuid = session_id if isinstance(session_id, uuid.UUID) else uuid.UUID(str(session_id))
    ev_id = event_id or uuid.uuid4()
    ts = timestamp or datetime.now(timezone.utc)
    ev_payload = payload if payload is not None else {}
    client_op_uuid = (
        client_operation_id
        if isinstance(client_operation_id, uuid.UUID) or client_operation_id is None
        else uuid.UUID(str(client_operation_id))
    )

    # 1. Lock the parent session row with FOR UPDATE.
    # This guarantees that concurrent audit appends for the SAME session serialize strictly,
    # preventing sequence race conditions and duplicate sequence number failures.
    db.execute(
        select(MeasurementSession.id)
        .where(MeasurementSession.id == session_uuid)
        .with_for_update()
    )

    # 2. Query latest audit event for this session to establish previous_event_hash and sequence_num
    stmt = (
        select(AuditEvent)
        .where(AuditEvent.session_id == session_uuid)
        .order_by(AuditEvent.sequence_num.desc())
        .limit(1)
        .with_for_update()
    )
    last_event = db.scalars(stmt).first()

    if last_event is None:
        sequence_num = 1
        previous_event_hash = GENESIS_HASH
    else:
        sequence_num = last_event.sequence_num + 1
        previous_event_hash = last_event.event_hash

    # 3. Compute deterministic SHA-256 hash binding ALL security-relevant fields
    event_hash = compute_audit_event_hash(
        previous_event_hash=previous_event_hash,
        event_id=ev_id,
        session_id=session_uuid,
        sequence_num=sequence_num,
        timestamp=ts,
        actor_id=actor_id,
        event_type=event_type,
        payload=ev_payload,
        event_summary=event_summary,
        affected_field=affected_field,
        before_value=str(before_value) if before_value is not None else None,
        after_value=str(after_value) if after_value is not None else None,
        override_reason=override_reason,
        client_operation_id=client_op_uuid,
    )

    audit_entry = AuditEvent(
        id=ev_id,
        session_id=session_uuid,
        sequence_num=sequence_num,
        event_type=event_type,
        actor_id=actor_id,
        client_operation_id=client_op_uuid,
        timestamp=ts,
        event_summary=event_summary,
        affected_field=affected_field,
        before_value=str(before_value) if before_value is not None else None,
        after_value=str(after_value) if after_value is not None else None,
        override_reason=override_reason,
        payload=ev_payload,
        previous_event_hash=previous_event_hash,
        event_hash=event_hash,
    )

    db.add(audit_entry)
    db.flush()
    return audit_entry
