# Architectural Decision Record (ADR-10-07): Identity Provider (IdP) Selection & Provider-Neutral OIDC Architecture

**Project:** Bicycle Calibration & Course Measurement Application  
**Milestone:** Phase 10.3.1 — OIDC Identity and Authentication Foundation  
**Status:** **APPROVED & ARCHITECTED (Provider-Neutral OIDC with Keycloak Dev Reference)**  
**Date:** 2026-11-07  
**Decision Authority:** Senior Backend Architect & Security Verification Auditor  

---

## 1. Context & Business Drivers

The Bicycle Calibration & Course Measurement system requires verified identity and non-repudiation for all measurement operations, calibration readings, and audit events. 

In Phase 10.1 and 10.2, the system operated with provisional actor strings (e.g. `provisional:measurer`, `provisional:system`). To achieve audit integrity, road race certification defensibility, and compliance with modern zero-trust security principles, the application must transition to verified identities authenticated via standard **OpenID Connect (OIDC)** and **OAuth 2.0 Authorization Code Flow with Proof Key for Code Exchange (PKCE)**.

The project must decide on its identity provider architecture while satisfying two competing operational environments:
1. **Local / Disconnected / Private Deployment:** Field measurement teams, national federations, or air-gapped staging environments that cannot rely on public internet SaaS providers or external recurring billing.
2. **Managed Cloud Production Deployment:** Scalable, highly available production clusters with managed SLAs, compliance certifications (SOC2, ISO 27001), automated security patching, and built-in multi-factor authentication (MFA/WebAuthn).

---

## 2. Evaluation Criteria

The evaluation evaluated identity provider candidates against nine architectural criteria:

1. **OIDC & OAuth 2.0 Standards Compliance:** Strict adherence to OIDC Core 1.0, RFC 7519 (JWT), RFC 7517 (JWKS), RFC 7636 (PKCE), and RFC 8414 (OAuth 2.0 Authorization Server Metadata).
2. **Authorization Code Flow with PKCE:** First-class support for single-page applications (React/Vite) without client secrets in the browser and without vulnerable implicit flows.
3. **Local Development & Offline Feasibility:** Ability to spin up a fully isolated, zero-cost development instance in Docker without external internet connectivity or vendor account lock-in.
4. **User & Identity Lifecycle Management:** Support for user lifecycle states (`active`, `disabled`, `suspended`), email verification status, and stable immutable subject identifiers (`sub`).
5. **Role & Group Claims Management:** Capability to emit verified role and scope claims (`measurer`, `reviewer`, `supervisor`, `auditor`, `admin`) into access tokens for Phase 10.3.2 RBAC.
6. **Operational Complexity & Maintenance Burden:** Resource footprint, database dependencies, software update lifecycle, and administrative overhead.
7. **Backup, Disaster Recovery & High Availability:** Simplicity of backing up identity databases and restoring credentials.
8. **Cost & Usage Predictability:** Cost per active user (MAU), enterprise feature gating, and license predictability.
9. **Vendor Portability:** Freedom to migrate between self-hosted and cloud providers without changing backend code or database schemas.

---

## 3. Candidate Comparison

### Candidate A: Keycloak (Self-Hosted Reference Provider)
Keycloak is an open-source, CNCF-incubated identity and access management solution maintained by the Red Hat community.

- **Strengths:**
  - 100% open-source (Apache 2.0); zero recurring licensing or per-user costs.
  - Complete OIDC and OAuth 2.0 feature set including Authorization Code Flow with PKCE.
  - Container-native (`quay.io/keycloak/keycloak`): runs in Docker Compose alongside PostgreSQL.
  - Full admin console for managing realms, clients, users, credentials, and role mappings.
  - Can be run completely offline in field networks or private air-gapped environments.
- **Weaknesses:**
  - Significant memory footprint (~500MB–1GB RAM per instance; Quarkus/JVM runtime).
  - High operational maintenance: the hosting team is responsible for PostgreSQL database backups, Keycloak version upgrades, CVE patching, and high-availability clustering.
  - Configuration complexity: requires configuring realms, scopes, client mappers, and signing keys.

### Candidate B: Managed OIDC Provider (Auth0 / Okta / AWS Cognito / Google Cloud Identity)
Managed Identity-as-a-Service (IDaaS) platforms.

- **Strengths:**
  - Zero server maintenance: fully managed high availability, automated security patching, and DDoS protection.
  - Turnkey MFA (SMS, authenticator apps, WebAuthn/FIDO2 security keys), anomaly detection, and brute-force protection.
  - Out-of-the-box SOC2, ISO 27001, and HIPAA compliance attestations.
  - Rapid setup for cloud production deployments.
- **Weaknesses:**
  - Hard dependency on public internet connectivity (fails in offline field calibration scenarios without gateway relays).
  - Vendor lock-in risks, proprietary APIs outside standard OIDC endpoints, and tier-based pricing escalation (e.g. enterprise SSO/SAML paywalls).
  - Inconvenient for lightweight local integration tests and automated CI pipelines without mock servers or cloud test tenants.

---

## 4. Architectural Decision: Provider-Neutral OIDC Architecture

### Selected Strategy: **Provider-Neutral OIDC Validation with Dual-Target Deployment**

Rather than tightly coupling the application to Keycloak-specific or Auth0-specific APIs, the architecture adopts a **Strict Provider-Neutral OIDC Standard**:

1. **Standardized Protocols Only:**
   The backend and frontend interact with the identity provider **exclusively** through standard OpenID Connect specifications:
   - Discovery Endpoint: `GET {issuer}/.well-known/openid-configuration`
   - JWKS Endpoint: `GET {jwks_uri}`
   - Authorization Endpoint: `{authorization_endpoint}?response_type=code&code_challenge=...`
   - Token Endpoint: `POST {token_endpoint}` (grant_type=authorization_code, code_verifier=...)
   - Standard Claims: `iss`, `sub`, `aud`, `exp`, `nbf`, `iat`, `email`, `email_verified`, `name`.

2. **Decoupled Identity Storage:**
   The application database persists users using a compound unique key on `(issuer, subject)`. The internal application identity is an immutable, internally generated `UUID`. Application database tables never store external provider-specific primary keys.

3. **Environment Deployment Model:**
   - **Local Development, Testing, and On-Premise/Field Deployments:** Use **Keycloak** (or a lightweight test issuer in automated CI) configured via standard environment variables.
   - **Cloud Production Deployments:** Use an enterprise **Managed OIDC Provider** (such as Auth0, Google Cloud Identity, or AWS Cognito) by simply updating the environment variables (`OIDC_ISSUER_URL`, `OIDC_AUDIENCE`, `OIDC_CLIENT_ID`). **Zero lines of backend or frontend code change between development and cloud production.**

---

## 5. Deployment & Configuration Specification

### Environment Configuration Contract

| Environment Variable | Description | Example (Keycloak Dev) | Example (Cloud Auth0 Prod) |
| :--- | :--- | :--- | :--- |
| `OIDC_ISSUER_URL` | Base URL of OIDC Issuer (must match `iss` claim exactly) | `http://127.0.0.1:8080/realms/calibration` | `https://auth.calibration-pilot.org/` |
| `OIDC_AUDIENCE` | Expected audience (`aud` claim) for backend API access | `calibration-backend-api` | `https://api.calibration-pilot.org/v1` |
| `OIDC_CLIENT_ID` | Public OAuth 2.0 client ID for frontend PKCE flow | `calibration-web-client` | `calib_app_client_prod_id` |
| `OIDC_JWKS_CACHE_TTL_SECONDS` | In-memory cache duration for public signing keys | `3600` (1 hour) | `86400` (24 hours) |
| `OIDC_ALLOWED_ALGORITHMS` | Comma-delimited list of accepted cryptographic algorithms | `RS256,ES256` | `RS256` |
| `OIDC_CLOCK_SKEW_SECONDS` | Allowed clock-skew leeway for `exp` and `nbf` | `30` | `60` |
| `OIDC_AUTO_PROVISION_USERS` | Whether to automatically create user rows on first auth | `true` | `true` |

---

## 6. Migration and Portability Assessment

- **Switching Identity Providers:**
  If an organization migrates from Keycloak to Auth0 or vice versa, user accounts can either be linked via an administrative migration script (updating `issuer` and `subject`), or new accounts provisioned with historical audit records remaining cryptographically verifiable under the original immutable `(issuer, subject)` reference.
- **Fail-Closed Security:**
  If any required OIDC configuration is missing or malformed in production (`ENVIRONMENT=production`), the FastAPI application fails startup immediately rather than falling back to unauthenticated or insecure defaults.

