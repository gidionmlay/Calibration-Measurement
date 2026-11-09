"""Audit trail cryptographic verification service."""

import uuid
from dataclasses import dataclass, field
from typing import List, Optional, Set, Union
from app.models.audit import AuditEvent
from app.audit.canonical import compute_audit_event_hash, GENESIS_HASH


@dataclass
class AuditVerificationResult:
    """Outcome of an audit ledger verification check."""
    is_valid: bool
    total_events: int
    verified_events: int
    errors: List[str] = field(default_factory=list)

    def to_dict(self):
        return {
            "is_valid": self.is_valid,
            "total_events": self.total_events,
            "verified_events": self.verified_events,
            "errors": self.errors,
        }


def verify_audit_ledger(
    events: List[AuditEvent],
    expected_session_id: Optional[Union[uuid.UUID, str]] = None,
) -> AuditVerificationResult:
    """Verifies the complete sequence, linkage, and cryptographic hash chain of audit events.
    
    Detects:
    - Missing or deleted events (discontinuous sequence numbers).
    - Tampered or modified event contents or metadata (hash mismatch).
    - Broken hash links (previous_event_hash mismatch).
    - Unexpected session association.
    - Duplicate event IDs.
    - Invalid genesis event previous hash.
    """
    if not events:
        return AuditVerificationResult(
            is_valid=True,
            total_events=0,
            verified_events=0,
            errors=[],
        )

    expected_sess_uuid = (
        uuid.UUID(str(expected_session_id)) if expected_session_id is not None else None
    )

    # Ensure events are sorted strictly by sequence_num
    sorted_events = sorted(events, key=lambda e: e.sequence_num)
    errors: List[str] = []
    seen_ids: Set[str] = set()
    verified_count = 0

    expected_seq = 1
    expected_prev_hash = GENESIS_HASH

    for ev in sorted_events:
        ev_id_str = str(ev.id).lower()

        # Check 1: Duplicate Event ID
        if ev_id_str in seen_ids:
            errors.append(f"Duplicate event ID detected: {ev_id_str} at sequence {ev.sequence_num}")
        seen_ids.add(ev_id_str)

        # Check 2: Session Association
        if expected_sess_uuid is not None and ev.session_id != expected_sess_uuid:
            errors.append(
                f"Unexpected session association: event {ev.id} at sequence {ev.sequence_num} "
                f"belongs to session {ev.session_id}, expected {expected_sess_uuid}"
            )

        # Check 3: Sequence Number Continuity
        if ev.sequence_num != expected_seq:
            errors.append(
                f"Discontinuous sequence number: expected {expected_seq}, found {ev.sequence_num} "
                f"(missing or deleted event suspected before sequence {ev.sequence_num})"
            )

        # Check 4: Genesis Block / Previous Hash Linkage
        if ev.sequence_num == 1 and ev.previous_event_hash != GENESIS_HASH:
            errors.append(
                f"Invalid genesis block: sequence 1 must have previous_event_hash '{GENESIS_HASH}', "
                f"found '{ev.previous_event_hash}'"
            )
        elif ev.sequence_num > 1 and ev.previous_event_hash != expected_prev_hash:
            errors.append(
                f"Broken hash link at sequence {ev.sequence_num}: recorded previous_event_hash "
                f"'{ev.previous_event_hash}' does not match expected '{expected_prev_hash}'"
            )

        # Check 5: Cryptographic Hash Verification covering ALL columns
        recalculated_hash = compute_audit_event_hash(
            previous_event_hash=ev.previous_event_hash,
            event_id=ev.id,
            session_id=ev.session_id,
            sequence_num=ev.sequence_num,
            timestamp=ev.timestamp,
            actor_id=ev.actor_id,
            event_type=ev.event_type,
            payload=ev.payload,
            event_summary=ev.event_summary,
            affected_field=ev.affected_field,
            before_value=ev.before_value,
            after_value=ev.after_value,
            override_reason=ev.override_reason,
            client_operation_id=ev.client_operation_id,
        )

        if ev.event_hash != recalculated_hash:
            errors.append(
                f"Content tampering detected at sequence {ev.sequence_num}: stored event_hash "
                f"'{ev.event_hash}' does not match recalculated hash '{recalculated_hash}'"
            )
        else:
            verified_count += 1

        # Advance expectations
        expected_seq = ev.sequence_num + 1
        expected_prev_hash = ev.event_hash

    return AuditVerificationResult(
        is_valid=(len(errors) == 0),
        total_events=len(events),
        verified_events=verified_count,
        errors=errors,
    )
