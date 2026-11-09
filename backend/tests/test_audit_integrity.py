"""Tests for audit ledger cryptographic hash chaining and integrity verification.

Covers Verification Area A of Phase 10.2.1:
- Canonical serialization contract (JCS-inspired deterministic JSON, Decimal strings, Unicode, key sorting)
- Full cryptographic binding of all security-relevant fields
- Tamper detection across payloads, top-level metadata, sequence numbers, timestamps, and session IDs
- Audit verification against corrupted, duplicated, or mislinked event chains
"""

import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest

from app.models.audit import AuditEvent
from app.audit.canonical import (
    canonical_json_dumps,
    compute_audit_event_hash,
    GENESIS_HASH,
)
from app.audit.verifier import verify_audit_ledger


# ---------------------------------------------------------------------------
# Canonicalization Contract Tests
# ---------------------------------------------------------------------------

def test_canonical_json_key_order_independence():
    """Verify that dictionaries with different key insertion orders produce identical canonical JSON."""
    dict_a = {"z": 1, "a": 2, "m": {"b": 3, "a": 4}}
    dict_b = {"a": 2, "m": {"a": 4, "b": 3}, "z": 1}
    assert canonical_json_dumps(dict_a) == canonical_json_dumps(dict_b)


def test_canonical_json_nested_structure():
    """Verify nested dictionaries, arrays, booleans, and nulls sort consistently."""
    obj1 = {
        "outer": {
            "c": [3, 2, 1],
            "b": None,
            "a": True,
            "d": False,
        },
        "flag": False,
    }
    obj2 = {
        "flag": False,
        "outer": {
            "a": True,
            "d": False,
            "b": None,
            "c": [3, 2, 1],  # Array order is preserved as per spec
        },
    }
    assert canonical_json_dumps(obj1) == canonical_json_dumps(obj2)
    assert canonical_json_dumps(obj1) == '{"flag":false,"outer":{"a":true,"b":null,"c":[3,2,1],"d":false}}'


def test_canonical_json_unicode_and_escaping():
    """Verify UTF-8 Unicode characters and proper JSON escaping without extra spaces."""
    data = {
        "greeting": "こんにちは / Bonjour / Grüß Gott",
        "symbol": "🚴‍♂️ 1000m ± 0.05%",
        "quotes": 'Contains "quotes" and \\backslashes\\ and \n newlines',
    }
    res = canonical_json_dumps(data)
    # Ensure Unicode characters remain intact in UTF-8
    assert "こんにちは" in res
    assert "🚴‍♂️" in res
    # Ensure escaped sequences are standard JSON
    assert '\\"quotes\\"' in res
    assert "\\\\backslashes\\\\" in res
    assert "\\n" in res


def test_canonical_json_decimal_exact_string_preservation():
    """Verify exact string serialization of Decimals, specifically preserving trailing zeros."""
    # Under IEEE 754 float conversion, 100.00 and 100.0 would collapse to 100.
    # The application-specific canonicalization contract preserves exact decimal strings.
    val_a = {"measurement": Decimal("100.00")}
    val_b = {"measurement": Decimal("100.0")}
    val_c = {"measurement": Decimal("100")}

    str_a = canonical_json_dumps(val_a)
    str_b = canonical_json_dumps(val_b)
    str_c = canonical_json_dumps(val_c)

    assert str_a == '{"measurement":"100.00"}'
    assert str_b == '{"measurement":"100.0"}'
    assert str_c == '{"measurement":"100"}'
    assert str_a != str_b
    assert str_b != str_c


def test_canonical_json_uuid_and_datetime_formatting():
    """Verify lowercase UUID and ISO-8601 UTC timestamp serialization with microsecond precision."""
    uid = uuid.UUID("12345678-1234-5678-1234-567812345678")
    dt = datetime(2026, 11, 7, 14, 30, 0, tzinfo=timezone.utc)
    res = canonical_json_dumps({"id": uid, "time": dt})
    assert res == '{"id":"12345678-1234-5678-1234-567812345678","time":"2026-11-07T14:30:00.000000Z"}'


def test_canonical_json_deterministic_repeated_executions():
    """Verify that repeated canonicalization of identical data produces byte-for-byte identical output."""
    payload = {
        "session_id": str(uuid.uuid4()),
        "readings": [1000, 2000, 3000],
        "metadata": {"temp_c": Decimal("20.50"), "surface": "asphalt"},
        "approved": False,
    }
    first = canonical_json_dumps(payload)
    for _ in range(50):
        assert canonical_json_dumps(payload) == first


# ---------------------------------------------------------------------------
# Cryptographic Hash & Ledger Verification Tests
# ---------------------------------------------------------------------------

def test_valid_audit_ledger_passes_verification():
    """Verify that a properly constructed 3-event audit ledger passes verification."""
    session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)

    # Event 1 (Genesis)
    ev1_id = uuid.uuid4()
    ev1_payload = {"action": "create", "version": 1}
    ev1_hash = compute_audit_event_hash(
        previous_event_hash=GENESIS_HASH,
        event_id=ev1_id,
        session_id=session_id,
        sequence_num=1,
        timestamp=now,
        actor_id="provisional:measurer",
        event_type="SESSION_CREATED",
        payload=ev1_payload,
        event_summary="Session created",
    )
    ev1 = AuditEvent(
        id=ev1_id,
        session_id=session_id,
        sequence_num=1,
        event_type="SESSION_CREATED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Session created",
        payload=ev1_payload,
        previous_event_hash=GENESIS_HASH,
        event_hash=ev1_hash,
    )

    # Event 2
    ev2_id = uuid.uuid4()
    ev2_payload = {"ride_number": 1, "start_count": 10000}
    ev2_hash = compute_audit_event_hash(
        previous_event_hash=ev1_hash,
        event_id=ev2_id,
        session_id=session_id,
        sequence_num=2,
        timestamp=now,
        actor_id="provisional:measurer",
        event_type="READING_RECORDED",
        payload=ev2_payload,
        event_summary="Reading recorded",
    )
    ev2 = AuditEvent(
        id=ev2_id,
        session_id=session_id,
        sequence_num=2,
        event_type="READING_RECORDED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Reading recorded",
        payload=ev2_payload,
        previous_event_hash=ev1_hash,
        event_hash=ev2_hash,
    )

    # Event 3
    ev3_id = uuid.uuid4()
    ev3_payload = {"wc": "4967.4625"}
    ev3_hash = compute_audit_event_hash(
        previous_event_hash=ev2_hash,
        event_id=ev3_id,
        session_id=session_id,
        sequence_num=3,
        timestamp=now,
        actor_id="provisional:system",
        event_type="CALCULATION_PERFORMED",
        payload=ev3_payload,
        event_summary="Calculation performed",
    )
    ev3 = AuditEvent(
        id=ev3_id,
        session_id=session_id,
        sequence_num=3,
        event_type="CALCULATION_PERFORMED",
        actor_id="provisional:system",
        timestamp=now,
        event_summary="Calculation performed",
        payload=ev3_payload,
        previous_event_hash=ev2_hash,
        event_hash=ev3_hash,
    )

    result = verify_audit_ledger([ev1, ev2, ev3], expected_session_id=session_id)
    assert result.is_valid is True
    assert result.total_events == 3
    assert result.verified_events == 3
    assert len(result.errors) == 0


def test_tampered_payload_is_detected():
    """Verify that tampering with an event's payload invalidates verification."""
    session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
    ev_id = uuid.uuid4()
    ev_payload = {"count": 1000}
    ev_hash = compute_audit_event_hash(
        previous_event_hash=GENESIS_HASH,
        event_id=ev_id,
        session_id=session_id,
        sequence_num=1,
        timestamp=now,
        actor_id="provisional:measurer",
        event_type="READING_RECORDED",
        payload=ev_payload,
        event_summary="Original reading",
    )
    tampered_event = AuditEvent(
        id=ev_id,
        session_id=session_id,
        sequence_num=1,
        event_type="READING_RECORDED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Original reading",
        payload={"count": 9999},  # Tampered payload!
        previous_event_hash=GENESIS_HASH,
        event_hash=ev_hash,
    )

    result = verify_audit_ledger([tampered_event], expected_session_id=session_id)
    assert result.is_valid is False
    assert any("Content tampering detected" in err for err in result.errors)


@pytest.mark.parametrize("field,tampered_val", [
    ("affected_field", "other_field"),
    ("before_value", "tampered_before"),
    ("after_value", "tampered_after"),
    ("override_reason", "Tampered reason"),
    ("event_summary", "Tampered summary"),
    ("actor_id", "malicious_actor"),
    ("event_type", "UNAUTHORIZED_EVENT"),
])
def test_tampered_top_level_fields_detected(field, tampered_val):
    """Verify that tampering with any top-level metadata column is strictly detected."""
    session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
    ev_id = uuid.uuid4()

    orig_kwargs = {
        "previous_event_hash": GENESIS_HASH,
        "event_id": ev_id,
        "session_id": session_id,
        "sequence_num": 1,
        "timestamp": now,
        "actor_id": "provisional:measurer",
        "event_type": "OVERRIDE_RECORDED",
        "payload": {"reason": "tire change"},
        "affected_field": "constant",
        "before_value": "4967.4625",
        "after_value": "4968.1000",
        "override_reason": "Authorized tire change",
        "event_summary": "Tire change override",
    }
    correct_hash = compute_audit_event_hash(**orig_kwargs)

    # Instantiate model with original values
    event_model_kwargs = {
        "id": ev_id,
        "session_id": session_id,
        "sequence_num": 1,
        "event_type": orig_kwargs["event_type"],
        "actor_id": orig_kwargs["actor_id"],
        "timestamp": now,
        "event_summary": orig_kwargs["event_summary"],
        "payload": orig_kwargs["payload"],
        "affected_field": orig_kwargs["affected_field"],
        "before_value": orig_kwargs["before_value"],
        "after_value": orig_kwargs["after_value"],
        "override_reason": orig_kwargs["override_reason"],
        "previous_event_hash": GENESIS_HASH,
        "event_hash": correct_hash,
    }
    # Tamper with the specific field
    event_model_kwargs[field] = tampered_val
    tampered_event = AuditEvent(**event_model_kwargs)

    result = verify_audit_ledger([tampered_event], expected_session_id=session_id)
    assert result.is_valid is False
    assert any("Content tampering detected" in err for err in result.errors)


def test_unexpected_session_id_detected():
    """Verify that an event belonging to another session is detected and rejected."""
    target_session_id = uuid.uuid4()
    foreign_session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
    ev_id = uuid.uuid4()

    ev_hash = compute_audit_event_hash(
        previous_event_hash=GENESIS_HASH,
        event_id=ev_id,
        session_id=foreign_session_id,
        sequence_num=1,
        timestamp=now,
        actor_id="provisional:measurer",
        event_type="SESSION_CREATED",
        payload={},
    )
    foreign_event = AuditEvent(
        id=ev_id,
        session_id=foreign_session_id,
        sequence_num=1,
        event_type="SESSION_CREATED",
        actor_id="provisional:measurer",
        timestamp=now,
        payload={},
        previous_event_hash=GENESIS_HASH,
        event_hash=ev_hash,
    )

    result = verify_audit_ledger([foreign_event], expected_session_id=target_session_id)
    assert result.is_valid is False
    assert any("belongs to session" in err for err in result.errors)


def test_invalid_genesis_event_hash_detected():
    """Verify that a genesis event (seq 1) with a non-zero previous_event_hash is flagged."""
    session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
    ev_id = uuid.uuid4()

    bad_prev = "f" * 64
    ev_hash = compute_audit_event_hash(
        previous_event_hash=bad_prev,
        event_id=ev_id,
        session_id=session_id,
        sequence_num=1,
        timestamp=now,
        actor_id="provisional:measurer",
        event_type="SESSION_CREATED",
        payload={},
    )
    bad_genesis = AuditEvent(
        id=ev_id,
        session_id=session_id,
        sequence_num=1,
        event_type="SESSION_CREATED",
        actor_id="provisional:measurer",
        timestamp=now,
        payload={},
        previous_event_hash=bad_prev,
        event_hash=ev_hash,
    )

    result = verify_audit_ledger([bad_genesis], expected_session_id=session_id)
    assert result.is_valid is False
    assert any("Invalid genesis block: sequence 1 must have previous_event_hash" in err for err in result.errors)


def test_missing_event_sequence_is_detected():
    """Verify that a gap in sequence numbers (e.g., event 2 deleted) is detected."""
    session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)

    ev1 = AuditEvent(
        id=uuid.uuid4(),
        session_id=session_id,
        sequence_num=1,
        event_type="SESSION_CREATED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Event 1",
        payload={},
        previous_event_hash=GENESIS_HASH,
        event_hash="dummy_hash_1",
    )
    ev3 = AuditEvent(
        id=uuid.uuid4(),
        session_id=session_id,
        sequence_num=3,
        event_type="READING_RECORDED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Event 3",
        payload={},
        previous_event_hash="dummy_hash_1",
        event_hash="dummy_hash_3",
    )

    result = verify_audit_ledger([ev1, ev3])
    assert result.is_valid is False
    assert any("Discontinuous sequence number" in err for err in result.errors)


def test_broken_hash_link_is_detected():
    """Verify that a forged event with invalid previous_event_hash is detected."""
    session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)

    ev1 = AuditEvent(
        id=uuid.uuid4(),
        session_id=session_id,
        sequence_num=1,
        event_type="SESSION_CREATED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Event 1",
        payload={},
        previous_event_hash=GENESIS_HASH,
        event_hash="real_hash_1" * 4,
    )
    ev2 = AuditEvent(
        id=uuid.uuid4(),
        session_id=session_id,
        sequence_num=2,
        event_type="READING_RECORDED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Event 2",
        payload={},
        previous_event_hash="forged_hash_wrong" + "0" * 47,  # Mismatch!
        event_hash="dummy_hash_2",
    )

    result = verify_audit_ledger([ev1, ev2])
    assert result.is_valid is False
    assert any("Broken hash link" in err for err in result.errors)


def test_duplicate_event_ids_detected():
    """Verify that duplicate event IDs across events are flagged."""
    session_id = uuid.uuid4()
    now = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)
    shared_id = uuid.uuid4()

    ev1 = AuditEvent(
        id=shared_id,
        session_id=session_id,
        sequence_num=1,
        event_type="SESSION_CREATED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Event 1",
        payload={},
        previous_event_hash=GENESIS_HASH,
        event_hash="hash1",
    )
    ev2 = AuditEvent(
        id=shared_id,  # Duplicate!
        session_id=session_id,
        sequence_num=2,
        event_type="READING_RECORDED",
        actor_id="provisional:measurer",
        timestamp=now,
        event_summary="Event 2",
        payload={},
        previous_event_hash="hash1",
        event_hash="hash2",
    )

    result = verify_audit_ledger([ev1, ev2])
    assert result.is_valid is False
    assert any("Duplicate event ID detected" in err for err in result.errors)
