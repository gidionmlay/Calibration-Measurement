"""Authoritative Session Lifecycle State Machine and Finalization Guards.

Enforces deterministic lifecycle transitions, immutability of finalized
and superseded records, peer-review prerequisites, and provisional policy guards.
"""

from enum import Enum
from typing import Set, Dict, List, Optional
from app.models.session import MeasurementSession


class SessionState(str, Enum):
    """Authoritative lifecycle states for measurement sessions."""
    DRAFT = "draft"
    IN_PROGRESS = "in_progress"
    NEEDS_REVIEW = "needs_review"
    READY_FOR_FINAL_REVIEW = "ready_for_final_review"
    APPROVED = "approved"  # Equivalent to ready_for_final_review
    FINALIZED = "finalized"
    SUPERSEDED = "superseded"


class StateMachineError(Exception):
    """Base exception for lifecycle state machine errors."""
    pass


class InvalidStateTransitionError(StateMachineError):
    """Raised when an illegal lifecycle state transition is attempted."""
    def __init__(self, from_state: str, to_state: str, reason: Optional[str] = None):
        self.from_state = from_state
        self.to_state = to_state
        msg = f"Invalid state transition from '{from_state}' to '{to_state}'."
        if reason:
            msg += f" Reason: {reason}"
        super().__init__(msg)


class SessionImmutableError(StateMachineError):
    """Raised when an edit, deletion, or review is attempted on an immutable session."""
    def __init__(self, session_id: str, status: str):
        self.session_id = session_id
        self.status = status
        super().__init__(
            f"Session '{session_id}' has status '{status}' and is strictly immutable. "
            "Modifications require creating a linked formal revision."
        )


class FinalizationBlockerError(StateMachineError):
    """Raised when session finalization criteria are not satisfied."""
    def __init__(self, session_id: str, blockers: List[str]):
        self.session_id = session_id
        self.blockers = blockers
        super().__init__(
            f"Cannot finalize session '{session_id}': {'; '.join(blockers)}"
        )


class PolicyRatificationError(StateMachineError):
    """Raised when an unratified measurement policy blocks official certification."""
    def __init__(self, policy_status: str, spec_version: str):
        self.policy_status = policy_status
        self.spec_version = spec_version
        super().__init__(
            f"Policy ratification blocker: specification '{spec_version}' has status '{policy_status}'. "
            "Governing measurement policies MP-01 through MP-09 are unratified. "
            "Formal certification is blocked; explicit provisional confirmation is required."
        )


class SessionStateMachine:
    """State machine governing session transitions and immutability."""

    # Map of allowed transitions from each state
    ALLOWED_TRANSITIONS: Dict[str, Set[str]] = {
        SessionState.DRAFT.value: {
            SessionState.IN_PROGRESS.value,
            SessionState.NEEDS_REVIEW.value,
        },
        SessionState.IN_PROGRESS.value: {
            SessionState.DRAFT.value,
            SessionState.NEEDS_REVIEW.value,
        },
        SessionState.NEEDS_REVIEW.value: {
            SessionState.READY_FOR_FINAL_REVIEW.value,
            SessionState.APPROVED.value,
            SessionState.DRAFT.value,  # On review rejection or reading modification
        },
        SessionState.READY_FOR_FINAL_REVIEW.value: {
            SessionState.FINALIZED.value,
            SessionState.NEEDS_REVIEW.value,  # If upstream reading changed
            SessionState.DRAFT.value,  # If supervisor rejects
        },
        SessionState.APPROVED.value: {
            SessionState.FINALIZED.value,
            SessionState.NEEDS_REVIEW.value,
            SessionState.DRAFT.value,
        },
        SessionState.FINALIZED.value: {
            SessionState.SUPERSEDED.value,  # Only via formal revision creation
        },
        SessionState.SUPERSEDED.value: set(),  # Terminal state
    }

    @classmethod
    def can_transition(cls, from_state: str, to_state: str) -> bool:
        """Check if transition from one state to another is permitted."""
        allowed = cls.ALLOWED_TRANSITIONS.get(from_state.lower(), set())
        return to_state.lower() in allowed

    @classmethod
    def validate_transition(cls, from_state: str, to_state: str) -> None:
        """Validate that a state transition is legal, raising InvalidStateTransitionError if not."""
        if not cls.can_transition(from_state, to_state):
            raise InvalidStateTransitionError(from_state, to_state)

    @classmethod
    def check_immutability(cls, session: MeasurementSession) -> None:
        """Ensure session is in an editable state; raises SessionImmutableError if locked."""
        status_norm = (session.status or "").lower()
        if status_norm in (SessionState.FINALIZED.value, SessionState.SUPERSEDED.value):
            raise SessionImmutableError(str(session.id), session.status)

    @classmethod
    def validate_finalization_readiness(
        cls,
        session: MeasurementSession,
        confirm_provisional_policy: bool = False,
    ) -> None:
        """Evaluate all strict finalization guards before allowing a session to lock.
        
        Guards:
        1. Lifecycle state must be 'ready_for_final_review' or 'approved'.
        2. Valid calibration course length (> 0).
        3. Pre-calibration ride completion: at least 4 valid rides.
        4. Overrides completeness: all overridden readings must have a mandatory reason.
        5. Independent peer review: must have at least one active (non-invalidated) approved review.
        6. Policy ratification check: if unapproved policies MP-01..MP-09 are active,
           confirm_provisional_policy must be True (acknowledging provisional pilot status).
        """
        blockers: List[str] = []

        # 1. State check
        status_norm = (session.status or "").lower()
        if status_norm not in (SessionState.READY_FOR_FINAL_REVIEW.value, SessionState.APPROVED.value):
            blockers.append(
                f"Session must be in '{SessionState.READY_FOR_FINAL_REVIEW.value}' or '{SessionState.APPROVED.value}' state "
                f"(current status is '{session.status}')"
            )

        # 2. Course length
        if not session.course_length_m or session.course_length_m <= 0:
            blockers.append("Calibration course length must be strictly positive")

        # 3. Pre-calibration rides
        pre_rides = [r for r in session.rides if r.ride_type == "pre_calibration"]
        if len(pre_rides) < 4:
            blockers.append(f"At least 4 pre-calibration rides are required (found {len(pre_rides)})")

        # 4. Linked start override reasons
        for r in session.rides:
            if r.is_linked_override:
                if not r.override_reason or len(r.override_reason.strip()) < 3:
                    blockers.append(f"Ride {r.ride_number} has an override without a valid reason string")

        # 5. Peer review check
        approved_reviews = [
            rev for rev in session.reviews
            if rev.status == "approved" and not rev.is_invalidated
        ]
        if not approved_reviews:
            blockers.append("An active, non-invalidated approved peer review is required before finalization")

        # If any primary blockers exist, raise immediately
        if blockers:
            raise FinalizationBlockerError(str(session.id), blockers)

        # 6. Policy ratification guard
        is_unapproved = (session.policy_approval_status or "").lower() in ("unapproved", "provisional")
        if is_unapproved and not confirm_provisional_policy:
            raise PolicyRatificationError(
                policy_status=session.policy_approval_status,
                spec_version=session.working_spec_version,
            )

