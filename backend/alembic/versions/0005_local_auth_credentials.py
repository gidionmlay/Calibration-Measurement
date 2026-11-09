"""Add password_hash, organization, and local email unique index to users

Revision ID: 0005_local_auth_credentials
Revises: 0004_rbac_schema
Create Date: 2026-11-08 17:35:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0005_local_auth_credentials"
down_revision: Union[str, None] = "0004_rbac_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add password_hash and organization columns to users
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("organization", sa.String(255), nullable=True))

    # 2. Add partial unique index for local users' email (case-insensitive)
    op.create_index(
        "idx_users_local_email_unique",
        "users",
        [sa.text("lower(email)")],
        unique=True,
        postgresql_where=sa.text("issuer = 'local'"),
    )


def downgrade() -> None:
    op.drop_index("idx_users_local_email_unique", table_name="users")
    op.drop_column("users", "organization")
    op.drop_column("users", "password_hash")

