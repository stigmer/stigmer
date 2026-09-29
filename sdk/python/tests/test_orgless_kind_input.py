"""Inputs of the organization-less kinds (License, Plan).

Their contract says metadata.org is empty, so the generated inputs default
``org`` to "" and callers leave it out. A value a caller does pass is sent as
given: the server refuses it with its own message, so the SDK never silently
drops a caller's mistake.
"""

from __future__ import annotations

from stigmer._gen._license import LicenseInput
from stigmer._gen._plan import PlanInput


def _license(**overrides: object) -> LicenseInput:
    fields: dict[str, object] = {
        "name": "acme-enterprise",
        "customer": None,
        "entitlements": None,
        "term": 2,
        "expires_at": "",
        "grace_until": "",
    }
    fields.update(overrides)
    return LicenseInput(**fields)  # type: ignore[arg-type]


class TestOrglessKindInputs:
    def test_license_needs_no_org_and_leaves_it_empty(self) -> None:
        assert _license()._to_proto().metadata.org == ""

    def test_plan_needs_no_org_and_leaves_it_empty(self) -> None:
        plan = PlanInput(name="Team", instrument=1, entitlements=None)
        assert plan._to_proto().metadata.org == ""

    def test_a_passed_org_is_sent_for_the_server_to_refuse(self) -> None:
        assert _license(org="acme")._to_proto().metadata.org == "acme"
