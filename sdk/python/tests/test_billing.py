"""Wire-shape tests for BillingClient.

Each test injects a fake stub that captures the outgoing request proto and
returns a canned response, then asserts the SDK params mapped onto the right
proto fields.  This mirrors sdk/java's BillingClientTest and sdk/go's
billing_test.go — the reference pattern for testing the handwritten
(non-resource) clients.
"""

from __future__ import annotations

from datetime import datetime, timezone

import grpc
import pytest

from ai.stigmer.billing.v1 import billing_account_pb2
from ai.stigmer.billing.v1 import credit_pb2
from ai.stigmer.billing.v1 import enum_pb2
from ai.stigmer.billing.v1 import io_pb2 as billing_io_pb2

from stigmer import StigmerClient
from stigmer._billing import (
    AdjustCreditsParams,
    GetBillingUsageReportParams,
    GetCreditLedgerParams,
    GrantCreditsParams,
    SetAutoRechargeConfigParams,
)
from stigmer._gen._errors import StigmerError
from stigmer._gen._types import Page


class _FakeRpcError(grpc.RpcError):
    """Minimal grpc.RpcError double carrying a status code and details."""

    def __init__(self, code: grpc.StatusCode, details: str) -> None:
        self._code = code
        self._details = details

    def code(self) -> grpc.StatusCode:
        return self._code

    def details(self) -> str:
        return self._details


class _CapturingCommandStub:
    def __init__(self) -> None:
        self.adjust_credits_in = None
        self.adjust_credits_error: grpc.RpcError | None = None
        self.grant_credits_in = None
        self.grant_credits_error: grpc.RpcError | None = None
        self.auto_recharge_in = None

    def adjustCredits(self, req):  # noqa: N802 — proto RPC name
        self.adjust_credits_in = req
        if self.adjust_credits_error is not None:
            raise self.adjust_credits_error
        return credit_pb2.CreditLedgerEntry(amount_micros=req.amount_micros)

    def grantCredits(self, req):  # noqa: N802 — proto RPC name
        self.grant_credits_in = req
        if self.grant_credits_error is not None:
            raise self.grant_credits_error
        return credit_pb2.CreditLedgerEntry(amount_micros=req.amount_micros)

    def setAutoRechargeConfig(self, req):  # noqa: N802 — proto RPC name
        self.auto_recharge_in = req
        return billing_account_pb2.BillingAccount()


class _CapturingQueryStub:
    def __init__(self) -> None:
        self.ledger_in = None
        self.usage_in = None
        self.pricing_in = None

    def getCreditLedger(self, req):  # noqa: N802 — proto RPC name
        self.ledger_in = req
        return billing_io_pb2.CreditLedgerResponse()

    def getBillingUsageReport(self, req):  # noqa: N802 — proto RPC name
        self.usage_in = req
        return billing_io_pb2.BillingUsageReportResponse()

    def getCustomerModelPricing(self, req):  # noqa: N802 — proto RPC name
        self.pricing_in = req
        return billing_io_pb2.CustomerModelPricingResponse()


@pytest.fixture()
def client():
    with StigmerClient("test-key", base_url="localhost:7234", insecure=True) as c:
        yield c


class TestBillingClientWiring:
    def test_client_exposes_billing(self, client: StigmerClient) -> None:
        assert client.billing is not None

    def test_adjust_credits_maps_params(self, client: StigmerClient) -> None:
        fake = _CapturingCommandStub()
        client.billing._command = fake

        entry = client.billing.adjust_credits(
            AdjustCreditsParams(
                org_id="acme",
                amount_micros=25_000_000,
                reason="initial tenant funding",
                idempotency_key="fund-acme-001",
            )
        )
        assert entry.amount_micros == 25_000_000

        req = fake.adjust_credits_in
        assert req.org_id == "acme"
        assert req.amount_micros == 25_000_000
        assert req.reason == "initial tenant funding"
        assert req.idempotency_key == "fund-acme-001"

    def test_adjust_credits_wraps_grpc_error(self, client: StigmerClient) -> None:
        fake = _CapturingCommandStub()
        fake.adjust_credits_error = _FakeRpcError(
            grpc.StatusCode.PERMISSION_DENIED, "can_manage_billing required"
        )
        client.billing._command = fake

        with pytest.raises(StigmerError):
            client.billing.adjust_credits(
                AdjustCreditsParams(
                    org_id="acme",
                    amount_micros=1,
                    reason="r",
                    idempotency_key="k",
                )
            )

    def test_grant_credits_maps_params_including_expiry(
        self, client: StigmerClient
    ) -> None:
        fake = _CapturingCommandStub()
        client.billing._command = fake

        expires_at = datetime(2026, 8, 31, 23, 59, 59, tzinfo=timezone.utc)
        entry = client.billing.grant_credits(
            GrantCreditsParams(
                org_id="acme",
                amount_micros=5_000_000,
                reason="monthly free allowance 2026-08",
                idempotency_key="allowance-acme-2026-08",
                expires_at=expires_at,
            )
        )
        assert entry.amount_micros == 5_000_000

        req = fake.grant_credits_in
        assert req.org_id == "acme"
        assert req.amount_micros == 5_000_000
        assert req.reason == "monthly free allowance 2026-08"
        assert req.idempotency_key == "allowance-acme-2026-08"
        assert req.expires_at.ToDatetime(tzinfo=timezone.utc) == expires_at

    def test_grant_credits_omits_unset_expiry(self, client: StigmerClient) -> None:
        fake = _CapturingCommandStub()
        client.billing._command = fake

        client.billing.grant_credits(
            GrantCreditsParams(
                org_id="acme",
                amount_micros=1_000_000,
                reason="welcome credit",
                idempotency_key="welcome-acme",
            )
        )

        assert not fake.grant_credits_in.HasField("expires_at")

    def test_grant_credits_wraps_grpc_error(self, client: StigmerClient) -> None:
        fake = _CapturingCommandStub()
        fake.grant_credits_error = _FakeRpcError(
            grpc.StatusCode.PERMISSION_DENIED, "can_manage_billing required"
        )
        client.billing._command = fake

        with pytest.raises(StigmerError):
            client.billing.grant_credits(
                GrantCreditsParams(
                    org_id="acme",
                    amount_micros=1,
                    reason="r",
                    idempotency_key="k",
                )
            )

    def test_get_credit_ledger_maps_all_filters(self, client: StigmerClient) -> None:
        fake = _CapturingQueryStub()
        client.billing._query = fake

        start = datetime(2026, 8, 1, tzinfo=timezone.utc)
        end = datetime(2026, 8, 13, tzinfo=timezone.utc)
        client.billing.get_credit_ledger(
            GetCreditLedgerParams(
                org_id="acme",
                page=Page(num=2, size=50),
                type_filter=[enum_pb2.adjustment_credit],
                start_time=start,
                end_time=end,
                view=enum_pb2.ledger_view_statement,
            )
        )

        req = fake.ledger_in
        assert req.org_id == "acme"
        assert (req.page.num, req.page.size) == (2, 50)
        assert list(req.type_filter) == [enum_pb2.adjustment_credit]
        assert req.start_time.ToDatetime(tzinfo=timezone.utc) == start
        assert req.end_time.ToDatetime(tzinfo=timezone.utc) == end
        assert req.view == enum_pb2.ledger_view_statement

    def test_get_credit_ledger_omits_unset_optionals(self, client: StigmerClient) -> None:
        fake = _CapturingQueryStub()
        client.billing._query = fake

        client.billing.get_credit_ledger(GetCreditLedgerParams(org_id="acme"))

        req = fake.ledger_in
        assert not req.HasField("page")
        assert not req.HasField("start_time")
        assert not req.HasField("end_time")
        assert req.view == enum_pb2.ledger_view_unspecified

    def test_get_billing_usage_report_maps_timestamps(self, client: StigmerClient) -> None:
        fake = _CapturingQueryStub()
        client.billing._query = fake

        start = datetime(2026, 7, 1, tzinfo=timezone.utc)
        end = datetime(2026, 7, 31, 23, 59, 59, tzinfo=timezone.utc)
        client.billing.get_billing_usage_report(
            GetBillingUsageReportParams(org_id="acme", start_time=start, end_time=end)
        )

        req = fake.usage_in
        assert req.org_id == "acme"
        assert req.start_time.ToDatetime(tzinfo=timezone.utc) == start
        assert req.end_time.ToDatetime(tzinfo=timezone.utc) == end

    def test_set_auto_recharge_config_maps_params(self, client: StigmerClient) -> None:
        fake = _CapturingCommandStub()
        client.billing._command = fake

        client.billing.set_auto_recharge_config(
            SetAutoRechargeConfigParams(
                org_id="acme",
                enabled=True,
                threshold_micros=5_000_000,
                recharge_amount_micros=20_000_000,
                monthly_cap_micros=100_000_000,
            )
        )

        req = fake.auto_recharge_in
        assert req.enabled is True
        assert req.threshold_micros == 5_000_000
        assert req.recharge_amount_micros == 20_000_000
        assert req.monthly_cap_micros == 100_000_000

    def test_get_customer_model_pricing_defaults_to_empty_org(
        self, client: StigmerClient
    ) -> None:
        fake = _CapturingQueryStub()
        client.billing._query = fake

        client.billing.get_customer_model_pricing()
        assert fake.pricing_in.org_id == ""

        client.billing.get_customer_model_pricing(org_id="acme")
        assert fake.pricing_in.org_id == "acme"
