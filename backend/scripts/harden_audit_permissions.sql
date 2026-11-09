-- PostgreSQL Hardening Script for Append-Only Audit Ledger
-- 
-- In a multi-role production environment, the application service connects using
-- a restricted role (e.g. 'calibration_app_user') while migrations run as 'postgres' or 'migration_admin'.
--
-- This script revokes UPDATE, DELETE, and TRUNCATE privileges from the application user on 'audit_events'.

-- Revoke mutation rights from public and standard application users
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_events FROM PUBLIC;

-- Example: Grant least-privilege permissions to application runtime role
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'calibration_app_user') THEN
--     GRANT SELECT, INSERT ON TABLE audit_events TO calibration_app_user;
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sessions TO calibration_app_user;
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_rides TO calibration_app_user;
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_overrides TO calibration_app_user;
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_reviews TO calibration_app_user;
--   END IF;
-- END
-- $$;

