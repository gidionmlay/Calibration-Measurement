"""Canonical serialization and cryptographic hashing for audit events.

APPLICATION CANONICALIZATION CONTRACT:
This module implements a deterministic JSON and event hashing contract tailored for
the Bicycle Calibration Application based on RFC 8785 (JSON Canonicalization Scheme) principles:
1. Lexicographical sorting of dictionary keys by Unicode code point.
2. Compact serialization without whitespace after separators (',' and ':').
3. Direct UTF-8 preservation without ASCII escaping (ensure_ascii=False).
4. Deterministic string representation of exact Decimal values (e.g. "4967.4625"),
   avoiding IEEE 754 floating-point contamination.
5. Lowercase hyphenated UUID formatting.
6. Normalized UTC ISO-8601 timestamps with microsecond precision and 'Z' suffix.
7. Explicit binding of all top-level audit event metadata and payload fields.
"""

import json
import hashlib
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, Optional, Union

GENESIS_HASH: str = "0" * 64


def canonical_json_dumps(obj: Any) -> str:
    """Serialize any JSON-compatible object into canonical, deterministic JSON string.
    
    Adheres to the application canonicalization contract:
    - Keys sorted lexicographically.
    - No extraneous whitespace.
    - Preserves UTF-8 characters directly.
    - Decimals rendered as exact string values.
    - UUIDs formatted as lowercase hyphenated strings.
    - Datetimes formatted as normalized UTC ISO-8601 strings.
    """
    def _default_serializer(val: Any) -> Any:
        if isinstance(val, datetime):
            utc_dt = val.astimezone(timezone.utc) if val.tzinfo else val.replace(tzinfo=timezone.utc)
            return utc_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        if isinstance(val, uuid.UUID):
            return str(val).lower()
        if isinstance(val, Decimal):
            return str(val)
        raise TypeError(f"Object of type {type(val).__name__} is not JSON serializable")

    return json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=_default_serializer,
    )


def compute_audit_event_hash(
    previous_event_hash: str,
    event_id: Union[uuid.UUID, str],
    session_id: Union[uuid.UUID, str],
    sequence_num: int,
    timestamp: datetime,
    actor_id: str,
    event_type: str,
    payload: Dict[str, Any],
    event_summary: str = "",
    affected_field: Optional[str] = None,
    before_value: Optional[str] = None,
    after_value: Optional[str] = None,
    override_reason: Optional[str] = None,
    client_operation_id: Optional[Union[uuid.UUID, str]] = None,
) -> str:
    """Compute the deterministic SHA-256 hash of an audit event.
    
    Cryptographically binds ALL security-relevant fields:
    - previous_event_hash (64 hex characters)
    - event_id (UUID lowercase string)
    - session_id (UUID lowercase string)
    - sequence_num (monotonic 1-based integer)
    - timestamp (ISO-8601 UTC string)
    - actor_id (Unicode string)
    - event_type (uppercase string)
    - client_operation_id (UUID string or empty)
    - event_summary (Unicode string)
    - affected_field (string or empty)
    - before_value (string or empty)
    - after_value (string or empty)
    - override_reason (string or empty)
    - payload (canonical JSON string)
    """
    prev_hash_norm = str(previous_event_hash).lower().strip()
    event_id_str = str(event_id).lower().strip()
    session_id_str = str(session_id).lower().strip()
    seq_str = str(sequence_num)

    utc_dt = timestamp.astimezone(timezone.utc) if timestamp.tzinfo else timestamp.replace(tzinfo=timezone.utc)
    ts_str = utc_dt.strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    actor_str = str(actor_id).strip()
    type_str = str(event_type).upper().strip()
    client_op_str = str(client_operation_id).lower().strip() if client_operation_id else ""
    summary_str = str(event_summary).strip()
    field_str = str(affected_field).strip() if affected_field else ""
    before_str = str(before_value).strip() if before_value is not None else ""
    after_str = str(after_value).strip() if after_value is not None else ""
    reason_str = str(override_reason).strip() if override_reason else ""
    canonical_payload = canonical_json_dumps(payload)

    # Build canonical digest representation with unambiguous delimiter
    canonical_representation = (
        f"{prev_hash_norm}|{event_id_str}|{session_id_str}|{seq_str}|{ts_str}|"
        f"{actor_str}|{type_str}|{client_op_str}|{summary_str}|{field_str}|"
        f"{before_str}|{after_str}|{reason_str}|{canonical_payload}"
    )

    return hashlib.sha256(canonical_representation.encode("utf-8")).hexdigest()
