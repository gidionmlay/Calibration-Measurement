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


def test_session_creation_rejects_course_length_exceeding_scale(auth_client: TestClient):
    """Verify course_length_m with > 4 decimal places is rejected (DEF-02 prevention)."""
    payload = {
        "name": "Excess Scale Session",
        "course_length_m": "200.12345",  # 5 decimal places (> 4)
        "rides": [],
    }
    response = auth_client.post("/api/v1/sessions", json=payload)
    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"
    data = response.json()
    assert "cannot exceed 4 decimal places" in str(data)


def test_session_creation_rejects_course_length_exceeding_precision(auth_client: TestClient):
    """Verify course_length_m with > 12 digits precision is rejected."""
    payload = {
        "name": "Excess Precision Session",
        "course_length_m": "123456789.1234",  # 13 digits (> 12)
        "rides": [],
    }
    response = auth_client.post("/api/v1/sessions", json=payload)
    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"
    data = response.json()
    assert "cannot exceed 12 digits" in str(data)


def test_session_creation_rejects_temperature_exceeding_scale_and_precision(auth_client: TestClient):
    """Verify temperature_c with > 2 decimal places or > 5 digits precision is rejected."""
    # Scale violation
    payload_scale = {
        "name": "Excess Temp Scale Session",
        "course_length_m": "200.0000",
        "temperature_c": "25.123",  # 3 decimal places (> 2)
        "rides": [],
    }
    res_scale = auth_client.post("/api/v1/sessions", json=payload_scale)
    assert res_scale.status_code == 422
    assert "cannot exceed 2 decimal places" in str(res_scale.json())

    # Precision/bounds violation
    payload_prec = {
        "name": "Excess Temp Precision Session",
        "course_length_m": "200.0000",
        "temperature_c": "1234.56",  # 6 total digits (> 5) / exceeds 999.99
        "rides": [],
    }
    res_prec = auth_client.post("/api/v1/sessions", json=payload_prec)
    assert res_prec.status_code == 422
    err_str = str(res_prec.json())
    assert "out of allowable bounds" in err_str or "cannot exceed 5 digits" in err_str

