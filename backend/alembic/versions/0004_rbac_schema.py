"""Create RBAC roles, permissions, role_permissions, and user_roles tables

Revision ID: 0004_rbac_schema
Revises: 0003_user_identity
Create Date: 2026-11-07 17:15:00.000000

"""
from typing import Sequence, Union
import uuid
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0004_rbac_schema"
down_revision: Union[str, None] = "0003_user_identity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# System role IDs (deterministic UUIDs)
ROLE_MEASURER_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
ROLE_REVIEWER_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
ROLE_SUPERVISOR_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
ROLE_AUDITOR_ID = uuid.UUID("44444444-4444-4444-8444-444444444444")
ROLE_ADMIN_ID = uuid.UUID("55555555-5555-4555-8555-555555555555")

# Permission IDs (deterministic UUIDs)
PERM_SESSION_CREATE = uuid.UUID("a1111111-1111-4111-8111-111111111111")
PERM_SESSION_READ = uuid.UUID("a2222222-2222-4222-8222-222222222222")
PERM_SESSION_UPDATE_DRAFT = uuid.UUID("a3333333-3333-4333-8333-333333333333")
PERM_SESSION_SUBMIT_REVIEW = uuid.UUID("a4444444-4444-4444-8444-444444444444")
PERM_REVIEW_CREATE = uuid.UUID("b1111111-1111-4111-8111-111111111111")
PERM_REVIEW_DECIDE = uuid.UUID("b2222222-2222-4222-8222-222222222222")
PERM_AUDIT_READ = uuid.UUID("c1111111-1111-4111-8111-111111111111")
PERM_AUDIT_VERIFY = uuid.UUID("c2222222-2222-4222-8222-222222222222")
PERM_ROLE_MANAGE = uuid.UUID("d1111111-1111-4111-8111-111111111111")
PERM_CONFIG_MANAGE = uuid.UUID("e1111111-1111-4111-8111-111111111111")


def upgrade() -> None:
    # 1. Create roles table
    roles_table = op.create_table(
        "roles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(64), unique=True, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_system_role", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_roles_name", "roles", ["name"])

    # 2. Create permissions table
    perms_table = op.create_table(
        "permissions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(64), unique=True, nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("resource", sa.String(64), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("idx_permissions_code", "permissions", ["code"])

    # 3. Create role_permissions association table
    role_perms_table = op.create_table(
        "role_permissions",
        sa.Column("role_id", UUID(as_uuid=True), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("permission_id", UUID(as_uuid=True), sa.ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True),
    )

    # 4. Create user_roles auditable assignment table
    op.create_table(
        "user_roles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_id", UUID(as_uuid=True), sa.ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("assigned_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("assignment_reason", sa.Text(), nullable=True),
    )
    op.create_index("idx_user_roles_user_id", "user_roles", ["user_id"])
    op.create_index("idx_user_roles_role_id", "user_roles", ["role_id"])
    # Partial unique index enforcing at most one active assignment per (user, role)
    op.execute("""
    CREATE UNIQUE INDEX uq_active_user_role
    ON user_roles (user_id, role_id)
    WHERE revoked_at IS NULL;
    """)

    # 5. Seed initial system roles
    op.bulk_insert(
        roles_table,
        [
            {"id": ROLE_MEASURER_ID, "name": "measurer", "description": "Field measurer authorized to record rides and submit sessions", "is_system_role": True},
            {"id": ROLE_REVIEWER_ID, "name": "reviewer", "description": "Independent peer reviewer authorized to inspect sessions and record review decisions", "is_system_role": True},
            {"id": ROLE_SUPERVISOR_ID, "name": "supervisor", "description": "Pilot supervisor authorized to manage sessions, conduct reviews, and verify audit ledgers", "is_system_role": True},
            {"id": ROLE_AUDITOR_ID, "name": "auditor", "description": "Independent auditor with read-only inspection access and audit verification rights", "is_system_role": True},
            {"id": ROLE_ADMIN_ID, "name": "admin", "description": "Application administrator authorized to manage user roles and system configuration", "is_system_role": True},
        ],
    )

    # 6. Seed initial permissions
    op.bulk_insert(
        perms_table,
        [
            {"id": PERM_SESSION_CREATE, "code": "session:create", "description": "Create a new measurement session", "resource": "session", "action": "create"},
            {"id": PERM_SESSION_READ, "code": "session:read", "description": "Read permitted measurement sessions", "resource": "session", "action": "read"},
            {"id": PERM_SESSION_UPDATE_DRAFT, "code": "session:update_draft", "description": "Update draft calibration readings and configuration", "resource": "session", "action": "update"},
            {"id": PERM_SESSION_SUBMIT_REVIEW, "code": "session:submit_review", "description": "Submit a draft session for peer review", "resource": "session", "action": "submit"},
            {"id": PERM_REVIEW_CREATE, "code": "review:create", "description": "Initiate peer review on a session", "resource": "review", "action": "create"},
            {"id": PERM_REVIEW_DECIDE, "code": "review:decide", "description": "Approve or reject a session review decision", "resource": "review", "action": "decide"},
            {"id": PERM_AUDIT_READ, "code": "audit:read", "description": "View session audit ledger history", "resource": "audit", "action": "read"},
            {"id": PERM_AUDIT_VERIFY, "code": "audit:verify", "description": "Cryptographically verify session audit ledger integrity", "resource": "audit", "action": "verify"},
            {"id": PERM_ROLE_MANAGE, "code": "role:manage", "description": "Assign and revoke application user roles", "resource": "role", "action": "manage"},
            {"id": PERM_CONFIG_MANAGE, "code": "config:manage", "description": "Manage application system configuration", "resource": "config", "action": "manage"},
        ],
    )

    # 7. Seed role-permission mappings
    role_perm_mappings = [
        # Measurer
        {"role_id": ROLE_MEASURER_ID, "permission_id": PERM_SESSION_CREATE},
        {"role_id": ROLE_MEASURER_ID, "permission_id": PERM_SESSION_READ},
        {"role_id": ROLE_MEASURER_ID, "permission_id": PERM_SESSION_UPDATE_DRAFT},
        {"role_id": ROLE_MEASURER_ID, "permission_id": PERM_SESSION_SUBMIT_REVIEW},
        {"role_id": ROLE_MEASURER_ID, "permission_id": PERM_AUDIT_READ},
        # Reviewer
        {"role_id": ROLE_REVIEWER_ID, "permission_id": PERM_SESSION_READ},
        {"role_id": ROLE_REVIEWER_ID, "permission_id": PERM_REVIEW_CREATE},
        {"role_id": ROLE_REVIEWER_ID, "permission_id": PERM_REVIEW_DECIDE},
        {"role_id": ROLE_REVIEWER_ID, "permission_id": PERM_AUDIT_READ},
        # Supervisor
        {"role_id": ROLE_SUPERVISOR_ID, "permission_id": PERM_SESSION_CREATE},
        {"role_id": ROLE_SUPERVISOR_ID, "permission_id": PERM_SESSION_READ},
        {"role_id": ROLE_SUPERVISOR_ID, "permission_id": PERM_SESSION_UPDATE_DRAFT},
        {"role_id": ROLE_SUPERVISOR_ID, "permission_id": PERM_SESSION_SUBMIT_REVIEW},
        {"role_id": ROLE_SUPERVISOR_ID, "permission_id": PERM_REVIEW_CREATE},
        {"role_id": ROLE_SUPERVISOR_ID, "permission_id": PERM_REVIEW_DECIDE},
        {"role_id": ROLE_SUPERVISOR_ID, "permission_id": PERM_AUDIT_READ},
        {"role_id": ROLE_SUPERVISOR_ID, "permission_id": PERM_AUDIT_VERIFY},
        # Auditor (strictly read-only)
        {"role_id": ROLE_AUDITOR_ID, "permission_id": PERM_SESSION_READ},
        {"role_id": ROLE_AUDITOR_ID, "permission_id": PERM_AUDIT_READ},
        {"role_id": ROLE_AUDITOR_ID, "permission_id": PERM_AUDIT_VERIFY},
        # Admin (all permissions)
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_SESSION_CREATE},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_SESSION_READ},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_SESSION_UPDATE_DRAFT},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_SESSION_SUBMIT_REVIEW},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_REVIEW_CREATE},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_REVIEW_DECIDE},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_AUDIT_READ},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_AUDIT_VERIFY},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_ROLE_MANAGE},
        {"role_id": ROLE_ADMIN_ID, "permission_id": PERM_CONFIG_MANAGE},
    ]
    op.bulk_insert(role_perms_table, role_perm_mappings)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_active_user_role;")
    op.drop_table("user_roles")
    op.drop_table("role_permissions")
    op.drop_table("permissions")
    op.drop_table("roles")

