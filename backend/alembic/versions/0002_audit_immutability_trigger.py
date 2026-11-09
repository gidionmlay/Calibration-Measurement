"""Add database-level trigger enforcing audit_events immutability

Revision ID: 0002_audit_immutability
Revises: 0001_initial
Create Date: 2026-11-07 16:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0002_audit_immutability"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Create PL/pgSQL trigger function
    op.execute("""
    CREATE OR REPLACE FUNCTION trg_fn_prevent_audit_events_mutation()
    RETURNS TRIGGER AS $$
    BEGIN
        RAISE EXCEPTION 'Table audit_events is append-only: % operations are strictly prohibited at database engine level.', TG_OP;
    END;
    $$ LANGUAGE plpgsql;
    """)

    # 2. Attach statement-level trigger preventing UPDATE, DELETE, and TRUNCATE
    op.execute("""
    DROP TRIGGER IF EXISTS trg_protect_audit_events_mutation ON audit_events;
    CREATE TRIGGER trg_protect_audit_events_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_events
    FOR EACH STATEMENT
    EXECUTE FUNCTION trg_fn_prevent_audit_events_mutation();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_protect_audit_events_mutation ON audit_events;")
    op.execute("DROP FUNCTION IF EXISTS trg_fn_prevent_audit_events_mutation();")

