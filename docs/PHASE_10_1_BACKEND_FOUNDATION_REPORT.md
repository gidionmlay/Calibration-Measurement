# Phase 10.1 — Core Backend Foundation and Authoritative Calculation Service Report

**Project:** Bicycle Calibration Calculation / Road Course Measurement Application  
**Repository:** `/media/sda3/Projects/Calibration`  
**Working Branch:** `feature/phase-6-controlled-pilot`  
**Date:** 2026-10-29  
**Status:** Implementation Complete & Verified (Milestone 10.1)  
**Governing Measurement Policy Status:** Unratified (MP-01 through MP-09 Unapproved — Provisional Guardrails Preserved)  

---

## 1. Executive Summary

Milestone 10.1 establishes the authoritative, server-side calculation service for the Bicycle Calibration Calculation platform, fulfilling the architectural requirements outlined in [`docs/PHASE_10_PRODUCTION_ARCHITECTURE.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_10_PRODUCTION_ARCHITECTURE.md) and [`docs/PHASE_10_IMPLEMENTATION_ROADMAP.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_10_IMPLEMENTATION_ROADMAP.md).

### Key Accomplishments
1. **Isolated Pure Calculation Engine (`backend/app/services/calculation_engine.py`):** Implemented a deterministic, pure Python calculation service using `Decimal` arithmetic. Operates completely independently of FastAPI, HTTP transports, databases, and browser state.
2. **Phase 8 Golden Reference Parity (`backend/tests/test_reference_vectors.py`):** Ported all **33 Golden Reference Test Vectors** established in Phase 8 (`src/utils/calculationValidation.test.ts`), verifying arithmetic parity between the TypeScript presentation engine and the Python authoritative engine.
3. **Strict Pydantic Validation Schemas (`backend/app/schemas/calculations.py`):** Request/response contracts with explicit units (`course_length_m`, `course_length_km`, `distance_km`, `counts_per_km`), discrete non-negative integer count checks (`ge=0`), division-by-zero prevention, and mandatory override reason enforcement.
4. **Versioned REST API Endpoints (`backend/app/api/routes/calculations.py`):** Exposed `/api/v1/calculations/calibration`, `/api/v1/calculations/course-distance`, `/api/v1/calculations/compare`, and `/api/v1/health`.
5. **RFC 7807 / RFC 9457 Problem Details (`backend/app/main.py`):** Standardized, machine-readable error responses preventing internal stack-trace leaks.
6. **Zero Disruption to Existing Frontend:** The React SPA remains completely intact, passing all 131 Vitest unit tests, 14 Playwright E2E browser scenarios, and zero TypeScript compiler errors.

---

## 2. Repository Baseline and Preservation

Before implementation, repository state was inspected and recorded:
- **Active Branch:** `feature/phase-6-controlled-pilot`
- **HEAD Commit:** `bf9094b2e739df610d32651d568f5494e257406f`
- **Working Tree State:** All tracked modifications in `/src`, `docs/`, `package.json`, and `vite.config.ts`, and untracked Phase 4–10 documentation were preserved. No changes were stashed, reset, discarded, committed, or pushed.

---

## 3. Backend Structure and Technology Stack

The Python backend was established in `/media/sda3/Projects/Calibration/backend`:

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                     # FastAPI application entry point & RFC 7807 exception handlers
│   ├── api/
│   │   ├── __init__.py
│   │   └── routes/
│   │       ├── __init__.py
│   │       └── calculations.py     # Versioned endpoints (/api/v1/calculations/*)
│   ├── schemas/
│   │   ├── __init__.py
│   │   └── calculations.py         # Pydantic v2 validation contracts & ProblemDetail schema
│   └── services/
│       ├── __init__.py
│       └── calculation_engine.py  # Pure, deterministic Decimal calculation engine
├── tests/
│   ├── __init__.py
│   ├── test_calibration.py         # Calibration calculations, sequential linkage & API tests
│   ├── test_course_distance.py     # Course distance, division-by-zero & comparison tests
│   ├── test_validation.py          # Pydantic validation, negative counts & RFC 7807 error tests
│   └── test_reference_vectors.py   # Ported 33 Phase 8 Golden Reference Vectors
├── pyproject.toml                  # Python package configuration and dependencies
├── .gitignore                      # Python virtualenv and cache exclusions
└── README.md                       # Installation, test execution, and loopback deployment guide
```

### Dependency Stack
- **Python Version:** Python 3.13.5 (configured for $\ge 3.11$).
- **Core Framework:** `fastapi` $\ge 0.110.0$ (installed `0.162.0`).
- **Validation:** `pydantic` $\ge 2.6.0$ (installed `2.14.1`, `pydantic-core` `2.50.1`).
- **ASGI Server:** `uvicorn` $\ge 0.28.0$ (installed `0.54.0`).
- **Test Framework:** `pytest` $\ge 8.0.0$ (installed `9.2.0`), `httpx` $\ge 0.27.0$ (installed `0.28.1`).

---

## 4. Authoritative Calculation Engine Design and Numeric Representation

### 4.1 Pure Functional Isolation
The calculation engine in `app/services/calculation_engine.py` does not import FastAPI, Starlette, databases, or environment variables. All functions accept discrete primitives or immutable dataclasses (`RideInput`, `RolloverConfig`) and return immutable calculation results (`CalibrationCalculationResult`, `CourseDistanceCalculationResult`).

### 4.2 Exact Rational Arithmetic via Python `Decimal`
In course measurement arithmetic, floating-point rounding errors can introduce subtle discrepancies when converting between metres and kilometres, or during working constant division. The Python calculation engine implements:
1. **Rational Precision:**
   $$C_{avg} = \frac{\sum d_i}{N}$$
   $$CPK = \frac{C_{avg} \times 1000}{L_m}$$
   $$WC = CPK \times 1.001$$
   $$Distance_{km} = \frac{T}{WC}$$
2. **Elimination of Intermediate Float Rounding:** All intermediate values are retained in `Decimal` format with full precision.
3. **Explicit Boundary Rounding:** Rounding is applied only at designated presentation boundaries:
   - Working Constant: 4 decimal places (`ROUND_HALF_UP`), e.g. `4967.4625`.
   - Course Distance: 3 decimal places (`ROUND_HALF_UP`), e.g. `39.548` km.

### 4.3 Numeric Comparison with TypeScript IEEE 754 Engine
The TypeScript engine (`src/utils/calibration.ts`) evaluates arithmetic using standard IEEE 754 64-bit double precision floats. Comparing the Python `Decimal` results with the TypeScript floating-point outputs demonstrates:
- **Course Distance Calculation:** $196454 / 4967.4625 = 39.54815964887823377759247656\dots\text{ km}$
- Floating-point difference between engines: $< 10^{-14}$ (relative tolerance $< 10^{-12}$).
- Both engines round to the identical string representation: `"39.548"` km.

### 4.4 Rollover Configuration Handling
The engine implements three explicit rollover modes:
- `none`: Rejects any reading where $\text{finish} < \text{start}$ with `"Finish is lower than start, and this counter is set as non-wrapping."`
- `notConfigured`: Rejects any reading where $\text{finish} < \text{start}$ with `"Finish is lower than start. Rollover handling is not configured, so no rollover is assumed."`
- `wrap`: Requires `max_reading` (e.g. `999999`). Validates that both start and finish do not exceed `max_reading`. Calculates:
  $$\text{adjustment} = \text{max\_reading} + 1$$
  $$\text{count} = \text{finish} + \text{adjustment} - \text{start}$$

---

## 5. Ported Phase 8 Golden Reference Vectors

All 33 reference vectors from Phase 8 (`src/utils/calculationValidation.test.ts`) were ported into `backend/tests/test_reference_vectors.py` and executed against the Python calculation service:

| Vector ID | Description | Input Values | Expected Derivation | Python Engine Actual | Comparison & Tolerance | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **REF-VEC-01** | Ride 1 Difference | Start 11082, Finish 12021 | $12021 - 11082 = 939$ | 939 | Exact integer equality | **PASS** |
| **REF-VEC-02** | Ride 2 Difference | Start 12021, Finish 13042 | $13042 - 12021 = 1021$ | 1021 | Exact integer equality | **PASS** |
| **REF-VEC-03** | Ride 3 Difference | Start 13042, Finish 14052 | $14052 - 13042 = 1010$ | 1010 | Exact integer equality | **PASS** |
| **REF-VEC-04** | Ride 4 Difference | Start 14052, Finish 15052 | $15052 - 14052 = 1000$ | 1000 | Exact integer equality | **PASS** |
| **REF-VEC-05** | Total Count $D$ | Ride diffs [939, 1021, 1010, 1000] | $\sum = 3970$ | 3970 | Exact integer equality | **PASS** |
| **REF-VEC-06** | Average Count $C_{avg}$ | $D = 3970, N = 4$ | $3970 / 4 = 992.5$ | `Decimal("992.5")` | Exact Decimal equality | **PASS** |
| **REF-VEC-07** | Course Length in km | Course 200 m | $200 / 1000 = 0.2\text{ km}$ | `Decimal("0.2")` | Exact Decimal equality | **PASS** |
| **REF-VEC-08** | Counts Per Kilometre | $C_{avg} = 992.5, L_{km} = 0.2$ | $992.5 / 0.2 = 4962.5$ | `Decimal("4962.5")` | Exact Decimal equality | **PASS** |
| **REF-VEC-09** | Working Constant $WC$ | $CPK = 4962.5, \text{SCPF} = 1.001$ | $4962.5 \times 1.001 = 4967.4625$ | `Decimal("4967.4625")` | Exact Decimal equality | **PASS** |
| **REF-VEC-10** | WC Formatting | $WC = 4967.4625, \text{dec} = 4$ | `"4967.4625"` | `"4967.4625"` | Exact string equality | **PASS** |
| **REF-VEC-11** | Course Count $T$ | Start 124002, Finish 320456 | $320456 - 124002 = 196454$ | 196454 | Exact integer equality | **PASS** |
| **REF-VEC-12** | Course Distance km | Count 196454, WC 4967.4625 | $196454 / 4967.4625 \approx 39.548159648878$ | $39.54815964887823\dots$ | Rel. tol $< 10^{-12}$ | **PASS** |
| **REF-VEC-13** | Distance Formatting | Distance $39.5481596\dots\text{ km}$ | `"39.548"` (3 decimals) | `"39.548"` | Exact string equality | **PASS** |
| **REF-VEC-14** | Zero Difference Count | Start 5000, Finish 5000 | $5000 - 5000 = 0$ | 0 | Exact integer equality | **PASS** |
| **REF-VEC-15** | Non-Wrapping Rejection | Start 5000, Finish 4999, mode `none` | Error: non-wrapping | `ok=False`, error string | Exception / error match | **PASS** |
| **REF-VEC-16** | Unconfigured Rollover | Start 5000, Finish 4999, `notConfigured` | Error: not configured | `ok=False`, error string | Exception / error match | **PASS** |
| **REF-VEC-17** | Wrapped Count Calculation | Start 999980, Finish 20, Max 999999 | $20 + 1000000 - 999980 = 40$ | 40, adjustment 1000000 | Exact integer equality | **PASS** |
| **REF-VEC-18** | Wrap Reading Exceeds Max | Start 1000005 > Max 999999 | Error: exceeds maximum | `ok=False`, error string | Exception / error match | **PASS** |
| **REF-VEC-19** | Zero Course Length | Course length = "0" | Error: greater than zero | `ValueError` raised | Exception match | **PASS** |
| **REF-VEC-20** | Negative Course Length | Course length = "-500.5" | Error: greater than zero | `ValueError` raised | Exception match | **PASS** |
| **REF-VEC-21** | Empty Course Length | Course length = "   " | Error: invalid course length | `ValueError` raised | Exception match | **PASS** |
| **REF-VEC-22** | Malformed Course Length | Course length = "200m" | Error: invalid course length | `ValueError` raised | Exception match | **PASS** |
| **REF-VEC-23** | Decimal Course Length | Course length = "333.333" | Parsed as `Decimal("333.333")` | `Decimal("333.333")` | Exact Decimal equality | **PASS** |
| **REF-VEC-24** | Extremely Small Course | Length 0.001 m, Avg 1000 | $1000 \times 1000 / 0.001 = 10^9$ | `Decimal("1000000000")` | Exact Decimal equality | **PASS** |
| **REF-VEC-25** | Extremely Large Course | Length 50000 m, Avg 1000 | $1000 \times 1000 / 50000 = 20$ | `Decimal("20")` | Exact Decimal equality | **PASS** |
| **REF-VEC-26** | Valid Integer Reading | Start 0, Finish 124002 | Count = 124002 | 124002 | Exact integer equality | **PASS** |
| **REF-VEC-27** | Negative Start Reading | Start -100, Finish 2000 | Error: non-negative integers | `ok=False`, error string | Error string match | **PASS** |
| **REF-VEC-28** | Negative Finish Reading | Start 1000, Finish -50 | Error: non-negative integers | `ok=False`, error string | Error string match | **PASS** |
| **REF-VEC-29** | Large Reading Safety | Start $10^8$, Finish $10^9 - 1$ | Count = 899,999,999 | 899999999 | Exact integer equality | **PASS** |
| **REF-VEC-30** | Pre WC on Incomplete Post | Pre 4967.4625, Post notConfigured | Uses Pre WC, `ruleNotConfigured` | Pre WC, `is_provisional=True` | Value & reason match | **PASS** |
| **REF-VEC-31** | Not Configured Rule | Rule `notConfigured` | Uses Pre WC, `ruleNotConfigured` | Pre WC, `is_provisional=True` | Value & reason match | **PASS** |
| **REF-VEC-32** | 'Larger' Rule Selection | Pre 4967.4625, Post 5005.0 | Selects 5005.0, `ruleNotApproved` | `Decimal("5005.0")` | Exact Decimal equality | **PASS** |
| **REF-VEC-33** | 'Average' Rule Selection | Pre 4967.4625, Post 5005.0 | $(4967.4625 + 5005.0) / 2 = 4986.23125$ | `Decimal("4986.23125")` | Exact Decimal equality | **PASS** |

---

## 6. Endpoints, Schemas, and Error Handling

### 6.1 API Endpoints Implemented

1. **`GET /api/v1/health`**
   - Returns service health, `engine_version` (`1.0.0-python`), `ruleset_version` (`ws-0.3-provisional`), and provisional notice.
2. **`POST /api/v1/calculations/calibration`**
   - Ingests `CalibrationRequest` with sequential ride counts and course length in metres.
   - Computes differences, total, average, CPK, WC, spread, and returns `CalibrationResponse`.
3. **`POST /api/v1/calculations/course-distance`**
   - Ingests `CourseDistanceRequest` with start count, finish count, working constant, and rollover config.
   - Computes net course counts and distance in kilometres formatted to 3 decimal places.
4. **`POST /api/v1/calculations/compare`**
   - Ingests `ComparisonRequest` with pre- and post-calibration working constants and rule selection.
   - Computes signed difference, percentage drift, and governing constant under unratified policy guardrails.

### 6.2 RFC 7807 / RFC 9457 Problem Details Formatting
All error responses adhere to the RFC 7807 / RFC 9457 standard, returning structured JSON with header `Content-Type: application/problem+json`:
```json
{
  "type": "https://httpstatuses.com/422",
  "title": "Request Validation Error",
  "status": 422,
  "detail": "The request payload failed schema validation rules.",
  "instance": "/api/v1/calculations/course-distance",
  "invalid_params": [
    {
      "loc": ["body", "start_count"],
      "msg": "Input should be greater than or equal to 0",
      "type": "greater_than_equal"
    }
  ]
}
```

---

## 7. Provisional Policy Handling

In accordance with [`docs/MEASUREMENT_POLICY_DECISION_REGISTER.md`](file:///media/sda3/Projects/Calibration/docs/MEASUREMENT_POLICY_DECISION_REGISTER.md):
- Policies MP-01 through MP-09 remain **unratified**.
- All calculation responses explicitly embed:
  ```json
  "is_provisional": true,
  "policy_notice": "PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION (Unratified Policy MP-01..MP-09)"
  ```
- Constant comparison responses include `ruleNotApproved` in the `reasons` list unless `policy_approved` is explicitly passed as true.
- **Session finalization remains completely omitted and disabled.**

---

## 8. Test Execution and Quality-Gate Summary

### 8.1 Backend Test Results (pytest)
- **Command:** `PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -v`
- **Result:** **46 passed, 0 failed (100% pass rate)** in 8.70s:
  - `test_reference_vectors.py`: 33 passed (all 33 Golden Reference Vectors).
  - `test_calibration.py`: 4 passed (pure engine, overrides, API endpoint, invalid length).
  - `test_course_distance.py`: 4 passed (pure distance, division-by-zero, API endpoint, comparison).
  - `test_validation.py`: 5 passed (health, negative counts, zero length, missing override reason, wrap mode).

### 8.2 Frontend Test Regression Results
- **TypeScript Compiler (`npx tsc --noEmit`):** **PASS** (0 errors).
- **ESLint (`npm run lint`):** **PASS** (0 errors, 22 pre-existing style warnings).
- **Vitest Unit Suite (`npm run test`):** **PASS** (8 / 8 test files passed, 131 / 131 tests passed).
- **Production Bundle (`npm run build`):** **PASS** (Built in 42.88s; 0 sourcemap leaks).
- **Playwright Browser E2E Suite (`npm run test:e2e`):** **PASS** (14 / 14 browser scenarios passed across Chromium).

---

## 9. Known Limitations and Security Boundaries

1. **Development Server Network Binding:** The development server is configured to bind strictly to loopback (`127.0.0.1:8000`) to prevent local network exposure.
2. **Stateless Service:** This milestone does not include database persistence, user accounts, or session models. These are scheduled for Milestone 10.2 (PostgreSQL) and Milestone 10.3 (OIDC/RBAC).
3. **No Frontend API Integration Yet:** The React client continues to use its in-memory calculation engine. Client-server synchronization is scheduled for Milestone 10.4.

---

## 10. Milestone 10.1 Readiness Verdict and Next Steps

| Assessment Dimension | Rating | Technical Basis |
| :--- | :---: | :--- |
| **Backend Calculation Engine** | **PASS** | Pure, deterministic Python `Decimal` calculation engine complete and verified. |
| **Reference Vector Parity** | **PASS** | 33 / 33 Phase 8 Golden Reference Vectors verified with $\le 10^{-12}$ float parity. |
| **API Endpoints & Schemas** | **PASS** | Versioned `/api/v1/calculations/*` endpoints with RFC 7807 problem details active. |
| **Frontend Zero Disruption** | **PASS** | 131/131 Vitest tests and 14/14 Playwright E2E browser tests passing cleanly. |
| **Provisional Policy Status** | **PRESERVED** | Policies MP-01..MP-09 remain unratified; finalization remains blocked. |
| **Milestone 10.1 Status** | **COMPLETE** | Prerequisites for Milestone 10.2 established. |

### Prerequisites Before Milestone 10.2 Begins:
1. Project owner review of [`docs/PHASE_10_ARCHITECTURE_DECISIONS.md`](file:///media/sda3/Projects/Calibration/docs/PHASE_10_ARCHITECTURE_DECISIONS.md) (ADR-10-01, ADR-10-02, ADR-10-03).
2. Selection of PostgreSQL deployment target (local Docker container vs managed database).
3. Approval to initialize SQLAlchemy 2.0 models and Alembic migration scripts.
