"""Initial persistence and append-only audit ledger schema

Revision ID: 0001_initial
Revises: 
Create Date: 2026-11-07 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Sessions table
    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="draft"),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("measurer_id", sa.String(length=255), nullable=True),
        sa.Column("supervisor_id", sa.String(length=255), nullable=True),
        sa.Column("course_name", sa.String(length=255), nullable=True),
        sa.Column("course_length_m", sa.Numeric(precision=12, scale=4), nullable=False),
        sa.Column("course_length_unit", sa.String(length=20), nullable=False, server_default="m"),
        sa.Column("surface_type", sa.String(length=50), nullable=True),
        sa.Column("temperature_c", sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column("rollover_mode", sa.String(length=30), nullable=False, server_default="none"),
        sa.Column("max_reading", sa.BigInteger(), nullable=True),
        sa.Column("constant_selection_rule", sa.String(length=50), nullable=False, server_default="larger"),
        sa.Column("working_spec_version", sa.String(length=50), nullable=False, server_default="ws-0.3-provisional"),
        sa.Column("policy_approval_status", sa.String(length=50), nullable=False, server_default="unapproved"),
        sa.Column("pre_cal_working_constant", sa.Numeric(precision=16, scale=6), nullable=True),
        sa.Column("post_cal_working_constant", sa.Numeric(precision=16, scale=6), nullable=True),
        sa.Column("final_working_constant", sa.Numeric(precision=16, scale=6), nullable=True),
        sa.Column("cal_drift_percent", sa.Numeric(precision=8, scale=4), nullable=True),
        sa.Column("course_distance_km", sa.Numeric(precision=16, scale=8), nullable=True),
        sa.Column("calculation_engine_version", sa.String(length=50), nullable=True),
        sa.Column("is_provisional", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("policy_notice", sa.Text(), nullable=True),
        sa.Column("supersedes_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("superseded_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("revision_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.clock_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.clock_timestamp()),
        sa.CheckConstraint("course_length_m > 0", name="chk_session_course_length_positive"),
        sa.CheckConstraint("version >= 1", name="chk_session_version_positive"),
    )

    # 2. Session rides table
    op.create_table(
        "session_rides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ride_type", sa.String(length=50), nullable=False),
        sa.Column("ride_number", sa.Integer(), nullable=False),
        sa.Column("start_count", sa.BigInteger(), nullable=False),
        sa.Column("finish_count", sa.BigInteger(), nullable=False),
        sa.Column("count_delta", sa.BigInteger(), nullable=False),
        sa.Column("is_linked", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_linked_override", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("override_reason", sa.Text(), nullable=True),
        sa.Column("adjustment", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.clock_timestamp()),
        sa.CheckConstraint("start_count >= 0 AND finish_count >= 0", name="chk_rides_non_negative_counts"),
        sa.CheckConstraint(
            "(is_linked_override = false) OR (is_linked_override = true AND override_reason IS NOT NULL AND length(trim(override_reason)) > 0)",
            name="chk_ride_override_reason_required",
        ),
        sa.UniqueConstraint("session_id", "ride_type", "ride_number", name="uq_session_ride_number"),
    )
    op.create_index("ix_session_rides_session_id", "session_rides", ["session_id"])

    # 3. Session overrides table
    op.create_table(
        "session_overrides",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ride_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("session_rides.id", ondelete="SET NULL"), nullable=True),
        sa.Column("field_name", sa.String(length=100), nullable=False),
        sa.Column("original_value", sa.Text(), nullable=True),
        sa.Column("replacement_value", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("actor_id", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.clock_timestamp()),
        sa.CheckConstraint("length(trim(reason)) > 0", name="chk_override_reason_not_empty"),
    )
    op.create_index("ix_session_overrides_session_id", "session_overrides", ["session_id"])

    # 4. Session reviews table
    op.create_table(
        "session_reviews",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reviewer_id", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="pending"),
        sa.Column("comments", sa.Text(), nullable=True),
        sa.Column("checklist_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_invalidated", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidation_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.clock_timestamp()),
    )
    op.create_index("ix_session_reviews_session_id", "session_reviews", ["session_id"])

    # 5. Audit events table (Append-only)
    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sessions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("sequence_num", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("actor_id", sa.String(length=255), nullable=False),
        sa.Column("client_operation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.clock_timestamp()),
        sa.Column("event_summary", sa.Text(), nullable=False),
        sa.Column("affected_field", sa.String(length=100), nullable=True),
        sa.Column("before_value", sa.Text(), nullable=True),
        sa.Column("after_value", sa.Text(), nullable=True),
        sa.Column("override_reason", sa.Text(), nullable=True),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("previous_event_hash", sa.String(length=64), nullable=False),
        sa.Column("event_hash", sa.String(length=64), nullable=False),
        sa.UniqueConstraint("session_id", "sequence_num", name="uq_audit_session_sequence"),
    )
    op.create_index("ix_audit_events_session_sequence", "audit_events", ["session_id", "sequence_num"])


def downgrade() -> None:
    op.drop_index("ix_audit_events_session_sequence", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_index("ix_session_reviews_session_id", table_name="session_reviews")
    op.drop_table("session_reviews")
    op.drop_index("ix_session_overrides_session_id", table_name="session_overrides")
    op.drop_table("session_overrides")
    op.drop_index("ix_session_rides_session_id", table_name="session_rides")
    op.drop_table("session_rides")
    op.drop_table("sessions")

