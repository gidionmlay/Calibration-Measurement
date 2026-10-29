"""Validation and Error Handling Tests."""

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_endpoint():
    """Verify health endpoint returns 200, engine version, and provisional notice."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "1.0.0" in data["engine_version"]
    assert data["is_provisional"] is True
    assert "PROVISIONAL" in data["policy_notice"]


def test_pydantic_rejects_negative_counts():
    """Verify negative start count is rejected with 422 Problem Details."""
    payload = {
        "start_count": -5,
        "finish_count": 1000,
        "working_constant": "4967.4625",
    }
    response = client.post("/api/v1/calculations/course-distance", json=payload)
    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"
    data = response.json()
    assert data["status"] == 422
    assert data["title"] == "Request Validation Error"
    assert "invalid_params" in data


def test_pydantic_rejects_zero_or_negative_course_length():
    """Verify zero or negative course length is rejected with 422."""
    for bad_len in [0, -200]:
        payload = {
            "rides": [{"start": 1000, "finish": 2000}],
            "course_length_m": bad_len,
        }
        response = client.post("/api/v1/calculations/calibration", json=payload)
        assert response.status_code == 422
        assert response.headers["content-type"] == "application/problem+json"


def test_override_requires_reason():
    """Verify start_overridden=True requires non-empty override_reason."""
    payload = {
        "rides": [
            {"start": 1000, "finish": 2000},
            {"start": 2050, "finish": 3000, "start_overridden": True, "override_reason": "   "},
        ],
        "course_length_m": 200,
    }
    response = client.post("/api/v1/calculations/calibration", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert "override reason must be provided" in str(data)


def test_wrap_mode_requires_max_reading():
    """Verify wrap rollover mode requires max_reading."""
    payload = {
        "start_count": 999980,
        "finish_count": 20,
        "working_constant": "4967.4625",
        "rollover": {"mode": "wrap", "max_reading": None},
    }
    response = client.post("/api/v1/calculations/course-distance", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert "max_reading is required" in str(data)


def test_pydantic_rejects_fractional_counter_readings():
    """Regression DEF-03: Verify fractional decimal counts are rejected with 422."""
    for bad_count in ["124002.5", 124002.5]:
        payload = {
            "start_count": bad_count,
            "finish_count": 320456,
            "working_constant": "4967.4625",
        }
        response = client.post("/api/v1/calculations/course-distance", json=payload)
        assert response.status_code == 422
        assert response.headers["content-type"] == "application/problem+json"


def test_comparison_endpoint_rejects_non_finite_constants():
    """Regression DEF-02: Verify non-finite constants in compare endpoint are rejected."""
    for bad_wc in ["Infinity", "-Infinity", "NaN"]:
        payload = {
            "pre_working_constant": bad_wc,
            "post_working_constant": "5005.0000",
        }
        response = client.post("/api/v1/calculations/compare", json=payload)
        assert response.status_code == 422
        assert response.headers["content-type"] == "application/problem+json"
