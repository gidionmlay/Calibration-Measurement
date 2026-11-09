# Authoritative Calculation Backend & PostgreSQL Persistence (Milestones 10.1–10.2)

Authoritative, deterministic Python calculation service, PostgreSQL persistence, and append-only cryptographic audit ledger for the **Bicycle Calibration Calculation / Road Course Measurement Platform**.

> [!IMPORTANT]
> **PROVISIONAL STATUS:** All calculation outputs are strictly **PROVISIONAL** and **NOT FOR OFFICIAL CERTIFICATION**. Governing road measurement policies MP-01 through MP-09 remain unratified by governing athletic authorities. Official session finalization is disabled.

---

## 1. Overview & Architecture

This service acts as the server-side authoritative calculation boundary and persistence engine defined in [`docs/PHASE_10_PRODUCTION_ARCHITECTURE.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_10_PRODUCTION_ARCHITECTURE.md):
- **Pure Arithmetic Service (`app/services/calculation_engine.py`):** Uses Python `Decimal` to eliminate floating-point rounding noise. Operates completely independent of HTTP transports, database connections, and browser state.
- **Strict Validation Schemas (`app/schemas/calculations.py`, `app/schemas/session.py`, `app/schemas/audit.py`):** Enforces discrete non-negative integer counts, strictly positive course lengths, division-by-zero protection, and mandatory override reasons using Pydantic v2.
- **Relational Persistence Models (`app/models/`):** Normalized SQLAlchemy 2.0 models for sessions, rides, overrides, reviews, and audit events with PostgreSQL check constraints and exact Decimal (`NUMERIC`) columns.
- **Append-Only Cryptographic Audit Ledger (`app/audit/`):** Transactionally coupled event ledger with deterministic RFC 8785 canonical JSON serialization, SHA-256 hash chaining, application immutability listeners blocking UPDATE/DELETE, and verification engine (`verify_audit_ledger`).
- **Optimistic Concurrency Control:** Version-based concurrency check preventing silent lost updates with RFC 7807 Problem Details HTTP 409 responses.
- **RESTful Endpoints:** Versioned endpoints for calculations (`/api/v1/calculations/*`) and session persistence / audit verification (`/api/v1/sessions/*`).

---

## 2. Environment Prerequisites

- **Python Version:** Supported on Python 3.11, 3.12, and 3.13 (verified on Python 3.13.5).
- **PostgreSQL Database:** PostgreSQL 16+ via Docker Compose (bound to loopback `127.0.0.1:5433`).
- **Container Engine:** Podman or Docker.

---

## 3. Local Development Setup

### A. Environment Configuration
Copy `.env.example` to `.env` if custom database parameters are needed:
```bash
cp .env.example .env
```

### B. Start PostgreSQL via Docker Compose
From repository root:
```bash
docker compose up -d
```
This launches a PostgreSQL 16 container bound strictly to loopback (`127.0.0.1:5433`).

### C. Install Python Dependencies
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

### D. Run Database Migrations
Apply the initial schema migration using Alembic:
```bash
PYTHONPATH=backend backend/.venv/bin/alembic -c backend/alembic.ini upgrade head
```

---

## 4. Running the Tests

The backend test suite executes 79 tests covering pure math, reference vectors, persistence models, database constraints, transactions, optimistic concurrency, and audit ledger integrity:

```bash
# Run all backend tests
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -v
```

### Test Coverage Highlights:
- **Reference Vectors (`test_reference_vectors.py`):** 33 golden reference vectors from Phase 8.
- **Database Models & Constraints (`test_persistence_models.py`):** Round-trip Decimal precision, check constraints, ride linkage, and review invalidation.
- **Transactional Rollback (`test_transactions.py`):** Atomicity of session update and audit logging; complete rollback on failure.
- **Audit Cryptographic Integrity (`test_audit_integrity.py`):** SHA-256 hash chaining, canonical JSON determinism, and tamper detection.
- **Optimistic Concurrency (`test_concurrency.py`):** Conflict resolution with HTTP 409 Problem Details on stale versions.
- **API Endpoints (`test_session_api.py`):** Session lifecycle, recalculation, and audit verification.
- **Migration Lifecycle (`test_migrations.py`):** Clean downgrade to base and upgrade to head on live PostgreSQL.

---

## 5. Running the Development Server

To prevent LAN-based network attacks, the development server binds strictly to **loopback (`127.0.0.1`)**:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Interactive OpenAPI documentation is available at:
- Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`
- Health check: `http://127.0.0.1:8000/api/v1/health`
