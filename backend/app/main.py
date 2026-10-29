"""FastAPI Application Entry Point for Authoritative Calculation Service."""

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes.calculations import router as calculations_router
from app.schemas.calculations import ProblemDetail
from app.services.calculation_engine import ENGINE_VERSION, RULESET_VERSION

app = FastAPI(
    title="Bicycle Calibration Calculation Service",
    version=ENGINE_VERSION,
    description=(
        "Authoritative, deterministic calculation service for bicycle calibration "
        "and road course measurement. All outputs are strictly provisional pending "
        "ratification of governing measurement policies MP-01 through MP-09."
    ),
    docs_url="/docs",
    redoc_url="/redoc",
)

# Include Versioned API Routes
app.include_router(calculations_router, prefix="/api/v1")


@app.get("/api/v1/health", tags=["System"])
def health_check():
    """Health check endpoint providing engine version, ruleset version, and provisional status."""
    return {
        "status": "healthy",
        "engine_version": ENGINE_VERSION,
        "ruleset_version": RULESET_VERSION,
        "is_provisional": True,
        "policy_notice": "PROVISIONAL — NOT FOR OFFICIAL CERTIFICATION (Unratified Policy MP-01..MP-09)",
    }


# =========================================================================
# Structured RFC 7807 / RFC 9457 Problem Details Exception Handlers
# =========================================================================

@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    problem = ProblemDetail(
        type=f"https://httpstatuses.com/{exc.status_code}",
        title=exc.detail if isinstance(exc.detail, str) else "HTTP Error",
        status=exc.status_code,
        detail=str(exc.detail),
        instance=str(request.url.path),
    )
    return JSONResponse(
        status_code=exc.status_code,
        content=problem.model_dump(exclude_none=True),
        headers={"Content-Type": "application/problem+json"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = [
        {"loc": [str(loc) for loc in err["loc"]], "msg": err["msg"], "type": err["type"]}
        for err in exc.errors()
    ]
    problem = ProblemDetail(
        type="https://httpstatuses.com/422",
        title="Request Validation Error",
        status=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail="The request payload failed schema validation rules.",
        instance=str(request.url.path),
        invalid_params=errors,
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content=problem.model_dump(exclude_none=True),
        headers={"Content-Type": "application/problem+json"},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Avoid leaking internal stack traces in production responses
    problem = ProblemDetail(
        type="https://httpstatuses.com/500",
        title="Internal Server Error",
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="An unexpected internal error occurred. Please consult server logs with correlation ID.",
        instance=str(request.url.path),
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=problem.model_dump(exclude_none=True),
        headers={"Content-Type": "application/problem+json"},
    )
