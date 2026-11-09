"""Add users table for OIDC persistent identity mapping

Revision ID: 0003_user_identity
Revises: 0002_audit_immutability
Create Date: 2026-11-07 17:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0003_user_identity"
down_revision: Union[str, None] = "0002_audit_immutability"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("issuer", sa.String(512), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.String(32), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_authenticated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("issuer", "subject", name="uq_users_issuer_subject"),
        sa.CheckConstraint("status IN ('active', 'disabled')", name="chk_user_status"),
    )
    op.create_index("idx_users_issuer_subject", "users", ["issuer", "subject"])
    op.create_index("idx_users_email", "users", ["email"])
    op.create_index("idx_users_status", "users", ["status"])


def downgrade() -> None:
    op.drop_index("idx_users_status", table_name="users")
    op.drop_index("idx_users_email", table_name="users")
    op.drop_index("idx_users_issuer_subject", table_name="users")
    op.drop_table("users")

