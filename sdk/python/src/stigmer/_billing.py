"""Billing client for the Stigmer SDK."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

import grpc

from ai.stigmer.billing.v1 import billing_account_pb2
from ai.stigmer.billing.v1 import command_pb2_grpc
from ai.stigmer.billing.v1 import credit_pb2
from ai.stigmer.billing.v1 import io_pb2 as billing_io_pb2
from ai.stigmer.billing.v1 import model_pricing_baseline_pb2
from ai.stigmer.billing.v1 import pricing_override_pb2
from ai.stigmer.billing.v1 import query_pb2_grpc
from ai.stigmer.commons.rpc import pagination_pb2

from ._gen._errors import wrap_error
from ._gen._types import Page


@dataclass
class AdjustCreditsParams:
    """Parameters for a manual credit adjustment."""

    org_id: str
    amount_micros: int
    """Positive to add credits, negative to remove."""
    reason: str
    """Human-readable reason recorded on the ledger entry (audit trail)."""
    idempotency_key: str
    """Client-supplied deduplication key to prevent double-processing."""


@dataclass
class GetCreditLedgerParams:
    """Parameters for querying the credit ledger."""

    org_id: str
    page: Page | None = None
    type_filter: list[int] = field(default_factory=list)
    """Filter to specific ``LedgerEntryType`` values. Empty means all types."""
    start_time: datetime | None = None
    """Filter to entries on or after this timestamp."""
    end_time: datetime | None = None
    """Filter to entries on or before this timestamp."""
    view: int = 0
    """Server-resolved ledger slice (``LedgerView``). ``ledger_view_statement``
    returns only customer-facing money-movement entries and excludes internal
    mechanics (per-call usage debits, reservation holds/releases). When both
    ``view`` and ``type_filter`` are set, the effective filter is their
    intersection."""


@dataclass
class GetBillingUsageReportParams:
    """Parameters for querying the billing usage report."""

    org_id: str
    start_time: datetime
    end_time: datetime


@dataclass
class CreateCheckoutSessionParams:
    """Parameters for creating a Stripe Checkout Session."""

    org_id: str
    pack_id: str
    success_url: str
    cancel_url: str


@dataclass
class CreateBillingPortalSessionParams:
    """Parameters for creating a Stripe Billing Portal session."""

    org_id: str
    return_url: str


@dataclass
class SetAutoRechargeConfigParams:
    """Parameters for configuring auto-recharge."""

    org_id: str
    enabled: bool
    threshold_micros: int
    recharge_amount_micros: int
    monthly_cap_micros: int


@dataclass
class DecideModelPricingOverrideParams:
    """Parameters for deciding a pending pricing override."""

    override_id: str
    """The PENDING_SIGNOFF override to decide."""
    approve: bool
    """``True`` approves (the override becomes ACTIVE and supersedes any
    current ACTIVE override on the same pricing key); ``False`` rejects."""
    decision_note: str = ""
    """Optional note recorded on the decision for the audit trail."""


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

    Wraps the user-facing billing RPCs: account provisioning, balance
    queries, ledger history, credit purchases via Stripe Checkout, and the
    operator model-pricing surfaces.  Responses are returned as proto
    messages — the proto types are the contract.

    Internal execution-billing RPCs (``authorizeExecution``,
    ``recordLlmCallUsage``, ``finalizeExecution``) are not exposed — they
    are called only by the Temporal workflow and the LLM proxy.
    """

    def __init__(self, channel: grpc.Channel) -> None:
        self._command = command_pb2_grpc.BillingCommandControllerStub(channel)
        self._query = query_pb2_grpc.BillingQueryControllerStub(channel)

    # ── Account & balance ────────────────────────────────────────────────

    def get_or_create_billing_account(
        self, org_id: str
    ) -> billing_account_pb2.BillingAccount:
        """Provision or retrieve the billing account for an organization.

        Idempotent: creates the account on first call, returns the existing
        account on subsequent calls.
        """
        req = billing_io_pb2.GetOrCreateBillingAccountInput(org_id=org_id)
        try:
            return self._command.getOrCreateBillingAccount(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def get_billing_account(self, org_id: str) -> billing_account_pb2.BillingAccount:
        """Retrieve the billing account for an organization."""
        req = billing_io_pb2.GetBillingAccountInput(org_id=org_id)
        try:
            return self._query.getBillingAccount(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def get_credit_balance(self, org_id: str) -> billing_account_pb2.CreditBalance:
        """Retrieve the credit balance breakdown for an organization."""
        req = billing_io_pb2.GetCreditBalanceInput(org_id=org_id)
        try:
            return self._query.getCreditBalance(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def adjust_credits(
        self, params: AdjustCreditsParams
    ) -> credit_pb2.CreditLedgerEntry:
        """Manually adjust an organization's credit balance.

        Positive ``amount_micros`` adds credits (e.g. funding a tenant org),
        negative removes them.  The adjustment is recorded as a ledger entry
        with the supplied reason; the idempotency key deduplicates retries.
        Requires ``can_manage_billing`` on the org.
        """
        req = billing_io_pb2.AdjustCreditsInput(
            org_id=params.org_id,
            amount_micros=params.amount_micros,
            reason=params.reason,
            idempotency_key=params.idempotency_key,
        )
        try:
            return self._command.adjustCredits(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def get_credit_ledger(
        self, params: GetCreditLedgerParams
    ) -> billing_io_pb2.CreditLedgerResponse:
        """Retrieve paginated credit ledger entries with optional filters."""
        req = billing_io_pb2.GetCreditLedgerInput(
            org_id=params.org_id,
            type_filter=params.type_filter,
            view=params.view,
        )
        if params.page is not None:
            req.page.CopyFrom(
                pagination_pb2.PageInfo(num=params.page.num, size=params.page.size)
            )
        if params.start_time is not None:
            req.start_time.FromDatetime(params.start_time)
        if params.end_time is not None:
            req.end_time.FromDatetime(params.end_time)
        try:
            return self._query.getCreditLedger(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def get_billing_usage_report(
        self, params: GetBillingUsageReportParams
    ) -> billing_io_pb2.BillingUsageReportResponse:
        """Retrieve an aggregated billing usage report for a date range.

        Returns total provider cost, total billable amount, execution and
        LLM call counts, and a per-model breakdown with cost tier attribution.
        """
        req = billing_io_pb2.GetBillingUsageReportInput(org_id=params.org_id)
        req.start_time.FromDatetime(params.start_time)
        req.end_time.FromDatetime(params.end_time)
        try:
            return self._query.getBillingUsageReport(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    # ── Stripe ───────────────────────────────────────────────────────────

    def create_credit_checkout_session(
        self, params: CreateCheckoutSessionParams
    ) -> billing_io_pb2.CreateCreditCheckoutSessionResponse:
        """Create a Stripe Checkout Session to purchase a credit pack.

        Returns the Stripe-hosted checkout URL.  The caller should redirect
        the user to ``checkout_url`` to complete payment; credits are
        provisioned asynchronously via webhook after payment succeeds.
        """
        req = billing_io_pb2.CreateCreditCheckoutSessionInput(
            org_id=params.org_id,
            pack_id=params.pack_id,
            success_url=params.success_url,
            cancel_url=params.cancel_url,
        )
        try:
            return self._command.createCreditCheckoutSession(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def create_billing_portal_session(
        self, params: CreateBillingPortalSessionParams
    ) -> billing_io_pb2.CreateBillingPortalSessionResponse:
        """Create a Stripe Billing Portal session for payment method management.

        Returns the Stripe-hosted portal URL.  The caller should redirect the
        user to ``portal_url``; changes are synced back via webhooks.
        """
        req = billing_io_pb2.CreateBillingPortalSessionInput(
            org_id=params.org_id,
            return_url=params.return_url,
        )
        try:
            return self._command.createBillingPortalSession(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def set_auto_recharge_config(
        self, params: SetAutoRechargeConfigParams
    ) -> billing_account_pb2.BillingAccount:
        """Configure automatic credit recharge for an organization.

        When enabled, the billing system charges the account's saved payment
        method whenever the available balance drops below the configured
        threshold.  Returns the updated ``BillingAccount``.
        """
        req = billing_io_pb2.SetAutoRechargeConfigInput(
            org_id=params.org_id,
            enabled=params.enabled,
            threshold_micros=params.threshold_micros,
            recharge_amount_micros=params.recharge_amount_micros,
            monthly_cap_micros=params.monthly_cap_micros,
        )
        try:
            return self._command.setAutoRechargeConfig(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    # ── Pricing ──────────────────────────────────────────────────────────

    def get_customer_model_pricing(
        self, org_id: str = ""
    ) -> billing_io_pb2.CustomerModelPricingResponse:
        """Retrieve the customer-facing model price list with markup applied.

        These are the prices the customer pays, organized by harness and
        cost tier.  Pass ``org_id`` to resolve org-specific policy overrides;
        omit for default pricing.
        """
        req = billing_io_pb2.GetCustomerModelPricingInput(org_id=org_id)
        try:
            return self._query.getCustomerModelPricing(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def get_model_pricing_governance(
        self,
    ) -> billing_io_pb2.ModelPricingGovernanceResponse:
        """Retrieve the platform pricing governance view.

        Baseline vs effective rates per model, ACTIVE override provenance,
        and pending sign-off proposals from the pricing feedback loop.

        Platform-operator surface (``can_manage_model_pricing`` on
        ``platform:stigmer``): rates are raw provider prices, pre-markup.
        """
        req = billing_io_pb2.GetModelPricingGovernanceInput()
        try:
            return self._query.getModelPricingGovernance(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def list_model_pricing_baselines(
        self, include_history: bool = False
    ) -> billing_io_pb2.ModelPricingBaselinesResponse:
        """Retrieve the model registry baseline catalog.

        ACTIVE entries by default, or the full append-only revision history
        with ``include_history=True``.

        Platform-operator surface (``can_manage_model_pricing`` on
        ``platform:stigmer``): rates are raw provider prices, pre-markup.
        """
        req = billing_io_pb2.ListModelPricingBaselinesInput(
            include_history=include_history
        )
        try:
            return self._query.listModelPricingBaselines(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def decide_model_pricing_override(
        self, params: DecideModelPricingOverrideParams
    ) -> pricing_override_pb2.ModelPricingOverride:
        """Record a human decision on a PENDING_SIGNOFF pricing override.

        Approving makes the override ACTIVE (superseding any current ACTIVE
        override on the same pricing key) and recomposes the effective
        registry; rejecting archives it for audit.  Returns the decided
        override with the decision stamped.
        """
        req = billing_io_pb2.DecideModelPricingOverrideInput(
            override_id=params.override_id,
            approve=params.approve,
            decision_note=params.decision_note,
        )
        try:
            return self._command.decideModelPricingOverride(req)
        except grpc.RpcError as e:
            raise wrap_error(e) from e

    def upsert_model_pricing_baseline(
        self, params: UpsertModelPricingBaselineParams
    ) -> model_pricing_baseline_pb2.ModelPricingBaseline:
        """Create or revise one model registry baseline entry.

        Append-only: an existing ACTIVE entry for the same
        (model_id, provider, harness) key is superseded, never mutated, and
        the effective registry recomposes immediately.  Returns the new
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

        The model disappears from every price surface on the next composition
        pass; the document is kept for audit and the key can be revived by a
        subsequent upsert.
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
