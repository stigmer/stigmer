"""Billing client for the Stigmer SDK."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

import grpc

from ai.stigmer.billing.v1 import billing_account_pb2
from ai.stigmer.billing.v1 import command_pb2_grpc
from ai.stigmer.billing.v1 import io_pb2 as billing_io_pb2
from ai.stigmer.billing.v1 import model_pricing_baseline_pb2
from ai.stigmer.billing.v1 import query_pb2_grpc

from ._gen._errors import wrap_error


@dataclass
class CreateBillingPortalSessionParams:
    """Parameters for creating a Stripe Billing Portal session."""

    org: str
    return_url: str


@dataclass
class CreatePaymentMethodSetupSessionParams:
    """Parameters for creating a Stripe Checkout Session that saves a card."""

    org: str
    success_url: str
    cancel_url: str


@dataclass
class UpsertModelPricingBaselineParams:
    """Parameters for creating or revising a model registry baseline entry."""

    baseline: model_pricing_baseline_pb2.ModelPricingBaseline
    """The baseline entry to create or revise, keyed by
    (model_id, provider, harness). Lifecycle fields (baseline_id, status,
    decision stamps, pricing effective_at) are server-owned and ignored."""
    revision_note: str = ""
    """Optional operator note recorded on the revision for the audit trail."""


@dataclass
class RetireModelPricingBaselineParams:
    """Parameters for retiring a model from the registry catalog."""

    model_id: str
    provider: str
    harness: str
    revision_note: str = ""
    """Optional operator note recorded on the retirement."""


class BillingClient:
    """Billing bounded-context client.

    Wraps the user-facing billing RPCs: the organization's billing account
    (its Stripe customer), the Stripe portal and card setup sessions, and
    the operator model-pricing surfaces.  Responses are returned as proto
    messages — the proto types are the contract.  Token usage is read from
    the run client's usage reports (``get_run_usage_report``,
    ``get_session_usage_report``, ``get_agent_usage_report``,
    ``get_org_usage_report``), counted in tokens and never priced.

    The proxy's metering write (``recordLlmCallUsage``) is not exposed;
    only the server calls it.
    """

    def __init__(self, channel: grpc.Channel) -> None:
        self._command = command_pb2_grpc.BillingCommandControllerStub(channel)
        self._query = query_pb2_grpc.BillingQueryControllerStub(channel)

    # ── Account ──────────────────────────────────────────────────────────

    def get_or_create_billing_account(
        self, org: str
    ) -> billing_account_pb2.BillingAccount:
        """Provision or retrieve the billing account for an organization.

        Idempotent: creates the account on first call, returns the existing
        account on subsequent calls.
        """
        req = billing_io_pb2.GetOrCreateBillingAccountInput(org=org)
        try:
            return self._command.getOrCreateBillingAccount(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def get_billing_account(self, org: str) -> billing_account_pb2.BillingAccount:
        """Retrieve the billing account for an organization."""
        req = billing_io_pb2.GetBillingAccountInput(org=org)
        try:
            return self._query.getBillingAccount(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    # ── Stripe ───────────────────────────────────────────────────────────

    def create_billing_portal_session(
        self, params: CreateBillingPortalSessionParams
    ) -> billing_io_pb2.CreateBillingPortalSessionResponse:
        """Create a Stripe Billing Portal session for payment method management.

        Returns the Stripe-hosted portal URL.  The caller should redirect the
        user to ``portal_url``; changes are synced back via webhooks.
        """
        req = billing_io_pb2.CreateBillingPortalSessionInput(
            org=params.org,
            return_url=params.return_url,
        )
        try:
            return self._command.createBillingPortalSession(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def create_payment_method_setup_session(
        self, params: CreatePaymentMethodSetupSessionParams
    ) -> billing_io_pb2.CreatePaymentMethodSetupSessionResponse:
        """Create a Stripe Checkout Session that saves a payment method.

        Returns the Stripe-hosted setup URL.  The caller should redirect the
        user to ``setup_url``.  This is how an organization puts a card on
        file for its plan's invoices; nothing is charged.
        """
        req = billing_io_pb2.CreatePaymentMethodSetupSessionInput(
            org=params.org,
            success_url=params.success_url,
            cancel_url=params.cancel_url,
        )
        try:
            return self._command.createPaymentMethodSetupSession(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    # ── Pricing ──────────────────────────────────────────────────────────

    def list_model_pricing_baselines(
        self,
        include_history: bool = False,
        page_size: int = 0,
        page_token: str = "",
    ) -> billing_io_pb2.ModelPricingBaselinesResponse:
        """Retrieve one page of the model registry baseline catalog.

        ACTIVE entries by default, or the full append-only revision history
        with ``include_history=True``. ``page_size`` 0 asks for the default
        page of 50, and above 100 reads 100; pass a response's
        ``next_page_token`` as ``page_token`` to continue.

        Platform-operator surface (``can_manage_model_pricing`` on
        ``platform:stigmer``): rates are the providers' list prices.
        """
        req = billing_io_pb2.ListModelPricingBaselinesInput(
            include_history=include_history,
            page_size=page_size,
            page_token=page_token,
        )
        try:
            return self._query.listModelPricingBaselines(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def list_model_pricing_baselines_all(
        self,
        include_history: bool = False,
        page_size: int = 0,
        page_token: str = "",
    ) -> Iterator[model_pricing_baseline_pb2.ModelPricingBaseline]:
        """Every baseline of the catalog, page after page: follows
        ``next_page_token`` from ``page_token`` until the catalog ends."""
        token = page_token
        while True:
            page = self.list_model_pricing_baselines(include_history, page_size, token)
            yield from page.entries
            if not page.next_page_token:
                return
            token = page.next_page_token

    def upsert_model_pricing_baseline(
        self, params: UpsertModelPricingBaselineParams
    ) -> model_pricing_baseline_pb2.ModelPricingBaseline:
        """Create or revise one model registry baseline entry.

        Append-only: an existing ACTIVE entry for the same
        (model_id, provider, harness) key is superseded, never mutated, and
        the registry is rebuilt immediately.  Returns the new
        revision with server-stamped lifecycle fields.
        """
        req = billing_io_pb2.UpsertModelPricingBaselineInput(
            baseline=params.baseline,
            revision_note=params.revision_note,
        )
        try:
            return self._command.upsertModelPricingBaseline(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def retire_model_pricing_baseline(
        self, params: RetireModelPricingBaselineParams
    ) -> model_pricing_baseline_pb2.ModelPricingBaseline:
        """Retire one model from the registry catalog.

        The rebuilt registry drops it from every price surface; the document
        is kept for audit and the key can be revived by a subsequent upsert.
        """
        req = billing_io_pb2.RetireModelPricingBaselineInput(
            model_id=params.model_id,
            provider=params.provider,
            harness=params.harness,
            revision_note=params.revision_note,
        )
        try:
            return self._command.retireModelPricingBaseline(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e
