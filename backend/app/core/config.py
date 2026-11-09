"""Application configuration module.

Reads environment variables safely without leaking secrets into logs or exceptions.
"""

import os
from typing import Optional


class Settings:
    """Core application settings with safe defaults for local development."""

    def __init__(self):
        # Database URLs (psycopg v3)
        self.DATABASE_URL: str = os.getenv(
            "DATABASE_URL",
            "postgresql+psycopg://calibration_user:calibration_dev_password@127.0.0.1:5433/calibration_dev",
        )
        self.TEST_DATABASE_URL: str = os.getenv(
            "TEST_DATABASE_URL",
            "postgresql+psycopg://calibration_user:calibration_dev_password@127.0.0.1:5433/calibration_test",
        )

        # Environment name
        self.ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

        # Database connection pool settings
        self.DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "5"))
        self.DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "10"))
        self.DB_POOL_TIMEOUT: int = int(os.getenv("DB_POOL_TIMEOUT", "30"))

        # OIDC Authentication Configuration
        self.OIDC_ISSUER_URL: str = os.getenv(
            "OIDC_ISSUER_URL",
            "http://127.0.0.1:8080/realms/calibration",
        ).rstrip("/")
        self.OIDC_AUDIENCE: str = os.getenv(
            "OIDC_AUDIENCE",
            "calibration-backend-api",
        )
        self.OIDC_CLIENT_ID: str = os.getenv(
            "OIDC_CLIENT_ID",
            "calibration-web-client",
        )
        self.OIDC_DISCOVERY_URL: Optional[str] = os.getenv("OIDC_DISCOVERY_URL")
        self.OIDC_JWKS_CACHE_TTL_SECONDS: int = int(
            os.getenv("OIDC_JWKS_CACHE_TTL_SECONDS", "3600")
        )
        raw_algos = os.getenv("OIDC_ALLOWED_ALGORITHMS", "RS256,ES256")
        self.OIDC_ALLOWED_ALGORITHMS: list[str] = [
            alg.strip() for alg in raw_algos.split(",") if alg.strip()
        ]
        self.OIDC_CLOCK_SKEW_SECONDS: int = int(os.getenv("OIDC_CLOCK_SKEW_SECONDS", "30"))
        self.OIDC_AUTO_PROVISION_USERS: bool = (
            os.getenv("OIDC_AUTO_PROVISION_USERS", "true").lower() in ("true", "1", "yes")
        )

        # Local Authentication & JWT Settings
        self.JWT_SECRET_KEY: str = os.getenv(
            "JWT_SECRET_KEY", "calibration-insecure-dev-secret-change-in-prod-0123456789"
        )
        self.JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
        self.ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
            os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")  # 24 hours
        )
        self.REFRESH_TOKEN_EXPIRE_DAYS: int = int(
            os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30")  # 30 days
        )

        # Validate production security
        if self.ENVIRONMENT == "production":
            if not self.OIDC_ISSUER_URL or not self.OIDC_ISSUER_URL.startswith("https://"):
                raise ValueError("OIDC_ISSUER_URL must be a secure HTTPS URL in production mode.")
            if not self.OIDC_AUDIENCE:
                raise ValueError("OIDC_AUDIENCE must be set in production mode.")

    @property
    def safe_database_url(self) -> str:
        """Returns database URL with password masked for safe logging/diagnostics."""
        try:
            from urllib.parse import urlparse, urlunparse
            parsed = urlparse(self.DATABASE_URL)
            if parsed.password:
                netloc = f"{parsed.username}:***@{parsed.hostname}"
                if parsed.port:
                    netloc += f":{parsed.port}"
                return urlunparse(parsed._replace(netloc=netloc))
            return self.DATABASE_URL
        except Exception:
            return "postgresql://***@***"


settings = Settings()

