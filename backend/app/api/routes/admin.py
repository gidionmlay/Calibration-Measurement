"""Admin Overview & Metrics Route.

Provides high-level operational overview:
- Total registered/active field measurers.
- Total measurement sessions conducted.
- Total finalized calculation reports generated.
- Monthly activity trends and recent sessions summary.
"""

from collections import defaultdict
from datetime import datetime, timezone
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.rbac import SystemRoles, RBACService
from app.core.database import get_db
from app.models.rbac import UserRole, Role
from app.models.session import MeasurementSession
from app.models.user import User
from app.schemas.admin import (
    AdminOverviewResponse,
    MonthlyActivityItem,
    RecentSessionItem,
    FieldMeasurerItem,
)
from app.schemas.calculations import ProblemDetail

router = APIRouter(prefix="/admin", tags=["Admin Overview"])


def require_admin_overview_access(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Enforces that caller has admin, supervisor, or system admin role."""
    roles = RBACService.get_user_role_names(db, current_user.id)
    allowed_roles = {SystemRoles.ADMIN, SystemRoles.SUPERVISOR}
    if not bool(roles.intersection(allowed_roles)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Admin or Supervisor role required to access overview metrics.",
        )
    return current_user


@router.get(
    "/overview",
    response_model=AdminOverviewResponse,
    responses={
        401: {"model": ProblemDetail, "description": "Authentication Required"},
        403: {"model": ProblemDetail, "description": "Forbidden - Admin Role Required"},
    },
    summary="Get Operational Overview Metrics",
)
def get_admin_overview(
    current_user: User = Depends(require_admin_overview_access),
    db: Session = Depends(get_db),
) -> AdminOverviewResponse:
    """Returns high-level aggregate metrics:
    - Number of measurers
    - Total sessions
    - Finalized report counts
    - Monthly activity trends
    - Recent measurement sessions
    """
    total_users = db.query(func.count(User.id)).filter(User.status == "active").scalar() or 0
    total_sessions = db.query(func.count(MeasurementSession.id)).scalar() or 0
    total_finalized = (
        db.query(func.count(MeasurementSession.id))
        .filter(MeasurementSession.status == "finalized")
        .scalar()
        or 0
    )
    total_drafts = (
        db.query(func.count(MeasurementSession.id))
        .filter(MeasurementSession.status.in_(["draft", "in_progress", "needs_review", "approved"]))
        .scalar()
        or 0
    )

    # Compute monthly trends for the past 6 months
    now = datetime.now(timezone.utc)
    # Generate keys for past 6 months in chronological order
    month_keys = []
    y, m = now.year, now.month
    for _ in range(6):
        month_keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            m = 12
            y -= 1
    month_keys.reverse()

    monthly_sessions: Dict[str, int] = defaultdict(int)
    monthly_reports: Dict[str, int] = defaultdict(int)

    all_sessions_summary = (
        db.query(MeasurementSession.created_at, MeasurementSession.status).all()
    )
    for s_date, s_status in all_sessions_summary:
        if s_date:
            key = s_date.strftime("%Y-%m")
            monthly_sessions[key] += 1
            if s_status == "finalized":
                monthly_reports[key] += 1

    monthly_activity: List[MonthlyActivityItem] = [
        MonthlyActivityItem(
            month=k,
            session_count=monthly_sessions[k],
            report_count=monthly_reports[k],
        )
        for k in month_keys
    ]

    # Fetch recent 20 sessions for overview table
    recent_sessions_db = (
        db.query(MeasurementSession)
        .order_by(MeasurementSession.created_at.desc())
        .limit(20)
        .all()
    )

    # Map measurer_ids to display names if available
    user_ids = [s.measurer_id for s in recent_sessions_db if s.measurer_id]
    users_by_id = {}
    if user_ids:
        found_users = db.query(User).filter(User.id.in_(user_ids)).all()
        for u in found_users:
            users_by_id[str(u.id)] = u.display_name or u.email or str(u.id)[:8]

    recent_activity: List[RecentSessionItem] = []
    for s in recent_sessions_db:
        measurer_label = (
            users_by_id.get(str(s.measurer_id))
            or s.measurer_id
            or "Field Measurer"
        )
        recent_activity.append(
            RecentSessionItem(
                id=s.id,
                reference=s.name,
                measurer_name=measurer_label,
                course_name=s.course_name,
                course_length_m=str(s.course_length_m),
                status=s.status,
                is_provisional=s.is_provisional,
                created_at=s.created_at,
            )
        )

    # Fetch all registered field measurers and operators
    all_users = db.query(User).order_by(User.created_at.desc()).all()
    user_roles_map = defaultdict(list)
    user_roles_db = (
        db.query(UserRole.user_id, Role.name)
        .join(Role, UserRole.role_id == Role.id)
        .filter(UserRole.revoked_at.is_(None))
        .all()
    )
    for u_id, r_name in user_roles_db:
        user_roles_map[u_id].append(r_name)

    session_counts_db = (
        db.query(MeasurementSession.measurer_id, func.count(MeasurementSession.id))
        .filter(MeasurementSession.measurer_id.isnot(None))
        .group_by(MeasurementSession.measurer_id)
        .all()
    )
    session_counts_map = {str(m_id): count for m_id, count in session_counts_db}

    measurers_list: List[FieldMeasurerItem] = []
    for u in all_users:
        u_roles = user_roles_map.get(u.id) or ["measurer"]
        name = u.display_name or (u.email.split("@")[0] if u.email else "Field Measurer")
        s_count = session_counts_map.get(str(u.id), 0) or session_counts_map.get(u.display_name or "", 0)
        measurers_list.append(
            FieldMeasurerItem(
                id=u.id,
                display_name=name,
                email=u.email,
                organization=u.organization or "Independent Measurer",
                status=u.status,
                roles=u_roles,
                session_count=s_count,
                created_at=u.created_at,
            )
        )

    return AdminOverviewResponse(
        total_users=total_users,
        total_sessions=total_sessions,
        total_finalized_reports=total_finalized,
        total_draft_sessions=total_drafts,
        monthly_activity=monthly_activity,
        recent_activity=recent_activity,
        measurers=measurers_list,
    )

