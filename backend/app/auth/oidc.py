"""OpenID Connect (OIDC) token validation service.

Implements cryptographically rigorous, fail-closed JWT validation against
trusted OIDC providers and JSON Web Key Sets (JWKS).
"""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Union
import httpx
import jwt
from jwt import PyJWKClient, PyJWK, PyJWKClientError
from app.core.config import settings


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class OIDCValidationError(Exception):
    """Base exception for all OIDC token validation failures."""
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class TokenExpiredError(OIDCValidationError):
    """Raised when token has expired past its exp claim plus clock skew."""


class InvalidSignatureError(OIDCValidationError):
    """Raised when cryptographic signature does not match public signing key."""


class InvalidIssuerError(OIDCValidationError):
    """Raised when token issuer (iss) does not match configured trusted issuer."""


class InvalidAudienceError(OIDCValidationError):
    """Raised when token audience (aud) does not contain expected API audience."""


class MissingClaimError(OIDCValidationError):
    """Raised when a mandatory standard claim (sub, iss, aud, exp) is absent."""


class UnsupportedAlgorithmError(OIDCValidationError):
    """Raised when token requests an algorithm outside explicit allowlist."""


class SigningKeyNotFoundError(OIDCValidationError):
    """Raised when the key identifier (kid) is not found in provider JWKS."""


class JWKSRetrievalError(OIDCValidationError):
    """Raised when the provider JWKS or discovery endpoint cannot be reached."""


# ---------------------------------------------------------------------------
# Data Models
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TokenPayload:
    """Validated OIDC token claims."""
    sub: str
    iss: str
    aud: Union[str, List[str]]
    exp: int
    nbf: Optional[int] = None
    iat: Optional[int] = None
    email: Optional[str] = None
    email_verified: bool = False
    name: Optional[str] = None
    raw_claims: Dict[str, Any] = None


# ---------------------------------------------------------------------------
# Validator
# ---------------------------------------------------------------------------

class OIDCValidator:
    """Validates JWT access/ID tokens against an OIDC provider or explicit JWKS."""

    def __init__(
        self,
        issuer_url: Optional[str] = None,
        audience: Optional[str] = None,
        allowed_algorithms: Optional[List[str]] = None,
        clock_skew_seconds: Optional[int] = None,
        jwks_cache_ttl: Optional[int] = None,
        discovery_url: Optional[str] = None,
        jwks_uri: Optional[str] = None,
        static_keys: Optional[Dict[str, Any]] = None,
    ):
        self.issuer_url = (issuer_url or settings.OIDC_ISSUER_URL).rstrip("/")
        self.audience = audience or settings.OIDC_AUDIENCE
        self.allowed_algorithms = allowed_algorithms or settings.OIDC_ALLOWED_ALGORITHMS
        self.clock_skew_seconds = (
            clock_skew_seconds
            if clock_skew_seconds is not None
            else settings.OIDC_CLOCK_SKEW_SECONDS
        )
        self.jwks_cache_ttl = (
            jwks_cache_ttl
            if jwks_cache_ttl is not None
            else settings.OIDC_JWKS_CACHE_TTL_SECONDS
        )
        self.discovery_url = discovery_url or settings.OIDC_DISCOVERY_URL
        self._explicit_jwks_uri = jwks_uri
        self._cached_jwks_uri: Optional[str] = None
        self._jwks_client: Optional[PyJWKClient] = None
        # Static keys mapping kid -> public_key (used for deterministic testing)
        self._static_keys: Dict[str, Any] = static_keys or {}

    def set_static_key(self, kid: str, public_key: Any) -> None:
        """Register a static public key for testing without live HTTP fetching."""
        self._static_keys[kid] = public_key

    def clear_static_keys(self) -> None:
        """Clear all registered static keys."""
        self._static_keys.clear()

    def get_jwks_uri(self) -> str:
        """Resolve the JWKS URI from explicit config or OIDC discovery metadata."""
        if self._explicit_jwks_uri:
            return self._explicit_jwks_uri
        if self._cached_jwks_uri:
            return self._cached_jwks_uri

        discovery_endpoint = self.discovery_url or f"{self.issuer_url}/.well-known/openid-configuration"
        try:
            with httpx.Client(timeout=5.0) as client:
                res = client.get(discovery_endpoint)
                if res.status_code != 200:
                    raise JWKSRetrievalError(
                        f"Failed to fetch OIDC discovery document from '{discovery_endpoint}': HTTP {res.status_code}"
                    )
                data = res.json()
        except httpx.RequestError as exc:
            raise JWKSRetrievalError(
                f"Network error retrieving OIDC discovery document: {exc}"
            ) from exc

        # Security check: discovery document issuer must match configured issuer exactly
        doc_issuer = data.get("issuer", "").rstrip("/")
        if doc_issuer != self.issuer_url:
            raise InvalidIssuerError(
                f"OIDC discovery issuer '{doc_issuer}' does not match configured issuer '{self.issuer_url}'"
            )

        jwks_uri = data.get("jwks_uri")
        if not jwks_uri:
            raise JWKSRetrievalError("Discovery document does not contain 'jwks_uri'")

        self._cached_jwks_uri = jwks_uri
        return jwks_uri

    def _get_jwks_client(self) -> PyJWKClient:
        """Lazily initialize and return the PyJWKClient."""
        if self._jwks_client is None:
            uri = self.get_jwks_uri()
            self._jwks_client = PyJWKClient(
                uri,
                cache_keys=True,
                max_cached_keys=32,
                cache_jwk_set=True,
                lifespan=self.jwks_cache_ttl,
                headers={"User-Agent": "BicycleCalibration-Backend/0.1.0"},
                timeout=5,
            )
        return self._jwks_client

    def validate_token(self, token: str) -> TokenPayload:
        """Cryptographically validates a JWT token and returns verified claims.
        
        Performs:
        1. Algorithm allowlist validation (strictly rejects 'none', symmetric algos, etc.).
        2. Key retrieval by 'kid' with key rotation support.
        3. Signature verification with public key.
        4. Expiry, issuer, audience, and not-before claims verification.
        5. Subject presence and non-emptiness validation.
        """
        if not token or not isinstance(token, str):
            raise OIDCValidationError("Token must be a non-empty string.")

        # Step 1: Extract and validate unverified header
        try:
            header = jwt.get_unverified_header(token)
        except Exception as exc:
            raise OIDCValidationError("Malformed token header.") from exc

        alg = header.get("alg")
        if not alg:
            raise UnsupportedAlgorithmError("Token header missing 'alg'.")
        if alg.lower() == "none":
            raise UnsupportedAlgorithmError("Algorithm 'none' is strictly prohibited.")
        if alg not in self.allowed_algorithms:
            raise UnsupportedAlgorithmError(
                f"Algorithm '{alg}' is not in allowed algorithms: {self.allowed_algorithms}"
            )

        kid = header.get("kid")
        # Symmetric keys (HS*) should not be used in OIDC asymmetric flow
        if alg.startswith("HS"):
            raise UnsupportedAlgorithmError(f"Symmetric algorithm '{alg}' rejected for OIDC.")

        # Step 2: Resolve public signing key
        signing_key: Any = None
        if self._static_keys:
            if kid and kid in self._static_keys:
                signing_key = self._static_keys[kid]
            elif not kid and len(self._static_keys) == 1:
                signing_key = next(iter(self._static_keys.values()))
            else:
                raise SigningKeyNotFoundError(f"Signing key with kid '{kid}' not found in registered keys.")

        if signing_key is None:
            try:
                client = self._get_jwks_client()
                # PyJWKClient automatically attempts key refresh on unknown kid
                jwk = client.get_signing_key_from_jwt(token)
                signing_key = jwk.key
            except PyJWKClientError as exc:
                err_msg = str(exc).lower()
                if "could not find a signing key" in err_msg or "not found" in err_msg:
                    raise SigningKeyNotFoundError(f"Signing key with kid '{kid}' not found in JWKS.") from exc
                raise JWKSRetrievalError(f"Failed to retrieve JWKS signing key: {exc}") from exc
            except Exception as exc:
                raise JWKSRetrievalError(f"Error accessing JWKS: {exc}") from exc

        # Step 3: Decode and verify claims
        try:
            decoded = jwt.decode(
                token,
                signing_key,
                algorithms=self.allowed_algorithms,
                audience=self.audience,
                issuer=self.issuer_url,
                leeway=self.clock_skew_seconds,
                options={
                    "require": ["exp", "iss", "sub", "aud"],
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_nbf": True,
                    "verify_iat": False,
                    "verify_aud": True,
                    "verify_iss": True,
                },
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenExpiredError("Token has expired.") from exc
        except jwt.InvalidSignatureError as exc:
            raise InvalidSignatureError("Signature verification failed.") from exc
        except jwt.InvalidIssuerError as exc:
            raise InvalidIssuerError("Token issuer mismatch.") from exc
        except jwt.InvalidAudienceError as exc:
            raise InvalidAudienceError("Token audience mismatch.") from exc
        except jwt.MissingRequiredClaimError as exc:
            raise MissingClaimError(f"Token missing mandatory claim: {exc}") from exc
        except jwt.ImmatureSignatureError as exc:
            raise OIDCValidationError("Token is not yet valid (nbf).") from exc
        except jwt.DecodeError as exc:
            raise OIDCValidationError(f"Malformed or undecodable token: {exc}") from exc
        except Exception as exc:
            raise OIDCValidationError(f"Token verification error: {exc}") from exc

        # Step 4: Validate subject
        sub = decoded.get("sub")
        if not sub or not str(sub).strip():
            raise MissingClaimError("Token subject (sub) claim cannot be empty.")

        # Extract standard profile claims if present
        email = decoded.get("email")
        if email and not isinstance(email, str):
            email = None
        email_verified = bool(decoded.get("email_verified", False))
        name = decoded.get("name")
        if name and not isinstance(name, str):
            name = None

        return TokenPayload(
            sub=str(sub),
            iss=decoded["iss"],
            aud=decoded["aud"],
            exp=decoded["exp"],
            nbf=decoded.get("nbf"),
            iat=decoded.get("iat"),
            email=email,
            email_verified=email_verified,
            name=name,
            raw_claims=decoded,
        )


# Global default validator instance
oidc_validator = OIDCValidator()
