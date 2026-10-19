"""Inputs keep a proto3 ``optional`` scalar's presence.

An ``optional`` scalar has explicit presence: unset and zero differ on the
wire. An absent entitlement limit is no limit and zero is refused; an absent
cron is a routine that fires only by hand, and an empty one is refused. The
generated inputs used to default these fields to their zero value and always
send them, so a limit the caller never set arrived as zero and was refused.
Each such field now defaults to None and is sent only when set, zero
included.
"""

from __future__ import annotations

from stigmer._gen._routine import RoutineInput
from stigmer._gen._plan import EntitlementLimitsInput, PlanTermsInput


class TestOptionalScalarPresence:
    def test_a_limit_the_caller_never_set_stays_absent(self) -> None:
        limits = EntitlementLimitsInput(max_orgs=5)._to_proto()
        assert limits.HasField("max_orgs")
        assert limits.max_orgs == 5
        assert not limits.HasField("max_users")
        assert not limits.HasField("included_child_orgs")

    def test_no_limits_set_sends_an_empty_message(self) -> None:
        assert EntitlementLimitsInput()._to_proto().ListFields() == []

    def test_a_price_the_caller_never_set_stays_absent(self) -> None:
        terms = PlanTermsInput(annual_price_micros=1_200_000_000)._to_proto()
        assert terms.HasField("annual_price_micros")
        assert not terms.HasField("monthly_minimum_micros")
        assert not terms.HasField("per_extra_org_micros")

    def test_a_routine_with_no_schedule_sends_no_cron(self) -> None:
        routine = RoutineInput(name="triage", org="acme", agent=None)._to_proto()
        assert not routine.spec.HasField("cron")

    def test_a_schedule_is_sent_as_given(self) -> None:
        routine = RoutineInput(name="triage", org="acme", agent=None, cron="0 9 * * 1")._to_proto()
        assert routine.spec.HasField("cron")
        assert routine.spec.cron == "0 9 * * 1"
