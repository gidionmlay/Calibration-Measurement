"""Transactional service for Measurement Session persistence and audit ledger coupling."""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional, Tuple, Dict, Any
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.session import MeasurementSession
from app.models.ride import SessionRide
from app.models.override import SessionOverride
from app.models.review import SessionReview
from app.models.audit import AuditEvent
from app.audit.ledger import append_audit_event
from app.audit.verifier import verify_audit_ledger, AuditVerificationResult
from app.domain.state_machine import (
    SessionState,
    SessionStateMachine,
    InvalidStateTransitionError,
    SessionImmutableError,
    FinalizationBlockerError,
    PolicyRatificationError,
)
from app.schemas.session import SessionCreateRequest, SessionUpdateRequest, SessionRideCreateSchema
from app.services.calculation_engine import (
    calculate_calibration,
    RideInput,
    RolloverConfig,
    RolloverMode,
    ENGINE_VERSION,
    RULESET_VERSION,
)


class SessionNotFoundError(Exception):
    """Raised when a requested session is not found in the database."""
    def __init__(self, session_id: uuid.UUID):
        self.session_id = session_id
        super().__init__(f"Session with ID '{session_id}' was not found.")


class ConcurrencyConflictError(Exception):
    """Raised when an update conflicts with the current session version."""
    def __init__(self, session_id: uuid.UUID, expected_version: int, current_version: int):
        self.session_id = session_id
        self.expected_version = expected_version
        self.current_version = current_version
        super().__init__(
            f"Concurrency conflict on session '{session_id}': "
            f"expected version {expected_version}, but current database version is {current_version}. "
            "Please reload the session and reconcile changes."
        )


def _recompute_session_calculations(
    course_length_m: Decimal,
    rollover_mode_str: str,
    max_reading: Optional[int],
    rides_data: List[SessionRideCreateSchema],
) -> Tuple[Optional[Decimal], Optional[Decimal], Optional[Decimal], Optional[str], bool, Optional[str], List[Dict[str, Any]]]:
    """Recomputes authoritative calibration metrics using the pure calculation engine.
    
    Returns:
        (pre_cal_wc, post_cal_wc, final_wc, engine_ver, is_provisional, policy_notice, resolved_rides_dicts)
    """
    pre_cal_rides = [r for r in rides_data if r.ride_type == "pre_calibration"]
    if not pre_cal_rides:
        return None, None, None, ENGINE_VERSION, True, "PROVISIONAL — UNRATIFIED POLICY", []

    # Map to calculation engine inputs
    engine_rides = [
        RideInput(
            start=r.start_count,
            finish=r.finish_count,
            start_overridden=r.is_linked_override,
            override_reason=r.override_reason or "",
        )
        for r in pre_cal_rides
    ]

    mode_enum = RolloverMode(rollover_mode_str)
    rollover_cfg = RolloverConfig(mode=mode_enum, max_reading=max_reading)

    cal_result = calculate_calibration(
        rides=engine_rides,
        course_length_m=course_length_m,
        rollover=rollover_cfg,
    )

    resolved_rides = [
        {
            "ride_number": r.ride_number,
            "start": r.start,
            "finish": r.finish,
            "count": r.count,
            "linked": r.linked,
            "overridden": r.overridden,
            "override_reason": r.override_reason,
            "adjustment": r.adjustment,
        }
        for r in cal_result.rides
    ]

    return (
        cal_result.working_constant,
        None,  # post_cal not yet calculated here
        cal_result.working_constant,
        cal_result.engine_version,
        cal_result.is_provisional,
        cal_result.policy_notice,
        resolved_rides,
    )


class SessionService:
    """Service orchestrating transactional persistence and audit logging."""

    @staticmethod
    def create_session(
        db: Session,
        session_in: SessionCreateRequest,
        actor_id: str = "provisional:system",
        measurer_id: Optional[str] = None,
        client_operation_id: Optional[uuid.UUID] = None,
    ) -> MeasurementSession:
        """Create a new measurement session, storing raw inputs, derived calculations,
        and appending a genesis audit event atomically.
        """
        try:
            session_id = uuid.uuid4()
            now = datetime.now(timezone.utc)

            # Recompute authoritative derived metrics
            (
                pre_wc,
                post_wc,
                final_wc,
                eng_ver,
                is_prov,
                policy_note,
                resolved_rides,
            ) = _recompute_session_calculations(
                course_length_m=session_in.course_length_m,
                rollover_mode_str=session_in.rollover.mode.value,
                max_reading=session_in.rollover.max_reading,
                rides_data=session_in.rides,
            )

            # Create session model
            session = MeasurementSession(
                id=session_id,
                version=1,
                schema_version=1,
                status="draft",
                name=session_in.name,
                description=session_in.description,
                measurer_id=measurer_id or actor_id,
                supervisor_id=session_in.supervisor_id,
                course_name=session_in.course_name,
                course_length_m=session_in.course_length_m,
                course_length_unit=session_in.course_length_unit,
                surface_type=session_in.surface_type,
                temperature_c=session_in.temperature_c,
                rollover_mode=session_in.rollover.mode.value,
                max_reading=session_in.rollover.max_reading,
                constant_selection_rule=session_in.constant_selection_rule.value,
                working_spec_version=session_in.working_spec_version,
                policy_approval_status="unapproved",
                pre_cal_working_constant=pre_wc,
                post_cal_working_constant=post_wc,
                final_working_constant=final_wc,
                calculation_engine_version=eng_ver,
                is_provisional=is_prov,
                policy_notice=policy_note,
                created_at=now,
                updated_at=now,
            )
            db.add(session)
            db.flush()

            # Persist rides
            resolved_map = {r["ride_number"]: r for r in resolved_rides}
            for ride_in in session_in.rides:
                res_info = resolved_map.get(ride_in.ride_number, {})
                ride_delta = res_info.get("count", ride_in.finish_count - ride_in.start_count)
                is_linked = res_info.get("linked", True)
                adj = res_info.get("adjustment", 0)

                ride_obj = SessionRide(
                    id=uuid.uuid4(),
                    session_id=session_id,
                    ride_type=ride_in.ride_type,
                    ride_number=ride_in.ride_number,
                    start_count=ride_in.start_count,
                    finish_count=ride_in.finish_count,
                    count_delta=ride_delta,
                    is_linked=is_linked,
                    is_linked_override=ride_in.is_linked_override,
                    override_reason=ride_in.override_reason,
                    adjustment=adj,
                    created_at=now,
                )
                db.add(ride_obj)
                db.flush()

                # If override was specified, record in session_overrides
                if ride_in.is_linked_override and ride_in.override_reason:
                    override_obj = SessionOverride(
                        id=uuid.uuid4(),
                        session_id=session_id,
                        ride_id=ride_obj.id,
                        field_name="start_count",
                        original_value=None,
                        replacement_value=str(ride_in.start_count),
                        reason=ride_in.override_reason,
                        actor_id=actor_id,
                        created_at=now,
                    )
                    db.add(override_obj)

            # Transactional append of Genesis Audit Event
            append_audit_event(
                db=db,
                session_id=session_id,
                event_type="SESSION_CREATED",
                actor_id=actor_id,
                event_summary=f"Created measurement session '{session_in.name}' with {len(session_in.rides)} rides.",
                payload={
                    "session_id": str(session_id),
                    "name": session_in.name,
                    "course_length_m": str(session_in.course_length_m),
                    "rollover_mode": session_in.rollover.mode.value,
                    "max_reading": session_in.rollover.max_reading,
                    "rides_count": len(session_in.rides),
                    "pre_cal_working_constant": str(pre_wc) if pre_wc else None,
                    "engine_version": eng_ver,
                },
                client_operation_id=client_operation_id,
                timestamp=now,
            )

            db.commit()
            db.refresh(session)
            return session
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def get_session(db: Session, session_id: uuid.UUID) -> Optional[MeasurementSession]:
        """Retrieve a session by its unique ID."""
        stmt = select(MeasurementSession).where(MeasurementSession.id == session_id)
        return db.scalars(stmt).first()

    @staticmethod
    def update_session(
        db: Session,
        session_id: uuid.UUID,
        update_in: SessionUpdateRequest,
        actor_id: str = "provisional:system",
        client_operation_id: Optional[uuid.UUID] = None,
    ) -> MeasurementSession:
        """Atomically update a session with optimistic concurrency control,
        authoritative recalculation, review invalidation, and audit ledger append.
        """
        try:
            # Lock session row for update
            stmt = (
                select(MeasurementSession)
                .where(MeasurementSession.id == session_id)
                .with_for_update()
            )
            session = db.scalars(stmt).first()
            if not session:
                raise SessionNotFoundError(session_id)

            # Immutability validation: finalized or superseded records are permanently read-only
            SessionStateMachine.check_immutability(session)

            # Optimistic concurrency check
            if session.version != update_in.expected_version:
                raise ConcurrencyConflictError(
                    session_id=session_id,
                    expected_version=update_in.expected_version,
                    current_version=session.version,
                )

            now = datetime.now(timezone.utc)
            readings_changed = False
            audit_events_to_record = []

            # Update core fields if provided
            if update_in.name is not None and update_in.name != session.name:
                audit_events_to_record.append((
                    "NAME_UPDATED",
                    "Session name updated",
                    "name",
                    session.name,
                    update_in.name,
                    None,
                ))
                session.name = update_in.name

            if update_in.description is not None:
                session.description = update_in.description

            if update_in.course_name is not None:
                session.course_name = update_in.course_name

            if update_in.temperature_c is not None:
                session.temperature_c = update_in.temperature_c

            if update_in.course_length_m is not None and update_in.course_length_m != session.course_length_m:
                audit_events_to_record.append((
                    "COURSE_LENGTH_UPDATED",
                    "Calibration course length updated",
                    "course_length_m",
                    str(session.course_length_m),
                    str(update_in.course_length_m),
                    update_in.change_reason,
                ))
                session.course_length_m = update_in.course_length_m
                readings_changed = True

            if update_in.rollover is not None:
                new_mode = update_in.rollover.mode.value
                new_max = update_in.rollover.max_reading
                if new_mode != session.rollover_mode or new_max != session.max_reading:
                    audit_events_to_record.append((
                        "ROLLOVER_CONFIG_UPDATED",
                        "Rollover configuration updated",
                        "rollover_mode",
                        session.rollover_mode,
                        new_mode,
                        update_in.change_reason,
                    ))
                    session.rollover_mode = new_mode
                    session.max_reading = new_max
                    readings_changed = True

            if update_in.constant_selection_rule is not None:
                new_rule = update_in.constant_selection_rule.value
                if new_rule != session.constant_selection_rule:
                    session.constant_selection_rule = new_rule
                    readings_changed = True

            # Update rides if provided
            rides_to_process = update_in.rides
            if rides_to_process is not None:
                readings_changed = True
                # Remove existing rides
                for r in list(session.rides):
                    db.delete(r)
                db.flush()

                # Recompute authoritative calculations with updated rides
                (
                    pre_wc,
                    post_wc,
                    final_wc,
                    eng_ver,
                    is_prov,
                    policy_note,
                    resolved_rides,
                ) = _recompute_session_calculations(
                    course_length_m=session.course_length_m,
                    rollover_mode_str=session.rollover_mode,
                    max_reading=session.max_reading,
                    rides_data=rides_to_process,
                )

                session.pre_cal_working_constant = pre_wc
                session.final_working_constant = final_wc
                session.calculation_engine_version = eng_ver
                session.is_provisional = is_prov
                session.policy_notice = policy_note

                resolved_map = {r["ride_number"]: r for r in resolved_rides}
                for r_in in rides_to_process:
                    res_info = resolved_map.get(r_in.ride_number, {})
                    ride_delta = res_info.get("count", r_in.finish_count - r_in.start_count)
                    is_linked = res_info.get("linked", True)
                    adj = res_info.get("adjustment", 0)

                    new_ride = SessionRide(
                        id=uuid.uuid4(),
                        session_id=session.id,
                        ride_type=r_in.ride_type,
                        ride_number=r_in.ride_number,
                        start_count=r_in.start_count,
                        finish_count=r_in.finish_count,
                        count_delta=ride_delta,
                        is_linked=is_linked,
                        is_linked_override=r_in.is_linked_override,
                        override_reason=r_in.override_reason,
                        adjustment=adj,
                        created_at=now,
                    )
                    db.add(new_ride)
                    db.flush()

                    if r_in.is_linked_override and r_in.override_reason:
                        override_obj = SessionOverride(
                            id=uuid.uuid4(),
                            session_id=session.id,
                            ride_id=new_ride.id,
                            field_name="start_count",
                            original_value=None,
                            replacement_value=str(r_in.start_count),
                            reason=r_in.override_reason,
                            actor_id=actor_id,
                            created_at=now,
                        )
                        db.add(override_obj)
                        audit_events_to_record.append((
                            "OVERRIDE_RECORDED",
                            f"Start reading overridden for ride {r_in.ride_number}: {r_in.override_reason}",
                            f"ride_{r_in.ride_number}.start_count",
                            None,
                            str(r_in.start_count),
                            r_in.override_reason,
                        ))

                audit_events_to_record.append((
                    "READINGS_UPDATED",
                    f"Updated {len(rides_to_process)} session rides; recomputed WC = {pre_wc}",
                    "rides",
                    None,
                    None,
                    update_in.change_reason,
                ))

            # Review Invalidation: If readings or calculation basis changed, invalidate active reviews
            if readings_changed:
                for rev in session.reviews:
                    if not rev.is_invalidated:
                        rev.is_invalidated = True
                        rev.invalidated_at = now
                        rev.invalidation_reason = "Upstream calibration readings or configuration modified"
                        audit_events_to_record.append((
                            "REVIEW_INVALIDATED",
                            f"Review by '{rev.reviewer_id}' invalidated due to upstream reading modifications.",
                            "review.is_invalidated",
                            "false",
                            "true",
                            "Upstream calibration readings modified",
                        ))

            # Increment session version (Optimistic Concurrency)
            old_version = session.version
            session.version += 1
            session.updated_at = now

            # Append all accumulated audit events
            for ev_type, summary, aff_field, before_val, after_val, reason in audit_events_to_record:
                append_audit_event(
                    db=db,
                    session_id=session.id,
                    event_type=ev_type,
                    actor_id=actor_id,
                    event_summary=summary,
                    affected_field=aff_field,
                    before_value=before_val,
                    after_value=after_val,
                    override_reason=reason,
                    payload={
                        "version_transition": f"{old_version} -> {session.version}",
                        "session_id": str(session.id),
                        "summary": summary,
                    },
                    client_operation_id=client_operation_id,
                    timestamp=now,
                )

            # If no specific audit event was triggered (e.g. only description updated), emit general update
            if not audit_events_to_record:
                append_audit_event(
                    db=db,
                    session_id=session.id,
                    event_type="SESSION_METADATA_UPDATED",
                    actor_id=actor_id,
                    event_summary="Session metadata updated",
                    payload={"version_transition": f"{old_version} -> {session.version}"},
                    client_operation_id=client_operation_id,
                    timestamp=now,
                )

            db.commit()
            db.refresh(session)
            return session
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def get_session_audit_trail(db: Session, session_id: uuid.UUID) -> List[AuditEvent]:
        """Retrieve the complete, ordered audit ledger for a session."""
        stmt = (
            select(AuditEvent)
            .where(AuditEvent.session_id == session_id)
            .order_by(AuditEvent.sequence_num.asc())
        )
        return list(db.scalars(stmt).all())

    @staticmethod
    def verify_session_audit_trail(db: Session, session_id: uuid.UUID) -> AuditVerificationResult:
        """Run cryptographic integrity verification on the session's audit ledger."""
        events = SessionService.get_session_audit_trail(db, session_id)
        return verify_audit_ledger(events, expected_session_id=session_id)

    @staticmethod
    def submit_session_for_review(
        db: Session,
        session_id: uuid.UUID,
        actor_id: str,
        notes: Optional[str] = None,
        client_operation_id: Optional[uuid.UUID] = None,
    ) -> MeasurementSession:
        """Submit a draft measurement session for peer review."""
        try:
            stmt = (
                select(MeasurementSession)
                .where(MeasurementSession.id == session_id)
                .with_for_update()
            )
            session = db.scalar(stmt)
            if not session:
                raise SessionNotFoundError(session_id)

            SessionStateMachine.check_immutability(session)
            if session.status in ("needs_review", "submitted", "in_review"):
                raise ValueError("Session has already been submitted for review.")

            now = datetime.now(timezone.utc)
            old_status = session.status
            session.status = "needs_review"
            session.version += 1
            session.updated_at = now

            append_audit_event(
                db=db,
                session_id=session.id,
                event_type="SESSION_SUBMITTED_FOR_REVIEW",
                actor_id=actor_id,
                event_summary=f"Session submitted for peer review (status: {old_status} -> needs_review)",
                affected_field="session.status",
                before_value=old_status,
                after_value="needs_review",
                payload={
                    "session_id": str(session.id),
                    "version": session.version,
                    "notes": notes,
                },
                client_operation_id=client_operation_id,
                timestamp=now,
            )

            db.commit()
            db.refresh(session)
            return session
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def record_session_review(
        db: Session,
        session_id: uuid.UUID,
        reviewer_id: str,
        review_status: str,
        expected_version: int,
        comments: Optional[str] = None,
        checklist_snapshot: Optional[Dict[str, Any]] = None,
        client_operation_id: Optional[uuid.UUID] = None,
    ) -> SessionReview:
        """Record an authoritative peer review decision on a session."""
        try:
            stmt = (
                select(MeasurementSession)
                .where(MeasurementSession.id == session_id)
                .with_for_update()
            )
            session = db.scalar(stmt)
            if not session:
                raise SessionNotFoundError(session_id)

            SessionStateMachine.check_immutability(session)

            if session.status not in ("needs_review", "submitted", "in_review"):
                raise ValueError("Session must be in 'needs_review' status before a review decision can be recorded.")

            if session.version != expected_version:
                raise ConcurrencyConflictError(session_id, expected_version, session.version)

            now = datetime.now(timezone.utc)
            review = SessionReview(
                session_id=session.id,
                reviewer_id=reviewer_id,
                status=review_status,
                comments=comments,
                checklist_snapshot=checklist_snapshot,
                signed_at=now,
            )
            db.add(review)

            old_session_status = session.status
            if review_status == "approved":
                session.status = "approved"
            elif review_status == "rejected":
                session.status = "draft"
            session.version += 1
            session.updated_at = now

            append_audit_event(
                db=db,
                session_id=session.id,
                event_type="SESSION_REVIEW_DECIDED",
                actor_id=reviewer_id,
                event_summary=f"Review decision '{review_status}' recorded by reviewer {reviewer_id}",
                affected_field="session.status",
                before_value=old_session_status,
                after_value=session.status,
                payload={
                    "session_id": str(session.id),
                    "review_status": review_status,
                    "comments": comments,
                    "version": session.version,
                },
                client_operation_id=client_operation_id,
                timestamp=now,
            )

            db.commit()
            db.refresh(review)
            return review
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def finalize_session(
        db: Session,
        session_id: uuid.UUID,
        actor_id: str,
        expected_version: int,
        supervisor_notes: Optional[str] = None,
        confirm_provisional_policy: bool = False,
        client_operation_id: Optional[uuid.UUID] = None,
    ) -> MeasurementSession:
        """Finalize an approved session into a permanently locked, read-only record."""
        try:
            stmt = (
                select(MeasurementSession)
                .where(MeasurementSession.id == session_id)
                .with_for_update()
            )
            session = db.scalar(stmt)
            if not session:
                raise SessionNotFoundError(session_id)

            SessionStateMachine.check_immutability(session)
            SessionStateMachine.validate_finalization_readiness(
                session, confirm_provisional_policy=confirm_provisional_policy
            )

            if session.version != expected_version:
                raise ConcurrencyConflictError(session_id, expected_version, session.version)

            now = datetime.now(timezone.utc)
            old_status = session.status
            session.status = SessionState.FINALIZED.value
            session.version += 1
            session.updated_at = now
            if not session.supervisor_id:
                session.supervisor_id = actor_id

            append_audit_event(
                db=db,
                session_id=session.id,
                event_type="SESSION_FINALIZED",
                actor_id=actor_id,
                event_summary=f"Measurement session finalized and locked (status: {old_status} -> finalized)",
                affected_field="session.status",
                before_value=old_status,
                after_value=SessionState.FINALIZED.value,
                payload={
                    "session_id": str(session.id),
                    "version": session.version,
                    "supervisor_notes": supervisor_notes,
                    "confirm_provisional_policy": confirm_provisional_policy,
                    "pre_cal_working_constant": str(session.pre_cal_working_constant) if session.pre_cal_working_constant else None,
                    "final_working_constant": str(session.final_working_constant) if session.final_working_constant else None,
                },
                client_operation_id=client_operation_id,
                timestamp=now,
            )

            db.commit()
            db.refresh(session)
            return session
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def create_session_revision(
        db: Session,
        session_id: uuid.UUID,
        revision_reason: str,
        actor_id: str,
        client_operation_id: Optional[uuid.UUID] = None,
    ) -> Tuple[MeasurementSession, MeasurementSession]:
        """Create a formal revision of a finalized session.
        
        The parent session is marked as 'superseded' and linked to the new child.
        The child session is created in 'draft' status with all parameters and readings
        copied from the parent, with supersedes_id pointing to parent.
        """
        if not revision_reason or len(revision_reason.strip()) < 10:
            raise ValueError("A detailed revision reason of at least 10 characters is required.")

        try:
            stmt = (
                select(MeasurementSession)
                .where(MeasurementSession.id == session_id)
                .with_for_update()
            )
            parent = db.scalar(stmt)
            if not parent:
                raise SessionNotFoundError(session_id)

            if parent.status != SessionState.FINALIZED.value:
                raise ValueError(
                    f"Only finalized sessions can be revised. Current status of session '{session_id}' is '{parent.status}'."
                )

            now = datetime.now(timezone.utc)
            child_id = uuid.uuid4()

            rev_name = f"{parent.name} (Rev)" if "(Rev" not in parent.name else f"{parent.name}.1"

            child = MeasurementSession(
                id=child_id,
                version=1,
                schema_version=parent.schema_version,
                status=SessionState.DRAFT.value,
                name=rev_name,
                description=parent.description,
                measurer_id=actor_id,
                supervisor_id=None,
                course_name=parent.course_name,
                course_length_m=parent.course_length_m,
                course_length_unit=parent.course_length_unit,
                surface_type=parent.surface_type,
                temperature_c=parent.temperature_c,
                rollover_mode=parent.rollover_mode,
                max_reading=parent.max_reading,
                constant_selection_rule=parent.constant_selection_rule,
                working_spec_version=parent.working_spec_version,
                policy_approval_status=parent.policy_approval_status,
                pre_cal_working_constant=parent.pre_cal_working_constant,
                post_cal_working_constant=parent.post_cal_working_constant,
                final_working_constant=parent.final_working_constant,
                cal_drift_percent=parent.cal_drift_percent,
                course_distance_km=parent.course_distance_km,
                calculation_engine_version=parent.calculation_engine_version,
                is_provisional=parent.is_provisional,
                policy_notice=parent.policy_notice,
                supersedes_id=parent.id,
                superseded_by_id=None,
                revision_reason=revision_reason.strip(),
                created_at=now,
                updated_at=now,
            )
            db.add(child)
            db.flush()

            # Copy parent rides to child
            for pr in parent.rides:
                new_ride = SessionRide(
                    id=uuid.uuid4(),
                    session_id=child.id,
                    ride_type=pr.ride_type,
                    ride_number=pr.ride_number,
                    start_count=pr.start_count,
                    finish_count=pr.finish_count,
                    count_delta=pr.count_delta,
                    is_linked=pr.is_linked,
                    is_linked_override=pr.is_linked_override,
                    override_reason=pr.override_reason,
                    adjustment=pr.adjustment,
                    created_at=now,
                )
                db.add(new_ride)
                db.flush()

                if pr.is_linked_override and pr.override_reason:
                    new_override = SessionOverride(
                        id=uuid.uuid4(),
                        session_id=child.id,
                        ride_id=new_ride.id,
                        field_name="start_count",
                        original_value=None,
                        replacement_value=str(pr.start_count),
                        reason=pr.override_reason,
                        actor_id=actor_id,
                        created_at=now,
                    )
                    db.add(new_override)

            # Update parent to superseded
            parent_old_status = parent.status
            parent.status = SessionState.SUPERSEDED.value
            parent.superseded_by_id = child.id
            parent.version += 1
            parent.updated_at = now

            # Audit event on parent: SESSION_SUPERSEDED
            append_audit_event(
                db=db,
                session_id=parent.id,
                event_type="SESSION_SUPERSEDED",
                actor_id=actor_id,
                event_summary=f"Finalized session superseded by formal revision child '{child.name}' ({child.id})",
                affected_field="session.status",
                before_value=parent_old_status,
                after_value=SessionState.SUPERSEDED.value,
                override_reason=revision_reason.strip(),
                payload={
                    "parent_session_id": str(parent.id),
                    "child_session_id": str(child.id),
                    "revision_reason": revision_reason.strip(),
                    "parent_new_version": parent.version,
                },
                client_operation_id=client_operation_id,
                timestamp=now,
            )

            # Audit event on child: SESSION_REVISION_CREATED
            append_audit_event(
                db=db,
                session_id=child.id,
                event_type="SESSION_REVISION_CREATED",
                actor_id=actor_id,
                event_summary=f"Created formal revision child from superseded parent '{parent.name}' ({parent.id})",
                affected_field="session.supersedes_id",
                before_value=None,
                after_value=str(parent.id),
                override_reason=revision_reason.strip(),
                payload={
                    "child_session_id": str(child.id),
                    "parent_session_id": str(parent.id),
                    "revision_reason": revision_reason.strip(),
                },
                client_operation_id=client_operation_id,
                timestamp=now,
            )

            db.commit()
            db.refresh(child)
            db.refresh(parent)
            return child, parent
        except Exception:
            db.rollback()
            raise

    @staticmethod
    def get_session_lineage(
        db: Session,
        session_id: uuid.UUID,
    ) -> Tuple[List[MeasurementSession], List[MeasurementSession]]:
        """Retrieve the ordered ancestors and descendants of a session."""
        session = SessionService.get_session(db, session_id)
        if not session:
            raise SessionNotFoundError(session_id)

        ancestors: List[MeasurementSession] = []
        curr = session
        visited_ancestors: set = {session.id}
        while curr.supersedes_id:
            parent = SessionService.get_session(db, curr.supersedes_id)
            if not parent or parent.id in visited_ancestors:
                break
            ancestors.append(parent)
            visited_ancestors.add(parent.id)
            curr = parent

        descendants: List[MeasurementSession] = []
        curr = session
        visited_descendants: set = {session.id}
        while curr.superseded_by_id:
            child = SessionService.get_session(db, curr.superseded_by_id)
            if not child or child.id in visited_descendants:
                break
            descendants.append(child)
            visited_descendants.add(child.id)
            curr = child

        return ancestors, descendants

    @staticmethod
    def migrate_legacy_session(
        db: Session,
        payload: Dict[str, Any],
        actor_id: str,
        measurer_override: Optional[str] = None,
        dry_run: bool = True,
        client_operation_id: Optional[uuid.UUID] = None,
    ) -> Tuple[Dict[str, Any], Optional[MeasurementSession]]:
        """Ingest legacy JSON backup, recompute authoritative values, detect discrepancies,
        and optionally persist to PostgreSQL.
        """
        raw_session = payload.get("session", payload)
        ref_name = raw_session.get("reference") or raw_session.get("name") or "Migrated Session"
        course_len_raw = raw_session.get("courseLength") or raw_session.get("course_length_m", "1000")
        course_len = Decimal(str(course_len_raw))
        measurer = measurer_override or raw_session.get("operator") or actor_id

        rollover_mode_raw = raw_session.get("rolloverMode") or "none"
        if rollover_mode_raw == "wrap":
            rollover_mode_str = "rollover_6digit"
        elif rollover_mode_raw == "notConfigured":
            rollover_mode_str = "not_configured"
        else:
            rollover_mode_str = "none"

        max_read = int(raw_session["rolloverMax"]) if raw_session.get("rolloverMax") else None

        # Build rides list
        rides_data: List[SessionRideCreateSchema] = []
        raw_pre = raw_session.get("pre", [])
        for idx, r in enumerate(raw_pre):
            start = int(r.get("start") or 0)
            finish = int(r.get("finish") or 0)
            overridden = bool(r.get("startOverridden") or r.get("is_linked_override", False))
            reason = r.get("overrideReason") or r.get("override_reason")
            if finish > 0 or start > 0:
                rides_data.append(
                    SessionRideCreateSchema(
                        ride_type="pre_calibration",
                        ride_number=idx + 1,
                        start_count=start,
                        finish_count=finish,
                        is_linked_override=overridden,
                        override_reason=reason if overridden else None,
                    )
                )

        (
            pre_wc,
            post_wc,
            final_wc,
            eng_ver,
            is_prov,
            policy_note,
            resolved_rides,
        ) = _recompute_session_calculations(
            course_length_m=course_len,
            rollover_mode_str=rollover_mode_str,
            max_reading=max_read,
            rides_data=rides_data,
        )

        # Detect discrepancies against legacy logged calculations
        discrepancies: List[Dict[str, Any]] = []
        logged = raw_session.get("logged", {})
        legacy_pre_wc = logged.get("preWC") or raw_session.get("pre_cal_working_constant")
        if legacy_pre_wc and pre_wc is not None:
            try:
                diff = abs(Decimal(str(legacy_pre_wc)) - pre_wc)
                if diff > Decimal("0.0001"):
                    discrepancies.append({
                        "field": "pre_cal_working_constant",
                        "legacy_value": str(legacy_pre_wc),
                        "authoritative_value": str(pre_wc),
                        "delta": str(diff),
                    })
            except Exception:
                pass

        authoritative_calcs = {
            "pre_cal_working_constant": str(pre_wc) if pre_wc else None,
            "post_cal_working_constant": str(post_wc) if post_wc else None,
            "final_working_constant": str(final_wc) if final_wc else None,
            "calculation_engine_version": eng_ver,
            "is_provisional": is_prov,
        }

        report = {
            "success": True,
            "dry_run": dry_run,
            "session_id": None,
            "session_name": ref_name,
            "reference": ref_name,
            "discrepancy_count": len(discrepancies),
            "discrepancies": discrepancies,
            "authoritative_calculations": authoritative_calcs,
        }

        if dry_run:
            return report, None

        # Persist session if not dry run
        try:
            now = datetime.now(timezone.utc)
            session_id = uuid.uuid4()
            session = MeasurementSession(
                id=session_id,
                version=1,
                schema_version=1,
                status=SessionState.DRAFT.value,
                name=ref_name,
                description=f"Migrated legacy session {ref_name}",
                measurer_id=measurer,
                course_length_m=course_len,
                course_length_unit="m",
                rollover_mode=rollover_mode_str,
                max_reading=max_read,
                constant_selection_rule="larger",
                working_spec_version=raw_session.get("ruleSet", "ws-0.3-provisional"),
                policy_approval_status="provisional",
                pre_cal_working_constant=pre_wc,
                post_cal_working_constant=post_wc,
                final_working_constant=final_wc,
                calculation_engine_version=eng_ver,
                is_provisional=is_prov,
                policy_notice=policy_note,
                created_at=now,
                updated_at=now,
            )
            db.add(session)
            db.flush()

            # Insert rides
            resolved_map = {r["ride_number"]: r for r in resolved_rides}
            for r_in in rides_data:
                res_info = resolved_map.get(r_in.ride_number, {})
                ride_delta = res_info.get("count", r_in.finish_count - r_in.start_count)
                is_linked = res_info.get("linked", True)
                adj = res_info.get("adjustment", 0)

                ride_obj = SessionRide(
                    id=uuid.uuid4(),
                    session_id=session_id,
                    ride_type=r_in.ride_type,
                    ride_number=r_in.ride_number,
                    start_count=r_in.start_count,
                    finish_count=r_in.finish_count,
                    count_delta=ride_delta,
                    is_linked=is_linked,
                    is_linked_override=r_in.is_linked_override,
                    override_reason=r_in.override_reason,
                    adjustment=adj,
                    created_at=now,
                )
                db.add(ride_obj)
                db.flush()

                if r_in.is_linked_override and r_in.override_reason:
                    override_obj = SessionOverride(
                        id=uuid.uuid4(),
                        session_id=session_id,
                        ride_id=ride_obj.id,
                        field_name="start_count",
                        original_value=None,
                        replacement_value=str(r_in.start_count),
                        reason=r_in.override_reason,
                        actor_id=actor_id,
                        created_at=now,
                    )
                    db.add(override_obj)

            # Genesis audit event for migration
            append_audit_event(
                db=db,
                session_id=session_id,
                event_type="SESSION_MIGRATED",
                actor_id=actor_id,
                event_summary=f"Migrated legacy session '{ref_name}' with {len(rides_data)} rides and {len(discrepancies)} discrepancies.",
                payload={
                    "session_id": str(session_id),
                    "discrepancy_count": len(discrepancies),
                    "pre_cal_working_constant": str(pre_wc) if pre_wc else None,
                    "legacy_migrated": True,
                },
                client_operation_id=client_operation_id,
                timestamp=now,
            )

            db.commit()
            db.refresh(session)
            report["session_id"] = session.id
            return report, session
        except Exception:
            db.rollback()
            raise



