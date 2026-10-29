# Phase 10.1.1 — Independent Backend Review and Defect Remediation Report

**Date:** 2026-10-29  
**Reviewer Role:** Senior Python Backend Engineer, Calculation-Systems Reviewer, API Security Reviewer, and Software Quality Engineer  
**Project:** Bicycle Calibration Calculation / Road Course Measurement Application  
**Repository Working Path:** `/media/sda3/Projects/Calibration`  
**Target Milestone:** Phase 10.1.1 — Independent Backend Review and Defect Remediation  
**Prerequisite:** Phase 10.1 Core Backend Foundation (`docs/PHASE_10_1_BACKEND_FOUNDATION_REPORT.md`)  
**Subsequent Phase:** Phase 10.2 PostgreSQL Persistence and Append-Only Audit Ledger (Pending Verification)  

---

## Executive Summary

An independent, evidence-based code review and defect remediation milestone was conducted on the Phase 10.1 Python backend foundation. The review inspected every calculation path in [`backend/app/services/calculation_engine.py`](file:///media/sda3/Projects/Calibration/backend/app/services/calculation_engine.py), all Pydantic validation schemas in [`backend/app/schemas/calculations.py`](file:///media/sda3/Projects/Calibration/backend/app/schemas/calculations.py), API route handlers in [`backend/app/api/routes/calculations.py`](file:///media/sda3/Projects/Calibration/backend/app/api/routes/calculations.py), application lifecycle in [`backend/app/main.py`](file:///media/sda3/Projects/Calibration/backend/app/main.py), dependency definitions in [`backend/pyproject.toml`](file:///media/sda3/Projects/Calibration/backend/pyproject.toml), and all 4 test suites under [`backend/tests/`](file:///media/sda3/Projects/Calibration/backend/tests/).

The review uncovered **5 concrete defects** (2 High, 2 Medium, 1 Low severity) spanning incomplete post-calibration handling, non-finite Decimal ingestion, binary float/boolean type safety, test suite execution fidelity across reference vectors 05–10, and framework deprecation warnings. All 5 defects were surgically remediated in code and backed by targeted regression test coverage. Test suite coverage was expanded from 46 to **54 passing backend tests** (100% pass rate). All existing frontend quality gates (TypeScript compiler, ESLint, Vitest, Vite production build, Playwright E2E) were executed and confirmed completely intact without regressions.

All provisional policy safeguards (MP-01 through MP-09) remain unratified and strictly enforced. No Phase 10.2 database models, Alembic migrations, or authentication mechanisms were introduced.

---

## 1. Review Scope and Repository Baseline

### 1.1 Git Working-Tree Baseline
- **Branch:** `feature/phase-6-controlled-pilot`
- **Starting HEAD Commit:** `bf9094b2e739df610d32651d568f5494e257406f`
- **Working-Tree Status:** Dirty with preserved user changes from earlier phases (Phase 6–9 prototypes and Phase 10.1 backend foundation).
- **Branch Safety Enforcement:** No branch switching, resets, stashes, commits, tags, or pushes were performed.
- **Implementation Scope:** Limited strictly to Phase 10.1 backend review and defect remediation. No database tables, ORM models, or PostgreSQL drivers were added.

### 1.2 Inspected File Surface
1. [`backend/app/services/calculation_engine.py`](file:///media/sda3/Projects/Calibration/backend/app/services/calculation_engine.py): Pure Python Decimal arithmetic, ride resolution, rollover calculation, spread metrics, and constant comparisons.
2. [`backend/app/schemas/calculations.py`](file:///media/sda3/Projects/Calibration/backend/app/schemas/calculations.py): Pydantic v2 schemas for request validation, response serialization, and RFC 7807 / RFC 9457 Problem Details.
3. [`backend/app/api/routes/calculations.py`](file:///media/sda3/Projects/Calibration/backend/app/api/routes/calculations.py): FastAPI route endpoints (`/api/v1/calculations/calibration`, `/course-distance`, `/compare`).
4. [`backend/app/main.py`](file:///media/sda3/Projects/Calibration/backend/app/main.py): Application entry point, exception handlers, and `/api/v1/health`.
5. [`backend/pyproject.toml`](file:///media/sda3/Projects/Calibration/backend/pyproject.toml): Build system, package dependencies, and pytest configuration.
6. [`backend/tests/test_reference_vectors.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_reference_vectors.py): 33 Phase 8 golden reference vectors.
7. [`backend/tests/test_calibration.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_calibration.py): Calibration calculation unit and API tests.
8. [`backend/tests/test_course_distance.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_course_distance.py): Course distance and comparison tests.
9. [`backend/tests/test_validation.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_validation.py): Boundary and validation tests.
10. [`src/utils/calculationValidation.test.ts`](file:///media/sda3/Projects/Calibration/src/utils/calculationValidation.test.ts): Source TypeScript golden reference vector derivations.
11. [`src/utils/calibration.ts`](file:///media/sda3/Projects/Calibration/src/utils/calibration.ts): Frontend calculation engine and constant resolution rules.

---

## 2. Baseline Quality-Gate Results (Pre-Review)

Prior to modifying code, the pre-existing test suites and quality gates were executed to establish a reproducible baseline:

| Gate | Execution Command | Pre-Review Baseline Result | Notes |
| :--- | :--- | :--- | :--- |
| **Backend Pytest** | `PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -v` | **Passed: 46 / 46 (100%)** | 6 Starlette deprecation warnings recorded |
| **Frontend Typecheck** | `npx tsc --noEmit` | **Passed: 0 errors** | Clean TypeScript compilation |
| **Frontend Lint** | `npm run lint` | **Passed: 0 errors, 22 warnings** | Pre-existing non-null assertion warnings |
| **Frontend Unit Tests** | `npm run test` | **Passed: 8 / 8 files, 131 / 131 tests (100%)** | Clean Vitest execution |
| **Frontend Build** | `npm run build` | **Passed: 0 errors** | Vite v5.4.21 bundle generated in 51.83s |
| **Frontend E2E** | `npm run test:e2e` | **Passed: 14 / 14 tests (100%)** | Full Playwright Chromium run in 2.5m |

---

## 3. Findings & Defect Register

| Finding ID | Severity | Affected Component | Defect Description | Remediation Applied | Remediation Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **DEF-01** | **HIGH** | `compare_calibrations` & schemas | `compare_calibrations` failed when `post_wc` was omitted or `None`. Required `post_wc` strictly positive, crashing when post-calibration was incomplete. `test_ref_vec_30` faked input with dummy post WC. | Updated `compare_calibrations` to accept `post_wc: Optional = None`. Returns `final_wc = dec_pre`, `difference = None`, `percent_change = None`, `reasons = ["postIncomplete"]`. Updated `ComparisonRequest` & `ComparisonResponse` schemas to allow optional `post_working_constant`. | **Fixed & Verified** |
| **DEF-02** | **MEDIUM** | `calculation_engine.py` & schemas | Engine accepted non-finite Decimal values (`Infinity`, `-Infinity`, `NaN`). Course length `"Infinity"` passed `> 0` check and produced zero working constant. `NaN` crashed with unhandled exception. | Added `is_finite()` guards in `calculate_calibration`, `calculate_course_distance`, and `compare_calibrations`. Added Pydantic field validators on Decimal inputs. | **Fixed & Verified** |
| **DEF-03** | **MEDIUM** | `calculation_engine.py` | Engine accepted binary `float` and `bool` values. `float` was present in Union types and converted via `str(float)`. In Python `isinstance(True, int)` is True, allowing booleans as counter readings. | Prohibited `float` and `bool` inputs in pure calculation functions, raising `TypeError` for floats/booleans and enforcing discrete whole integer readings in `calculate_ride_difference`. Added schema validation against fractional counts. | **Fixed & Verified** |
| **DEF-04** | **HIGH** | `test_reference_vectors.py` | `test_ref_vec_05` through `10` bypassed engine execution by computing sums and averages locally instead of asserting `calculate_calibration` outputs. Vector 30 faked inputs. Vector 28 lacked discrete fractional count test. | Refactored vectors 05–10 to execute against `calculate_calibration` with independent reference derivations. Fixed vector 30 with `post_wc=None`. Added vector 28b verifying non-integer/float reading rejection. | **Fixed & Verified** |
| **DEF-05** | **LOW** | `main.py` & `routes/calculations.py` | Use of deprecated `status.HTTP_422_UNPROCESSABLE_ENTITY` generated 9 `StarletteDeprecationWarning` logs during test execution. | Replaced with standard `status.HTTP_422_UNPROCESSABLE_CONTENT` (HTTP 422). | **Fixed & Verified** |

---

## 4. Decimal Arithmetic and Numeric Precision Assessment

### 4.1 Strict Avoidance of Binary Floating-Point
- **Invariant:** Calculations must not rely on IEEE 754 binary floats (`float`).
- **Audit Result:**
  - Before remediation, type hints across `calculate_calibration`, `calculate_course_distance`, and `compare_calibrations` accepted `Union[Decimal, str, int, float]`. Passing `200.0` converted `str(200.0)` which introduced risks of floating-point string representation artifacts.
  - Remediated: Binary floats are explicitly prohibited at the engine boundary:
    ```python
    if isinstance(course_length_m, (float, bool)):
        raise TypeError("Binary float or boolean inputs are prohibited; use Decimal, int, or numeric string.")
    ```
  - Exact Decimal objects are constructed exclusively from validated numeric strings or discrete integers.

### 4.2 Exact Formula Verification
The formulas verified against the product specification:
1. **Ride difference:** $d_i = B_i - A_i$ (exact integer arithmetic).
2. **Total count:** $D = \sum_{i=1}^4 d_i$ (exact integer sum).
3. **Average count:** $C_{avg} = D / 4$ (exact Decimal rational division; e.g. $3970 / 4 = 992.5$).
4. **Course length in kilometres:** $L_{km} = L_m / 1000$ (exact Decimal division; e.g. $200 / 1000 = 0.2$).
5. **Counts per kilometre (CPK):** $CPK = (C_{avg} \times 1000) / L_m$ (exact Decimal rational division; e.g. $(992.5 \times 1000) / 200 = 4962.5$).
6. **Working constant (WC):** $WC = CPK \times 1.001$ with `CORRECTION_FACTOR = Decimal("1.001")` (exact Decimal multiplication; e.g. $4962.5 \times 1.001 = 4967.4625$).
7. **Course count:** $T = F - S$ (exact integer difference with rollover adjustment).
8. **Measured distance:** $\text{distance\_km} = T / WC$ (full Decimal precision retained until output formatting boundary).

### 4.3 Retention of Internal Precision vs. Display Formatting
- The engine maintains exact `Decimal` precision throughout all arithmetic operations.
- Display formatting occurs strictly at defined boundary properties:
  - `working_constant_formatted`: 4 decimal places via `ROUND_HALF_UP` (`format_decimal(wc, 4)`).
  - `distance_km_formatted`: 3 decimal places via `ROUND_HALF_UP` (`format_decimal(dist, 3)`).
- Arithmetic results (`working_constant`, `distance_km`) remain unrounded Decimal objects in both dataclasses and JSON serialization.

---

## 5. Counter Rollover and Reading Validation Assessment

### 5.1 Invariants Enforced
1. **No Inferred Rollover:** When `finish < start`, rollover is NEVER automatically assumed.
   - If `rollover.mode == RolloverMode.NONE`, error: *"Finish is lower than start, and this counter is set as non-wrapping. Verify both readings."*
   - If `rollover.mode == RolloverMode.NOT_CONFIGURED`, error: *"Finish is lower than start. Rollover handling is not configured, so no rollover is assumed."*
2. **Explicit Modulus Required:** In `RolloverMode.WRAP`, `max_reading` must be explicitly provided. If omitted, rejected with *"counter maximum is not set"*.
3. **Reading Range Boundary Check:** If `start > max_reading` or `finish > max_reading`, rejected with *"A reading exceeds the configured counter maximum. Verify the readings."*
4. **Discrete Whole Integer Readings:** Negative values, floats, and booleans are strictly rejected.
5. **No Hardware Modulus Default:** No default hardware modulus (e.g. 99,999 or 999,999) is assumed or hardcoded. It remains an explicit operator setup requirement.

---

## 6. Golden Reference Vectors and Independence Assessment

All 33 reference vectors established in Phase 8 (`src/utils/calculationValidation.test.ts`) were reviewed against `backend/tests/test_reference_vectors.py`:

| Vector Range | Focus Area | Derivation Method | Python Test Status |
| :--- | :--- | :--- | :--- |
| **REF-VEC-01 to 04** | Individual Ride Differences | $12021-11082=939$, $13042-12021=1021$, $14052-13042=1010$, $15052-14052=1000$ | **Passed** |
| **REF-VEC-05 to 10** | 200m Course Derived Metrics | Independent manual sum (3970), average (992.5), course km (0.2), CPK (4962.5), WC (4967.4625), formatting ('4967.4625'). Tested directly against `calculate_calibration`. | **Passed (Remediated DEF-04)** |
| **REF-VEC-11 to 13** | Measured Course Distance | Independent count (196454), distance arithmetic ($196454 / 4967.4625 \approx 39.5481596$), formatted ('39.548'). | **Passed** |
| **REF-VEC-14 to 18** | Rollover & Counter Boundaries | Zero count ($5000 \to 5000$), non-wrapping rejection, unconfigured rejection, wrap count ($999980 \to 20 = 40$), reading $> \text{max}$ rejection. | **Passed** |
| **REF-VEC-19 to 25** | Course Length Validation | Rejection of 0, negative (-500.5), empty/whitespace, non-numeric text ('200m'); acceptance of decimal (333.333), small ($0.001\text{m} \to 10^9$), large ($50000\text{m} \to 20$). | **Passed** |
| **REF-VEC-26 to 29** | Reading Parsing & Safety | Valid discrete count (124002), negative start rejection, negative finish rejection, non-integer rejection (REF-VEC-28b), large reading safety ($10^8 \to 999,999,999 = 899,999,999$). | **Passed (Expanded)** |
| **REF-VEC-30 to 33** | Provisional Constant Rules | Incomplete post-calibration fallback to Pre WC (DEF-01), `notConfigured` rule, `larger` rule selection (5005.0), `average` rule arithmetic mean (4986.23125). | **Passed (Remediated DEF-01)** |

All expected values in the test suite are independently established from first principles rather than derived by re-invoking the code under test.

---

## 7. API Contract and RFC 7807 / RFC 9457 Problem Details Assessment

### 7.1 Request & Response Schemas
- **Calibration (`/api/v1/calculations/calibration`):** Recomputes all derived metrics server-side; ignores any client-supplied totals or averages.
- **Course Distance (`/api/v1/calculations/course-distance`):** Recomputes count difference and distance in km using exact Decimal division.
- **Comparison (`/api/v1/calculations/compare`):** Supports optional `post_working_constant`. When post-calibration is incomplete, cleanly returns pre WC as final working constant with `reasons: ["postIncomplete"]`.

### 7.2 Structured Error Handling
All error responses strictly comply with RFC 7807 / RFC 9457 Problem Details with Content-Type `application/problem+json`:
```json
{
  "type": "https://httpstatuses.com/422",
  "title": "Request Validation Error",
  "status": 422,
  "detail": "The request payload failed schema validation rules.",
  "instance": "/api/v1/calculations/calibration",
  "invalid_params": [
    {
      "loc": ["body", "course_length_m"],
      "msg": "Value error, course_length_m must be a finite number.",
      "type": "value_error"
    }
  ]
}
```
Stack traces, file paths, and internal implementation details are completely stripped from error payloads. Unhandled exceptions emit generic HTTP 500 Problem Details.

---

## 8. Dependency and Runtime Configuration Assessment

### 8.1 Dependencies (`backend/pyproject.toml`)
- **Runtime:** `fastapi>=0.115.0`, `uvicorn[standard]>=0.30.0`, `pydantic>=2.8.0`.
- **Development:** `pytest>=8.3.0`, `httpx>=0.27.0`.
- **Environment:** Resolved in `backend/.venv` under Python 3.13.5.
- No unnecessary dependencies or database drivers were added.

### 8.2 Network Binding & Security
- Documentation instructs binding strictly to loopback (`127.0.0.1:8000`).
- No open wildcard `0.0.0.0` binding is configured by default.
- Loopback binding is explicitly documented as a local development convenience, NOT a substitute for production authentication or transport security.

---

## 9. Code Modifications and Remediations Summary

| Modified File | Summary of Changes |
| :--- | :--- |
| [`backend/app/services/calculation_engine.py`](file:///media/sda3/Projects/Calibration/backend/app/services/calculation_engine.py) | 1. Made `post_wc`, `difference`, `percent_change` optional in `ConstantComparisonResult`.<br>2. Prohibited `float` and `bool` arguments across all public calculation functions.<br>3. Added `is_finite()` validation for all Decimal parsing.<br>4. Handled `post_wc is None` in `compare_calibrations` returning `reasons=["postIncomplete"]`. |
| [`backend/app/schemas/calculations.py`](file:///media/sda3/Projects/Calibration/backend/app/schemas/calculations.py) | 1. Made `post_working_constant` optional in `ComparisonRequest` and `ComparisonResponse`.<br>2. Added `@field_validator` for `is_finite()` on `course_length_m`, `working_constant`, and comparison constants. |
| [`backend/app/api/routes/calculations.py`](file:///media/sda3/Projects/Calibration/backend/app/api/routes/calculations.py) | 1. Replaced `status.HTTP_422_UNPROCESSABLE_ENTITY` with `status.HTTP_422_UNPROCESSABLE_CONTENT`.<br>2. Updated `compare_constants_endpoint` policy notice condition when `post_working_constant` is None. |
| [`backend/app/main.py`](file:///media/sda3/Projects/Calibration/backend/app/main.py) | Replaced `status.HTTP_422_UNPROCESSABLE_ENTITY` with `status.HTTP_422_UNPROCESSABLE_CONTENT` in validation exception handler. |
| [`backend/tests/test_reference_vectors.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_reference_vectors.py) | 1. Refactored vectors 05–10 to execute against `calculate_calibration` outputs.<br>2. Added vector 28b testing discrete integer reading enforcement.<br>3. Fixed vector 30 to test `post_wc=None` with `postIncomplete` reason. |
| [`backend/tests/test_calibration.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_calibration.py) | Added regression tests for binary float rejection, non-finite Decimal rejection, and API 422 on `Infinity`/`NaN`. |
| [`backend/tests/test_course_distance.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_course_distance.py) | Added regression tests for incomplete post-calibration in engine and API, binary float rejection, and non-finite WC rejection. |
| [`backend/tests/test_validation.py`](file:///media/sda3/Projects/Calibration/backend/tests/test_validation.py) | Added regression tests for fractional counter reading rejection (422) and non-finite comparison constants (422). |
| [`docs/FEATURE_IMPLEMENTATION_MATRIX.md`](file:///media/sda3/Projects/Calibration/docs/FEATURE_IMPLEMENTATION_MATRIX.md) | Updated Authoritative Calculation Service row to reflect Phase 10.1.1 remediation status and expanded test count (54 tests). |

---

## 10. Regression Tests Added

1. **`test_calibration_rejects_binary_float_course_length`:** Proves `calculate_calibration(rides, 200.0)` raises `TypeError` and blocks binary floats.
2. **`test_calibration_rejects_non_finite_course_length`:** Proves `Decimal("Infinity")` and `Decimal("NaN")` raise `ValueError("Course length must be a finite number")`.
3. **`test_calibration_api_rejects_non_finite_course_length`:** Proves API endpoint returns HTTP 422 Problem Details when payload has `"Infinity"`, `"-Infinity"`, or `"NaN"`.
4. **`test_constant_comparison_incomplete_post_calibration` (Pure Engine):** Proves `compare_calibrations(pre_wc="4967.4625", post_wc=None)` returns `final_working_constant=4967.4625`, `difference=None`, `percent_change=None`, and `reasons=["postIncomplete"]`.
5. **`test_constant_comparison_incomplete_post_calibration` (API Endpoint):** Proves POST `/api/v1/calculations/compare` with omitted `post_working_constant` returns HTTP 200 with provisional Pre WC and `postIncomplete` reason.
6. **`test_course_distance_rejects_binary_float_and_non_finite_wc`:** Proves `calculate_course_distance` rejects floats with `TypeError` and non-finite Decimals with `ValueError`.
7. **`test_pydantic_rejects_fractional_counter_readings`:** Proves Pydantic rejects `"124002.5"` and `124002.5` with HTTP 422 Problem Details.
8. **`test_comparison_endpoint_rejects_non_finite_constants`:** Proves `/compare` rejects non-finite constants with HTTP 422 Problem Details.
9. **`test_ref_vec_28b_discrete_non_integer_reading_rejection`:** Proves `calculate_ride_difference` rejects float readings (`124002.5`) and boolean readings (`True`).

---

## 11. Final Quality-Gate Results

All backend and frontend quality gates were executed following remediation:

| Quality Gate | Exact Command | Execution Result | Test Counts / Artifacts |
| :--- | :--- | :--- | :--- |
| **Backend Test Suite** | `PYTHONPATH=backend backend/.venv/bin/pytest backend/tests -v` | **PASSED** | **54 / 54 tests passed (100%)** in 7.17s; 0 failures; Starlette status deprecation warnings resolved |
| **Frontend TypeScript** | `npx tsc --noEmit` | **PASSED** | **0 errors**; complete type safety preserved |
| **Frontend ESLint** | `npm run lint` | **PASSED** | **0 errors**; 22 pre-existing style warnings |
| **Frontend Unit Tests** | `npm run test` | **PASSED** | **8 / 8 files passed, 131 / 131 tests passed (100%)** in 44.84s |
| **Frontend Production Build** | `npm run build` | **PASSED** | Production bundle built in 51.83s (`dist/index.html` 0.48 kB, `dist/assets/index-DSpItxaV.js` 477.16 kB) |
| **Frontend E2E Suite** | `npm run test:e2e -- --timeout=60000` | **PASSED** | **14 / 14 tests passed (100%)** in 2.0m |

---

## 12. Remaining Limitations and Unresolved Policy Decisions

### 12.1 Engineering Limitations
- The Python calculation service operates in-memory and stateless. It does not yet persist sessions or audit events to a database (scheduled for Phase 10.2).
- Client-side React application currently computes calculations locally in TypeScript; backend calculation integration into the frontend UI is scheduled for Phase 10.4.

### 12.2 Unresolved Measurement Policies (MP-01 through MP-09)
The following governing measurement policies remain **unratified** by the regulatory authority and must NOT be hardcoded as approved:
- **MP-01:** Course length standard boundaries (provisional range 200m–500m).
- **MP-02:** Ride-consistency spread tolerance threshold (provisional spread warning displayed).
- **MP-03:** Maximum allowable pre/post calibration drift tolerance.
- **MP-04:** Governing final constant selection rule (provisional rules: `larger`, `average`, `notConfigured`).
- **MP-05:** Counter rollover policy and hardware modulus approval.
- **MP-06:** Official rounding and reporting decimal precision conventions.
- **MP-07:** Formal operator review and sign-off workflow requirements.
- **MP-08:** Formal revision, superseding, and amendment policies for finalized sessions.
- **MP-09:** Multi-bicycle calibration policy.

All calculation outputs, API responses, and reports remain stamped with:
`PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION (Unratified Policy MP-01..MP-09)`.

---

## 13. Recommendation and Next Steps

### 13.1 Milestone Recommendation
**Recommendation: READY FOR PHASE 10.2 (PostgreSQL Persistence and Append-Only Audit Ledger).**

### 13.2 Justification
1. The Python calculation service is deterministic, rigorously tested, and operates strictly with validated Decimal arithmetic.
2. All 5 identified engineering defects (DEF-01 through DEF-05) have been remediated and verified with regression tests.
3. All 33 golden reference vectors are accounted for and executed directly against authoritative engine functions without shortcuts.
4. The backend and frontend test suites pass with 100% success across 54 Python tests, 131 Vitest unit tests, and 14 Playwright E2E tests.
5. Provisional policy boundaries are preserved intact.

### 13.3 Distinction Between Engineering Readiness and Official Certification
- **Engineering Readiness:** The calculation algorithms, schemas, validation rules, and error handlers are mathematically correct, secure, and robust enough to serve as the backend calculation layer for Phase 10.2 database persistence.
- **Official Certification:** The application CANNOT be used for official road course certification until the governing measurement authority officially ratifies measurement policies MP-01 through MP-09.
