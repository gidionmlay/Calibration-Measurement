# Authoritative Calculation Backend (Milestone 10.1)

Authoritative, deterministic Python calculation service for the **Bicycle Calibration Calculation / Road Course Measurement Platform**.

> [!IMPORTANT]
> **PROVISIONAL STATUS:** All calculation outputs are strictly **PROVISIONAL** and **NOT FOR OFFICIAL CERTIFICATION**. Governing road measurement policies MP-01 through MP-09 remain unratified by governing athletic authorities. Official session finalization is disabled.

---

## 1. Overview & Architecture

This service acts as the server-side authoritative calculation boundary defined in [`docs/PHASE_10_PRODUCTION_ARCHITECTURE.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_10_PRODUCTION_ARCHITECTURE.md):
- **Pure Arithmetic Service (`app/services/calculation_engine.py`):** Uses Python `Decimal` to eliminate floating-point rounding noise. Operates completely independent of HTTP transports, database connections, and browser state.
- **Strict Validation Schemas (`app/schemas/calculations.py`):** Enforces discrete non-negative integer counts, strictly positive course lengths, division-by-zero protection, and mandatory override reasons using Pydantic v2.
- **RESTful Endpoints (`app/api/routes/calculations.py`):** Exposes versioned endpoints (`/api/v1/calculations/calibration`, `/api/v1/calculations/course-distance`, `/api/v1/calculations/compare`) returning structured JSON with RFC 7807 / RFC 9457 Problem Details error responses.

---

## 2. Environment Prerequisites

- **Python Version:** Supported on Python 3.11, 3.12, and 3.13 (verified on Python 3.13.5).
- **Virtual Environment:** Recommended under `backend/.venv`.

---

## 3. Installation & Setup

```bash
# Navigate to the backend directory
cd backend

# Create virtual environment
python3 -m venv .venv

# Activate virtual environment
source .venv/bin/activate

# Install dependencies
pip install -e ".[dev]"
```

---

## 4. Running the Tests

The test suite runs with `pytest` and verifies 46 unit, API, and mathematical reference tests:

```bash
# From within the backend directory:
pytest -v

# Or from the project root:
PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -v
```

### Reference Vector Coverage (Phase 8 Parity)
The test suite includes `tests/test_reference_vectors.py`, which executes all **33 Golden Reference Vectors** established in Phase 8 (`src/utils/calculationValidation.test.ts`), verifying arithmetic parity between the TypeScript presentation engine and the Python authoritative engine.

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
