"""Session persistence, review workflow, and audit ledger API routes."""

import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.session import MeasurementSession
from app.models.user import User
from app.auth.rbac import (
    RBACService,
    SystemRoles,
    SystemPermissions,
    require_permission,
)
from app.services.session_service import (
    SessionService,
    SessionNotFoundError,
    ConcurrencyConflictError,
)
from app.domain.state_machine import (
    SessionImmutableError,
    FinalizationBlockerError,
    PolicyRatificationError,
    InvalidStateTransitionError,
)
from app.schemas.session import (
    SessionCreateRequest,
    SessionUpdateRequest,
    SessionSubmitRequest,
    SessionReviewCreateRequest,
    SessionFinalizeRequest,
    SessionRevisionCreateRequest,
    SessionLineageResponseSchema,
    SessionMigrationRequest,
    MigrationResponseSchema,
    SessionResponseSchema,
    SessionRideResponseSchema,
    SessionReviewResponseSchema,
)
from app.schemas.audit import (
    AuditEventResponseSchema,
    AuditVerificationResponseSchema,
)
from app.schemas.calculations import ProblemDetail

router = APIRouter(prefix="/sessions", tags=["Sessions"])


@router.post(
    "",
    response_model=SessionResponseSchema,
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        422: {"model": ProblemDetail, "description": "Validation or Calculation Error"},
    },
    summary="Create Measurement Session",
)
def create_session_endpoint(
    request: SessionCreateRequest,
    x_operation_id: Optional[uuid.UUID] = Header(default=None, alias="X-Operation-ID"),
    current_user: User = Depends(require_permission(SystemPermissions.SESSION_CREATE)),
    db: Session = Depends(get_db),
) -> SessionResponseSchema:
    """Create a persistent measurement session, persist raw rides, compute derived metrics,
    and append a genesis audit event attributed to the authenticated user UUID.
    """
    user_roles = RBACService.get_user_role_names(db, current_user.id)
    is_elevated = bool(user_roles.intersection({SystemRoles.ADMIN, SystemRoles.SUPERVISOR}))
    # Non-elevated measurers are strictly bound to their own authenticated user ID
    measurer_id = (request.measurer_id or str(current_user.id)) if is_elevated else str(current_user.id)

    try:
        session = SessionService.create_session(
            db=db,
            session_in=request,
            actor_id=str(current_user.id),
            measurer_id=measurer_id,
            client_operation_id=x_operation_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return _build_session_response(session)


@router.get(
    "/{session_id}",
    response_model=SessionResponseSchema,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        404: {"model": ProblemDetail, "description": "Session Not Found"},
    },
    summary="Get Measurement Session",
)
def get_session_endpoint(
    session_id: uuid.UUID,
    current_user: User = Depends(require_permission(SystemPermissions.SESSION_READ)),
    db: Session = Depends(get_db),
) -> SessionResponseSchema:
    """Retrieve a persistent session and its associated rides, reviews, and calculations."""
    session = SessionService.get_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Measurement session '{session_id}' was not found.",
        )
    RBACService.check_session_read_access(db, current_user, session)
    return _build_session_response(session)


@router.put(
    "/{session_id}",
    response_model=SessionResponseSchema,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission / Ownership Violation"},
        404: {"model": ProblemDetail, "description": "Session Not Found"},
        409: {"model": ProblemDetail, "description": "Concurrency Conflict or Workflow Immutability"},
        422: {"model": ProblemDetail, "description": "Validation or Calculation Error"},
    },
    summary="Update Measurement Session",
)
def update_session_endpoint(
    session_id: uuid.UUID,
    request: SessionUpdateRequest,
    x_operation_id: Optional[uuid.UUID] = Header(default=None, alias="X-Operation-ID"),
    current_user: User = Depends(require_permission(SystemPermissions.SESSION_UPDATE_DRAFT)),
    db: Session = Depends(get_db),
) -> SessionResponseSchema:
    """Atomically update session readings, recompute calculations, invalidate reviews,
    enforce optimistic concurrency, check write access & workflow state, and append audit events.
    """
    session = SessionService.get_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Measurement session '{session_id}' was not found.",
        )

    # Enforce workflow state constraints and measurer ownership boundaries
    RBACService.check_session_write_access(db, current_user, session)

    try:
        updated_session = SessionService.update_session(
            db=db,
            session_id=session_id,
            update_in=request,
            actor_id=str(current_user.id),
            client_operation_id=x_operation_id,
        )
    except SessionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except SessionImmutableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ConcurrencyConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return _build_session_response(updated_session)


@router.post(
    "/{session_id}/submit",
    response_model=SessionResponseSchema,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        404: {"model": ProblemDetail, "description": "Session Not Found"},
        409: {"model": ProblemDetail, "description": "Conflict / Invalid Workflow State"},
    },
    summary="Submit Session for Peer Review",
)
def submit_session_endpoint(
    session_id: uuid.UUID,
    payload: SessionSubmitRequest = SessionSubmitRequest(),
    x_operation_id: Optional[uuid.UUID] = Header(default=None, alias="X-Operation-ID"),
    current_user: User = Depends(require_permission(SystemPermissions.SESSION_SUBMIT_REVIEW)),
    db: Session = Depends(get_db),
) -> SessionResponseSchema:
    """Submit a draft session for peer review, locking it from direct modification."""
    session = SessionService.get_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Measurement session '{session_id}' was not found.",
        )

    RBACService.check_session_write_access(db, current_user, session)

    try:
        updated_session = SessionService.submit_session_for_review(
            db=db,
            session_id=session_id,
            actor_id=str(current_user.id),
            notes=payload.notes,
            client_operation_id=x_operation_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return _build_session_response(updated_session)


@router.post(
    "/{session_id}/reviews",
    response_model=SessionReviewResponseSchema,
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Separation of Duties Violation"},
        404: {"model": ProblemDetail, "description": "Session Not Found"},
        409: {"model": ProblemDetail, "description": "Conflict / Session Finalized"},
    },
    summary="Record Peer Review Decision",
)
def record_review_endpoint(
    session_id: uuid.UUID,
    payload: SessionReviewCreateRequest,
    x_operation_id: Optional[uuid.UUID] = Header(default=None, alias="X-Operation-ID"),
    current_user: User = Depends(require_permission(SystemPermissions.REVIEW_DECIDE)),
    db: Session = Depends(get_db),
) -> SessionReviewResponseSchema:
    """Record an authoritative review decision (approval or rejection) on a measurement session.
    
    Enforces Separation of Duties:
    A user cannot review a session that they measured.
    """
    session = SessionService.get_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Measurement session '{session_id}' was not found.",
        )

    # Enforce read access and strict separation of duties
    RBACService.check_session_read_access(db, current_user, session)
    RBACService.check_separation_of_duties(current_user.id, session)

    try:
        review = SessionService.record_session_review(
            db=db,
            session_id=session_id,
            reviewer_id=str(current_user.id),
            review_status=payload.status,
            expected_version=payload.expected_version,
            comments=payload.comments,
            checklist_snapshot=payload.checklist_snapshot,
            client_operation_id=x_operation_id,
        )
    except ConcurrencyConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return SessionReviewResponseSchema(
        id=review.id,
        reviewer_id=review.reviewer_id,
        status=review.status,
        comments=review.comments,
        signed_at=review.signed_at,
        is_invalidated=review.is_invalidated,
        invalidated_at=review.invalidated_at,
        invalidation_reason=review.invalidation_reason,
    )


@router.get(
    "/{session_id}/audit-trail",
    response_model=List[AuditEventResponseSchema],
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        404: {"model": ProblemDetail, "description": "Session Not Found"},
    },
    summary="Get Session Audit Trail",
)
def get_audit_trail_endpoint(
    session_id: uuid.UUID,
    current_user: User = Depends(require_permission(SystemPermissions.AUDIT_READ)),
    db: Session = Depends(get_db),
) -> List[AuditEventResponseSchema]:
    """Retrieve the cryptographically chained append-only audit trail for a session."""
    session = SessionService.get_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Measurement session '{session_id}' was not found.",
        )
    RBACService.check_session_read_access(db, current_user, session)
    events = SessionService.get_session_audit_trail(db, session_id)
    return [
        AuditEventResponseSchema(
            id=ev.id,
            session_id=ev.session_id,
            sequence_num=ev.sequence_num,
            event_type=ev.event_type,
            actor_id=ev.actor_id,
            client_operation_id=ev.client_operation_id,
            timestamp=ev.timestamp,
            event_summary=ev.event_summary,
            affected_field=ev.affected_field,
            before_value=ev.before_value,
            after_value=ev.after_value,
            override_reason=ev.override_reason,
            payload=ev.payload,
            previous_event_hash=ev.previous_event_hash,
            event_hash=ev.event_hash,
        )
        for ev in events
    ]


@router.post(
    "/{session_id}/verify-audit",
    response_model=AuditVerificationResponseSchema,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        404: {"model": ProblemDetail, "description": "Session Not Found"},
    },
    summary="Verify Session Audit Integrity",
)
def verify_audit_endpoint(
    session_id: uuid.UUID,
    current_user: User = Depends(require_permission(SystemPermissions.AUDIT_VERIFY)),
    db: Session = Depends(get_db),
) -> AuditVerificationResponseSchema:
    """Verify cryptographic hash links, sequence continuity, and tamper detection on audit ledger."""
    session = SessionService.get_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Measurement session '{session_id}' was not found.",
        )
    RBACService.check_session_read_access(db, current_user, session)
    result = SessionService.verify_session_audit_trail(db, session_id)
    return AuditVerificationResponseSchema(
        is_valid=result.is_valid,
        total_events=result.total_events,
        verified_events=result.verified_events,
        errors=result.errors,
    )


@router.post(
    "/{session_id}/finalize",
    response_model=SessionResponseSchema,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        404: {"model": ProblemDetail, "description": "Session Not Found"},
        409: {"model": ProblemDetail, "description": "Conflict / Version Mismatch or Already Finalized"},
        422: {"model": ProblemDetail, "description": "Finalization Blockers or Unratified Policy Blocker"},
    },
    summary="Finalize Measurement Session",
)
def finalize_session_endpoint(
    session_id: uuid.UUID,
    payload: SessionFinalizeRequest,
    x_operation_id: Optional[uuid.UUID] = Header(default=None, alias="X-Operation-ID"),
    current_user: User = Depends(require_permission(SystemPermissions.REVIEW_DECIDE)),
    db: Session = Depends(get_db),
) -> SessionResponseSchema:
    """Finalize an approved session into a permanently locked, immutable record.
    
    Enforces zero blockers, approved peer review, and policy ratification checks.
    """
    session = SessionService.get_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Measurement session '{session_id}' was not found.",
        )

    RBACService.check_session_read_access(db, current_user, session)

    try:
        finalized_session = SessionService.finalize_session(
            db=db,
            session_id=session_id,
            actor_id=str(current_user.id),
            expected_version=payload.expected_version,
            supervisor_notes=payload.supervisor_notes,
            confirm_provisional_policy=payload.confirm_provisional_policy,
            client_operation_id=x_operation_id,
        )
    except SessionNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except SessionImmutableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except ConcurrencyConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except (FinalizationBlockerError, PolicyRatificationError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return _build_session_response(finalized_session)


@router.post(
    "/{session_id}/revisions",
    response_model=SessionResponseSchema,
    status_code=status.HTTP_201_CREATED,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        404: {"model": ProblemDetail, "description": "Parent Session Not Found"},
        422: {"model": ProblemDetail, "description": "Parent Not Finalized or Invalid Reason"},
    },
    summary="Create Formal Session Revision",
)
def create_revision_endpoint(
    session_id: uuid.UUID,
    payload: SessionRevisionCreateRequest,
    x_operation_id: Optional[uuid.UUID] = Header(default=None, alias="X-Operation-ID"),
    current_user: User = Depends(require_permission(SystemPermissions.SESSION_CREATE)),
    db: Session = Depends(get_db),
) -> SessionResponseSchema:
    """Create a linked revision child draft from a finalized parent session, marking parent as superseded."""
    parent = SessionService.get_session(db, session_id)
    if not parent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parent measurement session '{session_id}' was not found.",
        )

    RBACService.check_session_read_access(db, current_user, parent)

    try:
        child_session, _ = SessionService.create_session_revision(
            db=db,
            session_id=session_id,
            revision_reason=payload.revision_reason,
            actor_id=str(current_user.id),
            client_operation_id=x_operation_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return _build_session_response(child_session)


@router.get(
    "/{session_id}/lineage",
    response_model=SessionLineageResponseSchema,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        404: {"model": ProblemDetail, "description": "Session Not Found"},
    },
    summary="Get Session Supersession Lineage",
)
def get_session_lineage_endpoint(
    session_id: uuid.UUID,
    current_user: User = Depends(require_permission(SystemPermissions.SESSION_READ)),
    db: Session = Depends(get_db),
) -> SessionLineageResponseSchema:
    """Retrieve full ancestor and descendant revision chain for a session."""
    session = SessionService.get_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Measurement session '{session_id}' was not found.",
        )

    RBACService.check_session_read_access(db, current_user, session)
    ancestors, descendants = SessionService.get_session_lineage(db, session_id)

    return SessionLineageResponseSchema(
        current_session_id=session_id,
        ancestors=[_build_session_response(s) for s in ancestors],
        descendants=[_build_session_response(s) for s in descendants],
    )


@router.post(
    "/migrate",
    response_model=MigrationResponseSchema,
    status_code=status.HTTP_200_OK,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden / Missing Permission"},
        422: {"model": ProblemDetail, "description": "Invalid Migration Payload"},
    },
    summary="Migrate Legacy JSON Session",
)
def migrate_session_endpoint(
    payload: SessionMigrationRequest,
    dry_run: bool = True,
    x_operation_id: Optional[uuid.UUID] = Header(default=None, alias="X-Operation-ID"),
    current_user: User = Depends(require_permission(SystemPermissions.SESSION_CREATE)),
    db: Session = Depends(get_db),
) -> MigrationResponseSchema:
    """Ingest legacy JSON session backups, recalculate authoritative figures, report discrepancies,
    and optionally persist to PostgreSQL.
    """
    try:
        report, _ = SessionService.migrate_legacy_session(
            db=db,
            payload=payload.payload,
            actor_id=str(current_user.id),
            measurer_override=payload.measurer_id,
            dry_run=dry_run,
            client_operation_id=x_operation_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Migration failed: {exc}",
        ) from exc

    return MigrationResponseSchema(**report)


def _build_session_response(session: MeasurementSession) -> SessionResponseSchema:
    """Helper to convert ORM model to Pydantic response schema."""
    return SessionResponseSchema(
        id=session.id,
        version=session.version,
        schema_version=session.schema_version,
        status=session.status,
        name=session.name,
        description=session.description,
        measurer_id=session.measurer_id,
        supervisor_id=session.supervisor_id,
        course_name=session.course_name,
        course_length_m=session.course_length_m,
        course_length_unit=session.course_length_unit,
        surface_type=session.surface_type,
        temperature_c=session.temperature_c,
        rollover_mode=session.rollover_mode,
        max_reading=session.max_reading,
        constant_selection_rule=session.constant_selection_rule,
        working_spec_version=session.working_spec_version,
        policy_approval_status=session.policy_approval_status,
        pre_cal_working_constant=session.pre_cal_working_constant,
        post_cal_working_constant=session.post_cal_working_constant,
        final_working_constant=session.final_working_constant,
        cal_drift_percent=session.cal_drift_percent,
        course_distance_km=session.course_distance_km,
        calculation_engine_version=session.calculation_engine_version,
        is_provisional=session.is_provisional,
        policy_notice=session.policy_notice,
        supersedes_id=session.supersedes_id,
        superseded_by_id=session.superseded_by_id,
        revision_reason=session.revision_reason,
        rides=[
            SessionRideResponseSchema(
                id=r.id,
                ride_type=r.ride_type,
                ride_number=r.ride_number,
                start_count=r.start_count,
                finish_count=r.finish_count,
                count_delta=r.count_delta,
                is_linked=r.is_linked,
                is_linked_override=r.is_linked_override,
                override_reason=r.override_reason,
                adjustment=r.adjustment,
                created_at=r.created_at,
            )
            for r in session.rides
        ],
        reviews=[
            SessionReviewResponseSchema(
                id=rev.id,
                reviewer_id=rev.reviewer_id,
                status=rev.status,
                comments=rev.comments,
                signed_at=rev.signed_at,
                is_invalidated=rev.is_invalidated,
                invalidated_at=rev.invalidated_at,
                invalidation_reason=rev.invalidation_reason,
            )
            for rev in session.reviews
        ],
        created_at=session.created_at,
        updated_at=session.updated_at,
    )
