# Calibration-Measurement

Bicycle Calibration & Course Measurement Application MVP.

This web application calculates bicycle wheel calibration factors (counts/km), temperature corrections, and course distances based on Jones Counter readings across pre-calibration, intermediate, and post-calibration stages.

## Features & Verification Status

- **Calculation Correctness**: Dynamic resolution of working constants based on user-selected measurement policy rules (`larger`, `average`, or provisional pre-calibration values).
- **Local-First Persistence**: IndexedDB persistence for calibration sessions, measurement readings, overrides, and audit trails.
- **Provisional Policy Transparency**: Explicit status badges and audit warnings ensuring unverified measurement rules are not treated as official certifications.
- **Automated Regression Suite**: 62 unit and integration tests covering calculation correctness, rule permutations, edge cases, and storage concurrency.

## Getting Started

### Prerequisites
- Node.js (v18+)
- npm

### Installation
```bash
npm install
```

### Unified Runner & Quality Gates (`run.sh`)

A single script manages the full stack, database auto-start, environment initialization, and verification gates:

```bash
# 1. Run all quality gates (Postgres check, Alembic, Pytest, TSC, ESLint, Vitest, Vite Build)
./run.sh check

# 2. Run all quality gates INCLUDING full Playwright E2E browser tests
./run.sh check --e2e

# 3. Start full local development stack (Postgres + FastAPI + Vite dev server)
./run.sh dev

# 4. Targeted test runners
./run.sh test:backend       # Run backend Pytest suite (or pass specific test files/args)
./run.sh test:frontend      # Run frontend Vitest suite
./run.sh test:e2e           # Run Playwright browser tests

# 5. Database lifecycle
./run.sh db:up              # Ensure PostgreSQL container is running
./run.sh db:migrate         # Apply latest Alembic migrations
```

### Manual Individual Commands
```bash
# Run automated frontend unit tests
npm run test

# Run frontend Playwright E2E tests
npm run test:e2e

# Run backend Python test suite
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -q

# Typecheck
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build
```

## Backend & Database Setup (Phase 10.2)

The application includes an authoritative FastAPI backend with PostgreSQL 16 persistence and an append-only cryptographic audit ledger.

### 1. Launch PostgreSQL Container
```bash
docker compose up -d
```
Runs a local PostgreSQL 16 container bound strictly to loopback (`127.0.0.1:5433`).

### 2. Run Database Migrations
```bash
PYTHONPATH=backend backend/.venv/bin/alembic -c backend/alembic.ini upgrade head
```

For full details, see [`backend/README.md`](file:///media/sda3/Projects/Calibration/backend/README.md).

## Documentation

- [Phase 10.2 PostgreSQL Persistence and Audit Report](docs/PHASE_10_2_POSTGRESQL_PERSISTENCE_AUDIT_REPORT.md)
- [Phase 10.1.1 Independent Review Report](docs/PHASE_10_1_1_INDEPENDENT_REVIEW_REPORT.md)
- [Phase 10 Production Architecture](docs/PHASE_10_PRODUCTION_ARCHITECTURE.md)
- [Phase 10 Architecture Decision Records](docs/PHASE_10_ARCHITECTURE_DECISIONS.md)
- [Phase 10 Threat Model](docs/PHASE_10_THREAT_MODEL.md)
- [User Roles & Autonomous Workflow](docs/USER_ROLES_AND_WORKFLOW.md)
- [Feature Implementation Matrix](docs/FEATURE_IMPLEMENTATION_MATRIX.md)

  --email "admin@calibration.local" \
  --password "AdminSecPass2026!" \
  --name "Lead Administrator" \
  --role "admin" \
  --organization "World Athletics / AIMS" \
  --non-interactive
