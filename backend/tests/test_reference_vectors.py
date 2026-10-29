"""Phase 8 Golden Reference Test Vectors Ported to Python Authoritative Engine.

Each test represents an independent reference calculation derived from first principles.
All 33 vectors are executed against the pure calculation engine and verified with
justified numerical tolerances.
"""

from decimal import Decimal
import math
import pytest

from app.services.calculation_engine import (
    calculate_calibration,
    calculate_course_distance,
    calculate_ride_difference,
    compare_calibrations,
    format_decimal,
    RideInput,
    RolloverConfig,
    RolloverMode,
    FinalConstantRule,
    WC_DISPLAY_DECIMALS,
    DISTANCE_DISPLAY_DECIMALS,
)


class TestPhase8GoldenReferenceVectors:
    """Port of the 33 Phase 8 Independent Reference Calculation Vectors."""

    # =========================================================================
    # Group 1: Known 200m Course Reference Vectors (REF-VEC-01 to REF-VEC-13)
    # =========================================================================

    def test_ref_vec_01_ride_1_difference(self):
        """REF-VEC-01: Ride 1 start 11082, finish 12021 -> count = 939."""
        res = calculate_ride_difference(11082, 12021)
        assert res.ok is True
        assert res.count == 939

    def test_ref_vec_02_ride_2_difference(self):
        """REF-VEC-02: Ride 2 start 12021, finish 13042 -> count = 1021."""
        res = calculate_ride_difference(12021, 13042)
        assert res.ok is True
        assert res.count == 1021

    def test_ref_vec_03_ride_3_difference(self):
        """REF-VEC-03: Ride 3 start 13042, finish 14052 -> count = 1010."""
        res = calculate_ride_difference(13042, 14052)
        assert res.ok is True
        assert res.count == 1010

    def test_ref_vec_04_ride_4_difference(self):
        """REF-VEC-04: Ride 4 start 14052, finish 15052 -> count = 1000."""
        res = calculate_ride_difference(14052, 15052)
        assert res.ok is True
        assert res.count == 1000

    @pytest.fixture
    def reference_rides(self):
        return [
            RideInput(start=11082, finish=12021),
            RideInput(start=12021, finish=13042),
            RideInput(start=13042, finish=14052),
            RideInput(start=14052, finish=15052),
        ]

    def test_ref_vec_05_total_count(self, reference_rides):
        """REF-VEC-05: Total count D = sum(939 + 1021 + 1010 + 1000) = 3970."""
        expected_total = 939 + 1021 + 1010 + 1000  # Independent first principles derivation
        res = calculate_calibration(reference_rides, course_length_m="200")
        assert res.total_count == expected_total

    def test_ref_vec_06_average_count(self, reference_rides):
        """REF-VEC-06: Average count C_avg = 3970 / 4 = 992.5."""
        expected_avg = Decimal("3970") / Decimal("4")
        res = calculate_calibration(reference_rides, course_length_m="200")
        assert res.average_count == expected_avg
        assert res.average_count == Decimal("992.5")

    def test_ref_vec_07_course_km(self, reference_rides):
        """REF-VEC-07: Course length in km = 200 / 1000 = 0.2 km."""
        expected_km = Decimal("200") / Decimal("1000")
        res = calculate_calibration(reference_rides, course_length_m="200")
        assert res.course_length_km == expected_km
        assert res.course_length_km == Decimal("0.2")

    def test_ref_vec_08_counts_per_km(self, reference_rides):
        """REF-VEC-08: CPK = 992.5 / 0.2 = 4962.5 counts/km."""
        expected_cpk = Decimal("992.5") / Decimal("0.2")
        res = calculate_calibration(reference_rides, course_length_m="200")
        assert res.counts_per_km == expected_cpk
        assert res.counts_per_km == Decimal("4962.5")

    def test_ref_vec_09_working_constant(self, reference_rides):
        """REF-VEC-09: WC = 4962.5 * 1.001 = 4967.4625."""
        expected_wc = Decimal("4962.5") * Decimal("1.001")
        res = calculate_calibration(reference_rides, course_length_m="200")
        assert res.working_constant == expected_wc
        assert res.working_constant == Decimal("4967.4625")

    def test_ref_vec_10_working_constant_formatting(self, reference_rides):
        """REF-VEC-10: WC formatted to 4 decimals = '4967.4625'."""
        res = calculate_calibration(reference_rides, course_length_m="200")
        assert res.working_constant_formatted == "4967.4625"
        formatted_direct = format_decimal(Decimal("4967.4625"), WC_DISPLAY_DECIMALS)
        assert formatted_direct == "4967.4625"

    def test_ref_vec_11_course_distance_count(self):
        """REF-VEC-11: Course count T = 320456 - 124002 = 196454."""
        res = calculate_ride_difference(124002, 320456)
        assert res.ok is True
        assert res.count == 196454

    def test_ref_vec_12_course_distance_arithmetic(self):
        """REF-VEC-12: Distance = 196454 / 4967.4625 ~ 39.54815964887823 km."""
        res = calculate_course_distance(124002, 320456, Decimal("4967.4625"))
        expected_float = 196454 / 4967.4625
        # Compare Python Decimal conversion to float within 1e-12 tolerance
        assert math.isclose(float(res.distance_km), expected_float, rel_tol=1e-12)

    def test_ref_vec_13_course_distance_formatting(self):
        """REF-VEC-13: Distance formatted to 3 decimals = '39.548'."""
        res = calculate_course_distance(124002, 320456, Decimal("4967.4625"))
        assert res.distance_km_formatted == "39.548"

    # =========================================================================
    # Group 2: Rollover and Boundary Vectors (REF-VEC-14 to REF-VEC-18)
    # =========================================================================

    def test_ref_vec_14_zero_count(self):
        """REF-VEC-14: Identical start and finish reading as zero count."""
        res = calculate_ride_difference(5000, 5000)
        assert res.ok is True
        assert res.count == 0

    def test_ref_vec_15_non_wrapping_counter_rejection(self):
        """REF-VEC-15: Reject finish < start when counter is non-wrapping."""
        res = calculate_ride_difference(5000, 4999, RolloverConfig(mode=RolloverMode.NONE))
        assert res.ok is False
        assert "non-wrapping" in (res.error or "")

    def test_ref_vec_16_not_configured_rollover_rejection(self):
        """REF-VEC-16: Reject finish < start when rollover is not configured."""
        res = calculate_ride_difference(5000, 4999, RolloverConfig(mode=RolloverMode.NOT_CONFIGURED))
        assert res.ok is False
        assert "Rollover handling is not configured" in (res.error or "")

    def test_ref_vec_17_wrapped_count_calculation(self):
        """REF-VEC-17: 999980 to 20 on 999999 counter: 20 + 1000000 - 999980 = 40."""
        cfg = RolloverConfig(mode=RolloverMode.WRAP, max_reading=999999)
        res = calculate_ride_difference(999980, 20, cfg)
        assert res.ok is True
        assert res.count == 40
        assert res.adjustment == 1000000

    def test_ref_vec_18_wrap_reading_exceeds_max(self):
        """REF-VEC-18: Reject wrap when reading exceeds configured max."""
        cfg = RolloverConfig(mode=RolloverMode.WRAP, max_reading=999999)
        res = calculate_ride_difference(1000005, 50, cfg)
        assert res.ok is False
        assert "exceeds the configured counter maximum" in (res.error or "")

    # =========================================================================
    # Group 3: Course Length Validation Vectors (REF-VEC-19 to REF-VEC-25)
    # =========================================================================

    def test_ref_vec_19_zero_course_length_rejection(self):
        """REF-VEC-19: Reject zero course length."""
        rides = [RideInput(start=1000, finish=2000)]
        with pytest.raises(ValueError, match="Course length must be greater than zero"):
            calculate_calibration(rides, course_length_m="0")

    def test_ref_vec_20_negative_course_length_rejection(self):
        """REF-VEC-20: Reject negative course lengths."""
        rides = [RideInput(start=1000, finish=2000)]
        with pytest.raises(ValueError, match="Course length must be greater than zero"):
            calculate_calibration(rides, course_length_m="-500.5")

    def test_ref_vec_21_empty_course_length_rejection(self):
        """REF-VEC-21: Reject empty / whitespace course length."""
        rides = [RideInput(start=1000, finish=2000)]
        with pytest.raises(ValueError, match="Invalid course length"):
            calculate_calibration(rides, course_length_m="   ")

    def test_ref_vec_22_malformed_text_course_length(self):
        """REF-VEC-22: Reject non-numeric text course length."""
        rides = [RideInput(start=1000, finish=2000)]
        with pytest.raises(ValueError, match="Invalid course length"):
            calculate_calibration(rides, course_length_m="200m")

    def test_ref_vec_23_decimal_course_length_acceptance(self):
        """REF-VEC-23: Accept decimal course lengths."""
        rides = [RideInput(start=1000, finish=2000)]
        res = calculate_calibration(rides, course_length_m="333.333")
        assert res.course_length_m == Decimal("333.333")

    def test_ref_vec_24_extremely_small_course_length(self):
        """REF-VEC-24: 0.001 m course length with 1000 counts -> CPK = 1,000,000,000."""
        rides = [RideInput(start=0, finish=1000)]
        res = calculate_calibration(rides, course_length_m="0.001")
        assert res.counts_per_km == Decimal("1000000000")

    def test_ref_vec_25_extremely_large_course_length(self):
        """REF-VEC-25: 50,000 m course length with 1000 counts -> CPK = 20."""
        rides = [RideInput(start=0, finish=1000)]
        res = calculate_calibration(rides, course_length_m="50000")
        assert res.counts_per_km == Decimal("20")

    # =========================================================================
    # Group 4: Reading Input Validation Vectors (REF-VEC-26 to REF-VEC-29)
    # =========================================================================

    def test_ref_vec_26_valid_integer_reading(self):
        """REF-VEC-26: Valid discrete integer count accepted."""
        res = calculate_ride_difference(0, 124002)
        assert res.ok is True
        assert res.count == 124002

    def test_ref_vec_27_negative_reading_rejection(self):
        """REF-VEC-27: Negative counter readings rejected."""
        res = calculate_ride_difference(-100, 2000)
        assert res.ok is False
        assert "non-negative" in (res.error or "")

    def test_ref_vec_28_negative_finish_reading_rejection(self):
        """REF-VEC-28: Negative finish reading rejected."""
        res = calculate_ride_difference(1000, -50)
        assert res.ok is False
        assert "non-negative" in (res.error or "")

    def test_ref_vec_28b_discrete_non_integer_reading_rejection(self):
        """REF-VEC-28b: Float and boolean counter readings rejected by calculation engine."""
        # Non-integer float readings prohibited
        res_float = calculate_ride_difference(124002.5, 320456)  # type: ignore
        assert res_float.ok is False
        assert "discrete whole integers" in (res_float.error or "")

        # Boolean values prohibited
        res_bool = calculate_ride_difference(True, 1000)  # type: ignore
        assert res_bool.ok is False
        assert "discrete whole integers" in (res_bool.error or "")

    def test_ref_vec_29_large_reading_safety(self):
        """REF-VEC-29: Large count 100,000,000 to 999,999,999 -> count = 899,999,999."""
        res = calculate_ride_difference(100000000, 999999999)
        assert res.ok is True
        assert res.count == 899999999

    # =========================================================================
    # Group 5: Policy-Dependent Constant Rules (REF-VEC-30 to REF-VEC-33)
    # =========================================================================

    def test_ref_vec_30_incomplete_post_calibration(self):
        """REF-VEC-30: Pre WC selected when post-calibration is incomplete (post_wc=None)."""
        res = compare_calibrations(
            pre_wc="4967.4625",
            post_wc=None,
            rule=FinalConstantRule.LARGER,
            policy_approved=False,
        )
        assert res.final_working_constant == Decimal("4967.4625")
        assert res.post_wc is None
        assert res.difference is None
        assert res.percent_change is None
        assert res.is_provisional is True
        assert "postIncomplete" in res.reasons

    def test_ref_vec_31_rule_not_configured(self):
        """REF-VEC-31: When rule is 'notConfigured', pre WC is used provisionally."""
        res = compare_calibrations(
            pre_wc="4967.4625",
            post_wc="5005.0000",
            rule=FinalConstantRule.NOT_CONFIGURED,
            policy_approved=False,
        )
        assert res.final_working_constant == Decimal("4967.4625")
        assert "ruleNotConfigured" in res.reasons

    def test_ref_vec_32_larger_rule_selection(self):
        """REF-VEC-32: 'larger' rule selects post WC (5005.0 > 4967.4625) with ruleNotApproved."""
        res = compare_calibrations(
            pre_wc="4967.4625",
            post_wc="5005.0000",
            rule=FinalConstantRule.LARGER,
            policy_approved=False,
        )
        assert res.final_working_constant == Decimal("5005.0000")
        assert res.is_provisional is True
        assert "ruleNotApproved" in res.reasons

    def test_ref_vec_33_average_rule_selection(self):
        """REF-VEC-33: 'average' rule computes exact arithmetic mean (4967.4625 + 5005.0) / 2."""
        expected_avg = (Decimal("4967.4625") + Decimal("5005.0000")) / Decimal("2")
        res = compare_calibrations(
            pre_wc="4967.4625",
            post_wc="5005.0000",
            rule=FinalConstantRule.AVERAGE,
            policy_approved=False,
        )
        assert res.final_working_constant == expected_avg
        assert res.final_working_constant == Decimal("4986.23125")
        assert res.is_provisional is True
        assert "ruleNotApproved" in res.reasons
