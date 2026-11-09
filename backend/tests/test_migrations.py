"""Automated tests for Alembic migration execution, upgrade, and downgrade."""

import os
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.conftest import test_engine, TEST_DB_URL


def test_migration_downgrade_and_upgrade_lifecycle(monkeypatch):
    """Verify that Alembic can downgrade to base and upgrade back to head cleanly on live PostgreSQL."""
    monkeypatch.setenv("DATABASE_URL", TEST_DB_URL)
    alembic_ini_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    alembic_cfg = Config(alembic_ini_path)
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DB_URL)

    # 1. Downgrade to base
    command.downgrade(alembic_cfg, "base")

    with test_engine.connect() as conn:
        res = conn.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema='public';")
        )
        tables = [row[0] for row in res.fetchall()]
        assert "sessions" not in tables
        assert "audit_events" not in tables
        assert "users" not in tables

    # 2. Upgrade to head
    command.upgrade(alembic_cfg, "head")

    with test_engine.connect() as conn:
        res = conn.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema='public';")
        )
        tables = [row[0] for row in res.fetchall()]
        assert "sessions" in tables
        assert "session_rides" in tables
        assert "session_overrides" in tables
        assert "session_reviews" in tables
        assert "audit_events" in tables
        assert "users" in tables
        assert "alembic_version" in tables

        # Verify database-level append-only trigger is registered
        trg_res = conn.execute(
            text("SELECT trigger_name FROM information_schema.triggers WHERE event_object_table='audit_events';")
        )
        triggers = [row[0] for row in trg_res.fetchall()]
        assert "trg_protect_audit_events_mutation" in triggers
