"""Unit and API tests for course distance and constant comparison calculations."""

from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.calculation_engine import (
    calculate_course_distance,
    compare_calibrations,
    RolloverConfig,
    RolloverMode,
    FinalConstantRule,
)

client = TestClient(app)


def test_pure_course_distance_reference():
    """Verify course distance arithmetic against reference vector."""
    start = 124002
    finish = 320456
    wc = Decimal("4967.4625")

    res = calculate_course_distance(start, finish, wc)
    assert res.start_count == 124002
    assert res.finish_count == 320456
    assert res.course_count == 196454
    assert res.working_constant_applied == Decimal("4967.4625")

    # High precision Decimal verification
    expected_dec = Decimal("196454") / Decimal("4967.4625")
    assert res.distance_km == expected_dec
    assert res.distance_km_formatted == "39.548"
    assert res.is_provisional is True


def test_course_distance_division_by_zero_prevention():
    """Verify strictly positive working constant requirement."""
    with pytest.raises(ValueError, match="Working constant must be strictly positive"):
        calculate_course_distance(1000, 2000, "0")

    with pytest.raises(ValueError, match="Working constant must be strictly positive"):
        calculate_course_distance(1000, 2000, "-4500.5")


def test_course_distance_api_endpoint():
    """Test POST /api/v1/calculations/course-distance returns 200 and formatted distance."""
    payload = {
        "start_count": 124002,
        "finish_count": 320456,
        "working_constant": "4967.4625",
        "rollover": {"mode": "none"},
    }
    response = client.post("/api/v1/calculations/course-distance", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["course_count"] == 196454
    assert data["distance_km_formatted"] == "39.548"
    assert data["is_provisional"] is True
    assert "PROVISIONAL" in data["policy_notice"]


def test_constant_comparison_endpoint():
    """Test POST /api/v1/calculations/compare handles 'larger' rule and unapproved policy."""
    payload = {
        "pre_working_constant": "4967.4625",
        "post_working_constant": "5005.0000",
        "rule": "larger",
        "policy_approved": False,
    }
    response = client.post("/api/v1/calculations/compare", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["pre_working_constant"] == "4967.4625"
    assert data["post_working_constant"] == "5005.0000"
    assert data["difference"] == "37.5375"
    assert data["selected_rule"] == "larger"
    assert data["final_working_constant"] == "5005.0000"
    assert data["is_provisional"] is True
    assert "ruleNotApproved" in data["reasons"]
    assert "PROVISIONAL" in data["policy_notice"]


def test_constant_comparison_incomplete_post_calibration():
    """Regression DEF-01: Verify comparison handles incomplete post-calibration."""
    # Pure engine verification
    res = compare_calibrations(pre_wc="4967.4625", post_wc=None)
    assert res.post_wc is None
    assert res.difference is None
    assert res.percent_change is None
    assert res.final_working_constant == Decimal("4967.4625")
    assert "postIncomplete" in res.reasons
    assert res.is_provisional is True

    # API endpoint verification with omitted post_working_constant
    payload = {
        "pre_working_constant": "4967.4625",
        "rule": "larger",
        "policy_approved": True,  # Even if policy_approved is true, post is incomplete
    }
    response = client.post("/api/v1/calculations/compare", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["pre_working_constant"] == "4967.4625"
    assert data["post_working_constant"] is None
    assert data["difference"] is None
    assert data["percent_change"] is None
    assert data["final_working_constant"] == "4967.4625"
    assert "postIncomplete" in data["reasons"]
    assert data["is_provisional"] is True
    assert "PROVISIONAL" in data["policy_notice"]


def test_course_distance_rejects_binary_float_and_non_finite_wc():
    """Regression DEF-02 & DEF-03: Verify pure engine rejects float and non-finite WC."""
    with pytest.raises(TypeError, match="Binary float or boolean inputs are prohibited"):
        calculate_course_distance(1000, 2000, 4967.4625)  # type: ignore

    with pytest.raises(ValueError, match="Working constant must be a finite number"):
        calculate_course_distance(1000, 2000, Decimal("Infinity"))

    with pytest.raises(ValueError, match="Working constant must be a finite number"):
        calculate_course_distance(1000, 2000, Decimal("NaN"))

    # API rejection with 422
    for bad_wc in ["Infinity", "-Infinity", "NaN"]:
        payload = {
            "start_count": 1000,
            "finish_count": 2000,
            "working_constant": bad_wc,
        }
        response = client.post("/api/v1/calculations/course-distance", json=payload)
        assert response.status_code == 422
