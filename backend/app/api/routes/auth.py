"""Authentication, identity, and RBAC administrative API routes."""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.rbac import (
    RBACService,
    SystemPermissions,
    require_permission,
)
from app.auth.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_local_token,
)
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import (
    UserProfileResponse,
    AuthStatusResponse,
    RoleSchema,
    PermissionSchema,
    UserRoleAssignmentResponse,
    RoleAssignRequest,
    RoleRevokeRequest,
    RegisterRequest,
    LoginRequest,
    RefreshTokenRequest,
    AuthTokensResponse,
)

router = APIRouter(prefix="/auth", tags=["Authentication & Identity"])


@router.post(
    "/register",
    response_model=AuthTokensResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new autonomous Field Measurer",
    description="Registers a new user account with immediate measurer role and returns JWT authentication tokens.",
)
def register_user(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
) -> AuthTokensResponse:
    """Self-register an autonomous field measurer with immediate activation."""
    # Check for existing account with the same email under local issuer
    existing_user = (
        db.query(User)
        .filter(User.issuer == "local", func.lower(User.email) == payload.email)
        .first()
    )
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email address already exists.",
        )

    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    hashed_pwd = hash_password(payload.password)

    new_user = User(
        id=user_id,
        issuer="local",
        subject=str(user_id),
        display_name=payload.display_name,
        email=payload.email,
        email_verified=True,
        organization=payload.organization,
        password_hash=hashed_pwd,
        status="active",
        created_at=now,
        updated_at=now,
        last_authenticated_at=now,
    )

    db.add(new_user)
    db.flush()

    # Automatically grant the 'measurer' role with self-registration justification
    RBACService.assign_role(
        db=db,
        target_user_id=user_id,
        role_name="measurer",
        reason="Initial autonomous field measurer self-registration",
    )

    db.commit()
    db.refresh(new_user)

    roles = sorted(list(RBACService.get_user_role_names(db, new_user.id)))
    permissions = sorted(list(RBACService.get_user_permissions(db, new_user.id)))

    access_token = create_access_token(
        user_id=new_user.id,
        email=new_user.email,
        display_name=new_user.display_name,
        roles=roles,
    )
    refresh_token = create_refresh_token(user_id=new_user.id)

    profile = UserProfileResponse(
        id=new_user.id,
        issuer=new_user.issuer,
        subject=new_user.subject,
        display_name=new_user.display_name,
        email=new_user.email,
        email_verified=new_user.email_verified,
        organization=new_user.organization,
        status=new_user.status,
        created_at=new_user.created_at,
        last_authenticated_at=new_user.last_authenticated_at,
        roles=roles,
        permissions=permissions,
    )

    return AuthTokensResponse(
        access_token=access_token,
        token_type="Bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        refresh_token=refresh_token,
        user=profile,
    )


@router.post(
    "/login",
    response_model=AuthTokensResponse,
    summary="Sign in with email and password",
    description="Authenticates local user credentials and issues JWT access and refresh tokens.",
)
def login_user(
    payload: LoginRequest,
    db: Session = Depends(get_db),
) -> AuthTokensResponse:
    """Authenticate with local email and password."""
    user = (
        db.query(User)
        .filter(User.issuer == "local", func.lower(User.email) == payload.email)
        .first()
    )

    if not user or not user.password_hash or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your user account is disabled. Contact your system supervisor.",
        )

    now = datetime.now(timezone.utc)
    user.last_authenticated_at = now
    db.commit()
    db.refresh(user)

    roles = sorted(list(RBACService.get_user_role_names(db, user.id)))
    permissions = sorted(list(RBACService.get_user_permissions(db, user.id)))

    access_token = create_access_token(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        roles=roles,
    )
    refresh_token = create_refresh_token(user_id=user.id)

    profile = UserProfileResponse(
        id=user.id,
        issuer=user.issuer,
        subject=user.subject,
        display_name=user.display_name,
        email=user.email,
        email_verified=user.email_verified,
        organization=user.organization,
        status=user.status,
        created_at=user.created_at,
        last_authenticated_at=user.last_authenticated_at,
        roles=roles,
        permissions=permissions,
    )

    return AuthTokensResponse(
        access_token=access_token,
        token_type="Bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        refresh_token=refresh_token,
        user=profile,
    )


@router.post(
    "/refresh",
    summary="Refresh JWT access token",
    description="Exchanges a valid refresh token for a new access token.",
)
def refresh_token_endpoint(
    payload: RefreshTokenRequest,
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """Exchange a refresh token for a newly issued access token."""
    try:
        claims = decode_local_token(payload.refresh_token)
        if claims.get("type") != "refresh":
            raise ValueError("Expected a token with type 'refresh'.")
        sub = claims.get("sub")
        if not sub:
            raise ValueError("Missing subject.")
        user_uuid = uuid.UUID(sub)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired refresh token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = db.get(User, user_uuid)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
    if user.status != "active":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your user account is disabled.",
        )

    roles = sorted(list(RBACService.get_user_role_names(db, user.id)))
    access_token = create_access_token(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        roles=roles,
    )

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


@router.get(
    "/me",
    response_model=UserProfileResponse,
    summary="Get authenticated user profile",
    description="Returns the authenticated application user profile, active roles, and effective permissions.",
)
def get_authenticated_user_profile(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> UserProfileResponse:
    """Retrieve the safe profile of the currently authenticated user with effective RBAC entitlements."""
    roles = sorted(list(RBACService.get_user_role_names(db, current_user.id)))
    permissions = sorted(list(RBACService.get_user_permissions(db, current_user.id)))
    
    return UserProfileResponse(
        id=current_user.id,
        issuer=current_user.issuer,
        subject=current_user.subject,
        display_name=current_user.display_name,
        email=current_user.email,
        email_verified=current_user.email_verified,
        status=current_user.status,
        created_at=current_user.created_at,
        last_authenticated_at=current_user.last_authenticated_at,
        roles=roles,
        permissions=permissions,
    )


@router.get(
    "/status",
    response_model=AuthStatusResponse,
    summary="Get authentication configuration status",
    description="Returns non-sensitive OIDC configuration metadata, active environment, and provisional policy notices.",
)
def get_auth_status() -> AuthStatusResponse:
    """Public status endpoint describing authentication settings without disclosing secrets."""
    return AuthStatusResponse(
        environment=settings.ENVIRONMENT,
        oidc_issuer=settings.OIDC_ISSUER_URL,
        oidc_audience=settings.OIDC_AUDIENCE,
        auto_provisioning=settings.OIDC_AUTO_PROVISION_USERS,
        allowed_algorithms=settings.OIDC_ALLOWED_ALGORITHMS,
        is_provisional=True,
    )


@router.get(
    "/roles",
    response_model=List[RoleSchema],
    summary="List system security roles",
    description="Lists all defined system roles and their assigned permission capabilities.",
)
def list_system_roles(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[RoleSchema]:
    """Retrieve all defined system security roles and their associated permissions."""
    roles = RBACService.list_all_roles(db)
    return [
        RoleSchema(
            id=r.id,
            name=r.name,
            description=r.description,
            is_system_role=r.is_system_role,
            permissions=[
                PermissionSchema(
                    id=p.id,
                    code=p.code,
                    description=p.description,
                    resource=p.resource,
                    action=p.action,
                )
                for p in r.permissions
            ],
        )
        for r in roles
    ]


@router.get(
    "/users/{user_id}/roles",
    response_model=List[UserRoleAssignmentResponse],
    summary="List user role assignments",
    description="Lists active and historical role assignments for a specified user.",
)
def list_user_role_assignments(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> List[UserRoleAssignmentResponse]:
    """List role assignments for a user. Users may inspect their own roles; inspecting others requires role:manage."""
    if current_user.id != user_id and not RBACService.has_permission(
        db, current_user.id, SystemPermissions.ROLE_MANAGE
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied: missing required permission '{SystemPermissions.ROLE_MANAGE}'.",
        )

    assignments = RBACService.list_user_roles(db, user_id)
    return [
        UserRoleAssignmentResponse(
            id=a.id,
            user_id=a.user_id,
            role_id=a.role_id,
            role_name=a.role.name if a.role else "unknown",
            assigned_by=a.assigned_by,
            assigned_at=a.assigned_at,
            revoked_at=a.revoked_at,
            assignment_reason=a.assignment_reason,
            is_active=a.is_active,
        )
        for a in assignments
    ]


@router.post(
    "/users/{user_id}/roles",
    response_model=UserRoleAssignmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Assign role to user",
    description="Assigns an active application security role to a user. Requires role:manage permission.",
)
def assign_user_role(
    user_id: uuid.UUID,
    payload: RoleAssignRequest,
    current_user: User = Depends(require_permission(SystemPermissions.ROLE_MANAGE)),
    db: Session = Depends(get_db),
) -> UserRoleAssignmentResponse:
    """Administratively assign a role to a target user with auditable reason."""
    assignment = RBACService.assign_role(
        db=db,
        target_user_id=user_id,
        role_name=payload.role_name,
        assigned_by=current_user.id,
        reason=payload.reason,
    )
    return UserRoleAssignmentResponse(
        id=assignment.id,
        user_id=assignment.user_id,
        role_id=assignment.role_id,
        role_name=assignment.role.name if assignment.role else payload.role_name,
        assigned_by=assignment.assigned_by,
        assigned_at=assignment.assigned_at,
        revoked_at=assignment.revoked_at,
        assignment_reason=assignment.assignment_reason,
        is_active=assignment.is_active,
    )


@router.delete(
    "/users/{user_id}/roles/{role_name}",
    response_model=UserRoleAssignmentResponse,
    summary="Revoke role from user",
    description="Revokes an active role from a target user, preserving audit history. Requires role:manage permission.",
)
def revoke_user_role(
    user_id: uuid.UUID,
    role_name: str,
    reason: str = Query(..., min_length=1, max_length=500, description="Mandatory administrative revocation reason"),
    current_user: User = Depends(require_permission(SystemPermissions.ROLE_MANAGE)),
    db: Session = Depends(get_db),
) -> UserRoleAssignmentResponse:
    """Administratively revoke an active role from a target user."""
    if not reason or not reason.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="A non-empty administrative revocation reason is required.",
        )
    assignment = RBACService.revoke_role(
        db=db,
        target_user_id=user_id,
        role_name=role_name,
        revoked_by=current_user.id,
        reason=reason.strip(),
    )
    return UserRoleAssignmentResponse(
        id=assignment.id,
        user_id=assignment.user_id,
        role_id=assignment.role_id,
        role_name=assignment.role.name if assignment.role else role_name,
        assigned_by=assignment.assigned_by,
        assigned_at=assignment.assigned_at,
        revoked_at=assignment.revoked_at,
        assignment_reason=assignment.assignment_reason,
        is_active=assignment.is_active,
    )
