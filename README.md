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

### Development Server
```bash
npm run dev
```

### Run Tests & Verification
```bash
# Run automated tests
npm run test

# Typecheck
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build
```

## Documentation

- [Prototype Audit Report](docs/PROTOTYPE_AUDIT_REPORT.md)
- [Feature Implementation Matrix](docs/FEATURE_IMPLEMENTATION_MATRIX.md)
- [Phase 1 Remediation Report](docs/REMEDIATION_PHASE_1_REPORT.md)
- [Phase 2 Remediation Report](docs/REMEDIATION_PHASE_2_REPORT.md)
- [Phase 3 Verification Report](docs/PHASE_3_VERIFICATION_REPORT.md)
