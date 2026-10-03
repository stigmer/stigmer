"""Inputs keep a proto3 ``optional`` scalar's presence.

An ``optional`` scalar has explicit presence: unset and zero differ on the
wire. An absent entitlement limit is no limit and zero is refused; an absent
clone depth is a shallow clone and 0 is the full history. The generated
inputs used to default these fields to 0 and always send them, so a limit the
caller never set arrived as zero and was refused, and every clone asked for
the full history. Each such field now defaults to None and is sent only when
set, zero included.
"""

from __future__ import annotations

from stigmer._gen._agentexecution import GitRepoSourceInput
from stigmer._gen._plan import EntitlementLimitsInput, PlanTermsInput


class TestOptionalScalarPresence:
    def test_a_limit_the_caller_never_set_stays_absent(self) -> None:
        limits = EntitlementLimitsInput(max_orgs=5)._to_proto()
        assert limits.HasField("max_orgs")
        assert limits.max_orgs == 5
        assert not limits.HasField("max_users")
        assert not limits.HasField("included_managed_organizations")

    def test_no_limits_set_sends_an_empty_message(self) -> None:
        assert EntitlementLimitsInput()._to_proto().ListFields() == []

    def test_a_price_the_caller_never_set_stays_absent(self) -> None:
        terms = PlanTermsInput(annual_price_micros=1_200_000_000)._to_proto()
        assert terms.HasField("annual_price_micros")
        assert not terms.HasField("monthly_minimum_micros")
        assert not terms.HasField("usage_share_basis_points")
        assert not terms.HasField("per_extra_org_micros")

    def test_an_unset_depth_stays_absent_for_the_shallow_default(self) -> None:
        source = GitRepoSourceInput(url="https://example.com/repo.git")._to_proto()
        assert not source.HasField("depth")

    def test_a_depth_of_zero_is_sent_for_the_full_history(self) -> None:
        source = GitRepoSourceInput(url="https://example.com/repo.git", depth=0)._to_proto()
        assert source.HasField("depth")
        assert source.depth == 0
