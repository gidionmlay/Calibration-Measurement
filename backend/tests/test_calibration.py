"""Unit and API tests for calibration calculations."""

from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.calculation_engine import (
    calculate_calibration,
    calculate_ride_difference,
    resolve_rides,
    RideInput,
    RolloverConfig,
    RolloverMode,
)

client = TestClient(app)


def test_pure_calibration_calculation_known_course():
    """Verify pure calculation engine on known 200m course."""
    rides = [
        RideInput(start=11082, finish=12021),
        RideInput(start=0, finish=13042),  # auto-linked
        RideInput(start=0, finish=14052),  # auto-linked
        RideInput(start=0, finish=15052),  # auto-linked
    ]
    res = calculate_calibration(rides, course_length_m="200")

    assert res.counts == [939, 1021, 1010, 1000]
    assert res.total_count == 3970
    assert res.average_count == Decimal("992.5")
    assert res.course_length_m == Decimal("200")
    assert res.course_length_km == Decimal("0.2")
    assert res.counts_per_km == Decimal("4962.5")
    assert res.working_constant == Decimal("4967.4625")
    assert res.working_constant_formatted == "4967.4625"
    assert res.spread.high_ride == 2
    assert res.spread.high_count == 1021
    assert res.spread.low_ride == 1
    assert res.spread.low_count == 939
    assert res.spread.range_count == 82
    assert res.is_provisional is True


def test_sequential_linkage_and_override():
    """Verify sequential continuity and override handling."""
    rides = [
        RideInput(start=1000, finish=2000),
        RideInput(start=2050, finish=3000, start_overridden=True, override_reason="Adjusted tire position"),
        RideInput(start=0, finish=4000),
    ]
    resolved = resolve_rides(rides)
    assert resolved[0].linked is False
    assert resolved[0].count == 1000

    # Ride 2 was overridden
    assert resolved[1].linked is False
    assert resolved[1].overridden is True
    assert resolved[1].start == 2050
    assert resolved[1].count == 950
    assert resolved[1].override_reason == "Adjusted tire position"

    # Ride 3 linked to Ride 2 finish
    assert resolved[2].linked is True
    assert resolved[2].start == 3000
    assert resolved[2].count == 1000


def test_calibration_api_endpoint():
    """Test POST /api/v1/calculations/calibration returns 200 with structured JSON."""
    payload = {
        "rides": [
            {"start": 11082, "finish": 12021, "start_overridden": False, "override_reason": ""},
            {"start": 0, "finish": 13042, "start_overridden": False, "override_reason": ""},
            {"start": 0, "finish": 14052, "start_overridden": False, "override_reason": ""},
            {"start": 0, "finish": 15052, "start_overridden": False, "override_reason": ""},
        ],
        "course_length_m": "200",
        "rollover": {"mode": "none"},
    }
    response = client.post("/api/v1/calculations/calibration", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert data["counts"] == [939, 1021, 1010, 1000]
    assert data["total_count"] == 3970
    assert data["average_count"] == "992.5"
    assert data["working_constant"] == "4967.4625"
    assert data["working_constant_formatted"] == "4967.4625"
    assert data["is_provisional"] is True
    assert "PROVISIONAL" in data["policy_notice"]


def test_calibration_invalid_course_length():
    """Test invalid course length returns 422 Problem Details."""
    payload = {
        "rides": [{"start": 1000, "finish": 2000}],
        "course_length_m": "-10",
    }
    response = client.post("/api/v1/calculations/calibration", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert data["status"] == 422
    assert "invalid_params" in data


def test_calibration_rejects_binary_float_course_length():
    """Regression DEF-03: Verify pure engine rejects binary float inputs."""
    rides = [RideInput(start=1000, finish=2000)]
    with pytest.raises(TypeError, match="Binary float or boolean inputs are prohibited"):
        calculate_calibration(rides, 200.0)  # type: ignore


def test_calibration_rejects_non_finite_course_length():
    """Regression DEF-02: Verify pure engine rejects non-finite Decimals."""
    rides = [RideInput(start=1000, finish=2000)]
    with pytest.raises(ValueError, match="Course length must be a finite number"):
        calculate_calibration(rides, Decimal("Infinity"))

    with pytest.raises(ValueError, match="Course length must be a finite number"):
        calculate_calibration(rides, Decimal("NaN"))


def test_calibration_api_rejects_non_finite_course_length():
    """Regression DEF-02: Verify API rejects 'Infinity' and 'NaN' course lengths with 422."""
    for bad_val in ["Infinity", "-Infinity", "NaN"]:
        payload = {
            "rides": [{"start": 1000, "finish": 2000}],
            "course_length_m": bad_val,
        }
        response = client.post("/api/v1/calculations/calibration", json=payload)
        assert response.status_code == 422
        data = response.json()
        assert data["status"] == 422
