"""Role-Based Access Control (RBAC) service and FastAPI dependencies.

Enforces deny-by-default access control, granular permissions,
session-level access boundaries, workflow state immutability,
and separation of duties.
"""

import uuid
from datetime import datetime, timezone
from typing import Callable, List, Optional, Set
from fastapi import Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.models.rbac import Role, Permission, UserRole
from app.models.session import MeasurementSession
from app.models.user import User


class SystemRoles:
    """Pre-defined system role names."""
    MEASURER = "measurer"
    REVIEWER = "reviewer"
    SUPERVISOR = "supervisor"
    AUDITOR = "auditor"
    ADMIN = "admin"

    ALL = {MEASURER, REVIEWER, SUPERVISOR, AUDITOR, ADMIN}


class SystemPermissions:
    """Pre-defined system capability permission codes."""
    SESSION_CREATE = "session:create"
    SESSION_READ = "session:read"
    SESSION_UPDATE_DRAFT = "session:update_draft"
    SESSION_SUBMIT_REVIEW = "session:submit_review"
    REVIEW_CREATE = "review:create"
    REVIEW_DECIDE = "review:decide"
    AUDIT_READ = "audit:read"
    AUDIT_VERIFY = "audit:verify"
    ROLE_MANAGE = "role:manage"
    CONFIG_MANAGE = "config:manage"

    ALL = {
        SESSION_CREATE,
        SESSION_READ,
        SESSION_UPDATE_DRAFT,
        SESSION_SUBMIT_REVIEW,
        REVIEW_CREATE,
        REVIEW_DECIDE,
        AUDIT_READ,
        AUDIT_VERIFY,
        ROLE_MANAGE,
        CONFIG_MANAGE,
    }


class RBACService:
    """Centralized authorization engine for role and permission resolution."""

    @staticmethod
    def get_active_user_roles(db: Session, user_id: uuid.UUID) -> List[Role]:
        """Retrieve all currently active Role entities assigned to a user."""
        assignments = (
            db.query(UserRole)
            .filter(UserRole.user_id == user_id, UserRole.revoked_at.is_(None))
            .all()
        )
        return [assignment.role for assignment in assignments if assignment.role]

    @staticmethod
    def get_user_role_names(db: Session, user_id: uuid.UUID) -> Set[str]:
        """Return the set of active role names (lowercased) assigned to a user."""
        roles = RBACService.get_active_user_roles(db, user_id)
        return {r.name.lower() for r in roles}

    @staticmethod
    def get_user_permissions(db: Session, user_id: uuid.UUID) -> Set[str]:
        """Aggregate effective permission codes across all active roles for a user."""
        roles = RBACService.get_active_user_roles(db, user_id)
        permissions: Set[str] = set()
        for role in roles:
            for perm in role.permissions:
                permissions.add(perm.code)
        return permissions

    @staticmethod
    def has_role(db: Session, user_id: uuid.UUID, role_name: str) -> bool:
        """Check whether the user possesses an active role assignment."""
        active_roles = RBACService.get_user_role_names(db, user_id)
        return role_name.strip().lower() in active_roles

    @staticmethod
    def has_permission(db: Session, user_id: uuid.UUID, permission_code: str) -> bool:
        """Check whether the user possesses an effective capability permission."""
        active_permissions = RBACService.get_user_permissions(db, user_id)
        return permission_code in active_permissions

    @staticmethod
    def assign_role(
        db: Session,
        target_user_id: uuid.UUID,
        role_name: str,
        assigned_by: Optional[uuid.UUID] = None,
        reason: Optional[str] = None,
    ) -> UserRole:
        """Assign an active security role to a user.
        
        Enforces:
        - Mandatory non-empty reason.
        - Target user existence.
        - Role existence.
        - Uniqueness: user cannot be assigned a role they already actively possess.
        - Graceful handling of concurrent assignments via IntegrityError conversion to 409 Conflict.
        """
        if not reason or not reason.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A non-empty administrative justification reason is required for role assignment.",
            )

        user = db.get(User, target_user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Target user '{target_user_id}' was not found.",
            )

        norm_role = role_name.strip().lower()
        role = db.query(Role).filter(Role.name == norm_role).first()
        if not role:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Role '{norm_role}' does not exist.",
            )

        # Check existing active assignment
        existing = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == target_user_id,
                UserRole.role_id == role.id,
                UserRole.revoked_at.is_(None),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"User already has an active assignment for role '{norm_role}'.",
            )

        assignment = UserRole(
            user_id=target_user_id,
            role_id=role.id,
            assigned_by=assigned_by,
            assignment_reason=reason.strip(),
        )
        db.add(assignment)
        try:
            db.commit()
            db.refresh(assignment)
            return assignment
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"User already has an active assignment for role '{norm_role}'.",
            ) from exc

    @staticmethod
    def revoke_role(
        db: Session,
        target_user_id: uuid.UUID,
        role_name: str,
        revoked_by: Optional[uuid.UUID] = None,
        reason: Optional[str] = None,
    ) -> UserRole:
        """Revoke an active role assignment from a user, preserving full audit history."""
        if not reason or not reason.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="A non-empty administrative revocation reason is required.",
            )

        user = db.get(User, target_user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Target user '{target_user_id}' was not found.",
            )

        norm_role = role_name.strip().lower()
        role = db.query(Role).filter(Role.name == norm_role).first()
        if not role:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Role '{norm_role}' does not exist.",
            )

        assignment = (
            db.query(UserRole)
            .filter(
                UserRole.user_id == target_user_id,
                UserRole.role_id == role.id,
                UserRole.revoked_at.is_(None),
            )
            .with_for_update()
            .first()
        )
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User does not have an active assignment for role '{norm_role}'.",
            )

        assignment.revoked_at = datetime.now(timezone.utc)
        assignment.assignment_reason = (
            f"{assignment.assignment_reason or ''} | Revocation: {reason.strip()}".strip(" | ")
        )
        try:
            db.commit()
            db.refresh(assignment)
            return assignment
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Failed to update role assignment due to concurrent modification.",
            ) from exc

    @staticmethod
    def list_user_roles(db: Session, user_id: uuid.UUID) -> List[UserRole]:
        """List active and historical role assignments for a user."""
        return (
            db.query(UserRole)
            .filter(UserRole.user_id == user_id)
            .order_by(UserRole.assigned_at.desc())
            .all()
        )

    @staticmethod
    def list_all_roles(db: Session) -> List[Role]:
        """List all defined application security roles."""
        return db.query(Role).order_by(Role.name.asc()).all()

    @staticmethod
    def check_separation_of_duties(
        current_user_id: uuid.UUID | str,
        session: MeasurementSession,
    ) -> None:
        """Enforce strict separation of duties:
        A user who performed measurements on a session CANNOT act as its reviewer.
        
        Comparing stable internal UUID strings.
        No role (including Admin and Supervisor) is exempt.
        """
        if session.measurer_id and str(current_user_id) == str(session.measurer_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="SEPARATION_OF_DUTIES_VIOLATION: Reviewer cannot be the measurer of the session.",
            )

    @staticmethod
    def check_session_write_access(
        db: Session,
        current_user: User,
        session: MeasurementSession,
    ) -> None:
        """Enforce session-level write access boundaries and workflow state constraints.
        
        - Finalized sessions are strictly immutable (HTTP 409).
        - Submitted/in-review sessions cannot be updated directly (HTTP 409).
        - Measurers can only modify sessions they own/measured (HTTP 403).
        - Admins and Supervisors can modify editable draft sessions across measurers.
        """
        # 1. Workflow state validation
        if session.status in ("finalized", "approved", "superseded"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Session is finalized or superseded and strictly immutable.",
            )
        if session.status in ("needs_review", "submitted", "in_review"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Session is submitted for review and cannot be modified directly.",
            )

        # 2. Measurer ownership boundary
        user_roles = RBACService.get_user_role_names(db, current_user.id)
        is_elevated = bool(user_roles.intersection({SystemRoles.ADMIN, SystemRoles.SUPERVISOR}))
        if not is_elevated and session.measurer_id:
            if str(current_user.id) != str(session.measurer_id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Measurer is not authorized to modify another measurer's session.",
                )

    @staticmethod
    def check_session_read_access(
        db: Session,
        current_user: User,
        session: MeasurementSession,
    ) -> None:
        """Enforce session-level read access boundaries.
        
        - Organization-wide oversight roles (Admin, Supervisor, Auditor) can inspect any session and audit trail.
        - Reviewers can inspect sessions that are submitted for review ('needs_review') or finalized ('approved', 'finalized').
        - Measurers can ONLY inspect sessions that they measured/own (session.measurer_id == current_user.id).
        """
        user_roles = RBACService.get_user_role_names(db, current_user.id)

        # 1. Organization-wide oversight roles
        if bool(user_roles.intersection({SystemRoles.ADMIN, SystemRoles.SUPERVISOR, SystemRoles.AUDITOR})):
            return

        # 2. Measurer of this session can always read their own session
        if session.measurer_id and str(current_user.id) == str(session.measurer_id):
            return

        # 3. Independent Reviewer can read sessions submitted for review or approved/finalized
        if SystemRoles.REVIEWER in user_roles and session.status in ("needs_review", "submitted", "in_review", "approved", "finalized"):
            return

        # Otherwise, cross-measurer access to unsubmitted or unassigned sessions is denied
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You are not authorized to view this measurement session.",
        )


def require_permission(permission_code: str) -> Callable:
    """FastAPI dependency factory enforcing a required capability permission."""
    def _dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if not RBACService.has_permission(db, current_user.id, permission_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: missing required permission '{permission_code}'.",
            )
        return current_user

    return _dependency


def require_role(role_name: str) -> Callable:
    """FastAPI dependency factory enforcing an active security role."""
    def _dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if not RBACService.has_role(db, current_user.id, role_name):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied: missing required role '{role_name}'.",
            )
        return current_user

    return _dependency

