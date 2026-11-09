"""Pydantic schemas for authentication, identity, and RBAC responses."""

import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator


class PermissionSchema(BaseModel):
    """Granular action capability schema."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID = Field(..., description="Unique permission UUID")
    code: str = Field(..., description="Unique permission code identifier (e.g. session:create)")
    description: Optional[str] = Field(None, description="Human-readable description of capability")
    resource: str = Field(..., description="Resource target of the permission")
    action: str = Field(..., description="Permitted action on the resource")


class RoleSchema(BaseModel):
    """Application security role schema."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID = Field(..., description="Unique role UUID")
    name: str = Field(..., description="Role name (measurer, reviewer, supervisor, auditor, admin)")
    description: Optional[str] = Field(None, description="Role description")
    is_system_role: bool = Field(True, description="Whether role is a built-in immutable system role")
    permissions: List[PermissionSchema] = Field(default_factory=list, description="Associated permissions")


class UserRoleAssignmentResponse(BaseModel):
    """User role assignment response schema."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID = Field(..., description="Unique assignment UUID")
    user_id: uuid.UUID = Field(..., description="User UUID")
    role_id: uuid.UUID = Field(..., description="Role UUID")
    role_name: str = Field(..., description="Role name string")
    assigned_by: Optional[uuid.UUID] = Field(None, description="Assigner user UUID")
    assigned_at: datetime = Field(..., description="Timestamp assignment was granted")
    revoked_at: Optional[datetime] = Field(None, description="Timestamp assignment was revoked, if any")
    assignment_reason: Optional[str] = Field(None, description="Administrative justification")
    is_active: bool = Field(..., description="Whether the assignment is currently active")


class RoleAssignRequest(BaseModel):
    """Request payload to assign a role to a user."""
    role_name: str = Field(..., min_length=2, max_length=64, description="Target role name to assign")
    reason: str = Field(..., min_length=1, max_length=500, description="Mandatory administrative justification")

    @field_validator("reason")
    @classmethod
    def validate_reason_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A non-empty administrative justification reason is required.")
        return v.strip()


class RoleRevokeRequest(BaseModel):
    """Request payload to revoke a role from a user."""
    reason: str = Field(..., min_length=1, max_length=500, description="Mandatory administrative justification")

    @field_validator("reason")
    @classmethod
    def validate_reason_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("A non-empty administrative justification reason is required.")
        return v.strip()


class UserProfileResponse(BaseModel):
    """Safe authenticated user profile representation.
    
    Excludes credentials, secrets, signing keys, and raw tokens.
    Includes active assigned roles and effective permissions.
    """
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID = Field(..., description="Stable internal application user UUID")
    issuer: str = Field(..., description="OIDC Identity Provider Issuer URL")
    subject: str = Field(..., description="OIDC Subject Identifier")
    display_name: Optional[str] = Field(None, description="User full or preferred name")
    email: Optional[str] = Field(None, description="User email address")
    email_verified: bool = Field(False, description="Email verification status from IdP")
    organization: Optional[str] = Field(None, description="Measurer affiliation / organization")
    status: str = Field(..., description="Application account status (active, disabled)")
    created_at: datetime = Field(..., description="Account creation timestamp")
    last_authenticated_at: Optional[datetime] = Field(None, description="Most recent successful authentication timestamp")
    roles: List[str] = Field(default_factory=list, description="Active assigned role names")
    permissions: List[str] = Field(default_factory=list, description="Effective permission codes")


class AuthStatusResponse(BaseModel):
    """Public non-sensitive authentication status and configuration metadata."""
    environment: str = Field(..., description="Runtime environment name")
    oidc_issuer: str = Field(..., description="Configured OIDC issuer URL")
    oidc_audience: str = Field(..., description="Expected backend API audience")
    auto_provisioning: bool = Field(..., description="Whether first-time users are auto-provisioned")
    allowed_algorithms: List[str] = Field(..., description="Accepted cryptographic signature algorithms")
    is_provisional: bool = Field(True, description="Indicates provisional measurement policy state")
    policy_notice: str = Field(
        "PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION",
        description="Mandatory warning banner for unratified measurement policy context",
    )


class RegisterRequest(BaseModel):
    """Registration request payload for a new autonomous field measurer."""
    email: str = Field(..., min_length=5, max_length=320, description="User email address")
    password: str = Field(..., min_length=8, max_length=128, description="User password (min 8 characters)")
    display_name: str = Field(..., min_length=2, max_length=255, description="Full or display name of the measurer")
    organization: Optional[str] = Field(None, max_length=255, description="Affiliation / Organization (e.g. World Athletics / AIMS)")

    @field_validator("email")
    @classmethod
    def validate_email_format(cls, v: str) -> str:
        clean = v.strip().lower()
        if "@" not in clean or "." not in clean.split("@")[-1]:
            raise ValueError("A valid email address is required.")
        return clean

    @field_validator("display_name")
    @classmethod
    def validate_display_name_non_empty(cls, v: str) -> str:
        clean = v.strip()
        if not clean:
            raise ValueError("Display name cannot be empty.")
        return clean


class LoginRequest(BaseModel):
    """Login request payload with email and password."""
    email: str = Field(..., min_length=5, max_length=320, description="Registered email address")
    password: str = Field(..., min_length=1, max_length=128, description="Plaintext password")

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class RefreshTokenRequest(BaseModel):
    """Token refresh request payload."""
    refresh_token: str = Field(..., min_length=1, description="Valid JWT refresh token")


class AuthTokensResponse(BaseModel):
    """Authentication tokens and profile response payload."""
    access_token: str = Field(..., description="HS256 Bearer access token")
    token_type: str = Field("Bearer", description="Token type")
    expires_in: int = Field(..., description="Access token expiration window in seconds")
    refresh_token: str = Field(..., description="JWT refresh token")
    user: UserProfileResponse = Field(..., description="Safe user profile")

