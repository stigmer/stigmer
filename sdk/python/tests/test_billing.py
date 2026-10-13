"""Wire-shape tests for BillingClient.

Each test injects a fake stub that captures the outgoing request proto and
returns a canned response, then asserts the SDK params mapped onto the right
proto fields.  This mirrors sdk/java's BillingClientTest and sdk/go's
billing_test.go — the reference pattern for testing the handwritten
(non-resource) clients.
"""

from __future__ import annotations

import grpc
import pytest

from ai.stigmer.billing.v1 import billing_account_pb2
from ai.stigmer.billing.v1 import io_pb2 as billing_io_pb2

from stigmer import StigmerClient
from stigmer._billing import CreatePaymentMethodSetupSessionParams
from stigmer._gen._errors import StigmerError


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
        self.account_in = None
        self.account_error: grpc.RpcError | None = None
        self.setup_in = None

    def getOrCreateBillingAccount(self, req):  # noqa: N802 — proto RPC name
        self.account_in = req
        if self.account_error is not None:
            raise self.account_error
        return billing_account_pb2.BillingAccount()

    def createPaymentMethodSetupSession(self, req):  # noqa: N802 — proto RPC name
        self.setup_in = req
        return billing_io_pb2.CreatePaymentMethodSetupSessionResponse()


@pytest.fixture()
def client():
    with StigmerClient("test-key", base_url="localhost:7234", insecure=True) as c:
        yield c


class TestBillingClientWiring:
    def test_client_exposes_billing(self, client: StigmerClient) -> None:
        assert client.billing is not None

    def test_get_or_create_billing_account_maps_org(
        self, client: StigmerClient
    ) -> None:
        fake = _CapturingCommandStub()
        client.billing._command = fake

        client.billing.get_or_create_billing_account("acme")

        assert fake.account_in.org == "acme"

    def test_get_or_create_billing_account_wraps_grpc_error(
        self, client: StigmerClient
    ) -> None:
        fake = _CapturingCommandStub()
        fake.account_error = _FakeRpcError(
            grpc.StatusCode.PERMISSION_DENIED, "can_manage_billing required"
        )
        client.billing._command = fake

        with pytest.raises(StigmerError):
            client.billing.get_or_create_billing_account("acme")

    def test_create_payment_method_setup_session_maps_params(
        self, client: StigmerClient
    ) -> None:
        fake = _CapturingCommandStub()
        client.billing._command = fake

        client.billing.create_payment_method_setup_session(
            CreatePaymentMethodSetupSessionParams(
                org="acme",
                success_url="https://app.example.com/billing?setup=success",
                cancel_url="https://app.example.com/billing",
            )
        )

        req = fake.setup_in
        assert req.org == "acme"
        assert req.success_url == "https://app.example.com/billing?setup=success"
        assert req.cancel_url == "https://app.example.com/billing"
