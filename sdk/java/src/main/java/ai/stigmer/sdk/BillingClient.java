package ai.stigmer.sdk;

import ai.stigmer.billing.v1.AdjustCreditsInput;
import ai.stigmer.billing.v1.BillingAccount;
import ai.stigmer.billing.v1.BillingCommandControllerGrpc;
import ai.stigmer.billing.v1.BillingQueryControllerGrpc;
import ai.stigmer.billing.v1.BillingUsageReportResponse;
import ai.stigmer.billing.v1.CreateBillingPortalSessionInput;
import ai.stigmer.billing.v1.CreateBillingPortalSessionResponse;
import ai.stigmer.billing.v1.CreateCreditCheckoutSessionInput;
import ai.stigmer.billing.v1.CreateCreditCheckoutSessionResponse;
import ai.stigmer.billing.v1.CreditBalance;
import ai.stigmer.billing.v1.CreditLedgerEntry;
import ai.stigmer.billing.v1.CreditLedgerResponse;
import ai.stigmer.billing.v1.CustomerModelPricingResponse;
import ai.stigmer.billing.v1.DecideModelPricingOverrideInput;
import ai.stigmer.billing.v1.GetBillingAccountInput;
import ai.stigmer.billing.v1.GetBillingUsageReportInput;
import ai.stigmer.billing.v1.GetCreditBalanceInput;
import ai.stigmer.billing.v1.GetCreditLedgerInput;
import ai.stigmer.billing.v1.GetCustomerModelPricingInput;
import ai.stigmer.billing.v1.GetModelPricingGovernanceInput;
import ai.stigmer.billing.v1.GetOrCreateBillingAccountInput;
import ai.stigmer.billing.v1.LedgerEntryType;
import ai.stigmer.billing.v1.LedgerView;
import ai.stigmer.billing.v1.ListModelPricingBaselinesInput;
import ai.stigmer.billing.v1.ModelPricingBaseline;
import ai.stigmer.billing.v1.ModelPricingBaselinesResponse;
import ai.stigmer.billing.v1.ModelPricingGovernanceResponse;
import ai.stigmer.billing.v1.ModelPricingOverride;
import ai.stigmer.billing.v1.RetireModelPricingBaselineInput;
import ai.stigmer.billing.v1.SetAutoRechargeConfigInput;
import ai.stigmer.billing.v1.UpsertModelPricingBaselineInput;
import ai.stigmer.commons.rpc.PageInfo;
import ai.stigmer.sdk.gen.Page;
import ai.stigmer.sdk.gen.StigmerException;
import com.google.protobuf.Timestamp;
import io.grpc.Channel;
import io.grpc.StatusRuntimeException;

import java.time.Instant;
import java.util.List;
import java.util.Objects;

/**
 * Client for the billing bounded context.
 *
 * <p>Wraps the user-facing billing RPCs: account provisioning, balance
 * queries, ledger history, manual credit adjustments, credit purchases via
 * Stripe Checkout, and the platform-operator pricing surfaces. Internal
 * execution-billing RPCs (authorize, report, finalize) are not exposed —
 * they are called only by the Temporal workflow and agent runner.
 *
 * <p>Billing is not an API Resource: RPCs authorize against the owning
 * organization ({@code can_view_billing} for queries,
 * {@code can_manage_billing} for commands), and the pricing-governance
 * methods require platform-operator privileges.
 *
 * <pre>{@code
 * CreditBalance balance = client.billing().getCreditBalance(orgId);
 *
 * CreditLedgerEntry entry = client.billing().adjustCredits(
 *     BillingClient.AdjustCreditsParams.builder()
 *         .orgId(orgId)
 *         .amountMicros(25_000_000L) // +$25.00
 *         .reason("initial tenant funding")
 *         .idempotencyKey("fund-" + orgId)
 *         .build());
 * }</pre>
 */
public final class BillingClient {

    private final BillingCommandControllerGrpc.BillingCommandControllerBlockingStub command;
    private final BillingQueryControllerGrpc.BillingQueryControllerBlockingStub query;

    BillingClient(Channel channel) {
        this.command = BillingCommandControllerGrpc.newBlockingStub(channel);
        this.query = BillingQueryControllerGrpc.newBlockingStub(channel);
    }

    // -- Account & balance ------------------------------------------------------

    /**
     * Provisions or retrieves the billing account for an organization.
     *
     * <p>Idempotent: creates the account on first call, returns the existing
     * account on subsequent calls.
     */
    public BillingAccount getOrCreateBillingAccount(String orgId) {
        Objects.requireNonNull(orgId, "orgId is required");
        try {
            return command.getOrCreateBillingAccount(GetOrCreateBillingAccountInput.newBuilder()
                    .setOrgId(orgId)
                    .build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** Retrieves the billing account for an organization. */
    public BillingAccount getBillingAccount(String orgId) {
        Objects.requireNonNull(orgId, "orgId is required");
        try {
            return query.getBillingAccount(GetBillingAccountInput.newBuilder()
                    .setOrgId(orgId)
                    .build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** Retrieves the credit balance breakdown for an organization. */
    public CreditBalance getCreditBalance(String orgId) {
        Objects.requireNonNull(orgId, "orgId is required");
        try {
            return query.getCreditBalance(GetCreditBalanceInput.newBuilder()
                    .setOrgId(orgId)
                    .build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Manually adjusts an organization's credit balance.
     *
     * <p>Produces an immutable ledger entry for audit. Requires the
     * {@code can_manage_billing} permission on the organization.
     */
    public CreditLedgerEntry adjustCredits(AdjustCreditsParams params) {
        try {
            return command.adjustCredits(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** Retrieves paginated credit ledger entries with optional filters. */
    public CreditLedgerResponse getCreditLedger(GetCreditLedgerParams params) {
        try {
            return query.getCreditLedger(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Retrieves an aggregated billing usage report for a date range.
     *
     * <p>Returns total provider cost, total billable amount, execution and
     * LLM call counts, and a per-model breakdown with cost tier attribution.
     */
    public BillingUsageReportResponse getBillingUsageReport(GetBillingUsageReportParams params) {
        try {
            return query.getBillingUsageReport(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    // -- Stripe integration -------------------------------------------------------

    /**
     * Creates a Stripe Checkout Session to purchase a credit pack.
     *
     * <p>Returns the Stripe-hosted checkout URL; redirect the user there to
     * complete payment. Credits are provisioned asynchronously via webhook
     * after payment succeeds.
     */
    public CreateCreditCheckoutSessionResponse createCreditCheckoutSession(
            CreateCreditCheckoutSessionParams params) {
        try {
            return command.createCreditCheckoutSession(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Creates a Stripe Customer Portal session for payment method management.
     *
     * <p>Returns the Stripe-hosted portal URL; redirect the user there to
     * add, update, or remove saved payment methods. Requires an existing
     * Stripe Customer (created during the first credit purchase).
     */
    public CreateBillingPortalSessionResponse createBillingPortalSession(
            CreateBillingPortalSessionParams params) {
        try {
            return command.createBillingPortalSession(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Configures automatic credit recharge for an organization.
     *
     * <p>When enabled, the billing system charges the account's saved payment
     * method whenever the available balance drops below the configured
     * threshold. Returns the updated {@link BillingAccount}.
     */
    public BillingAccount setAutoRechargeConfig(SetAutoRechargeConfigParams params) {
        try {
            return command.setAutoRechargeConfig(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    // -- Model pricing ------------------------------------------------------------

    /** Retrieves the customer-facing model price list with default pricing. */
    public CustomerModelPricingResponse getCustomerModelPricing() {
        return getCustomerModelPricing("");
    }

    /**
     * Retrieves the customer-facing model price list with markup applied.
     *
     * <p>Returns per-million-token prices for all billable models, organized
     * by harness and cost tier. Pass an org ID to resolve org-specific policy
     * overrides; pass an empty string for default pricing.
     */
    public CustomerModelPricingResponse getCustomerModelPricing(String orgId) {
        Objects.requireNonNull(orgId, "orgId must not be null (use \"\" for default pricing)");
        try {
            return query.getCustomerModelPricing(GetCustomerModelPricingInput.newBuilder()
                    .setOrgId(orgId)
                    .build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Retrieves the platform pricing governance view: baseline vs effective
     * rates per model, active override provenance, and pending sign-off
     * proposals from the pricing feedback loop.
     *
     * <p>Platform-operator surface: rates are raw provider prices, pre-markup.
     */
    public ModelPricingGovernanceResponse getModelPricingGovernance() {
        try {
            return query.getModelPricingGovernance(
                    GetModelPricingGovernanceInput.getDefaultInstance());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** Retrieves the model registry baseline catalog (ACTIVE entries only). */
    public ModelPricingBaselinesResponse listModelPricingBaselines() {
        return listModelPricingBaselines(false);
    }

    /**
     * Retrieves the model registry baseline catalog.
     *
     * <p>Platform-operator surface. When {@code includeHistory} is true,
     * includes SUPERSEDED and RETIRED revisions (the full append-only audit
     * history) in addition to ACTIVE entries.
     */
    public ModelPricingBaselinesResponse listModelPricingBaselines(boolean includeHistory) {
        try {
            return query.listModelPricingBaselines(ListModelPricingBaselinesInput.newBuilder()
                    .setIncludeHistory(includeHistory)
                    .build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Records a human decision on a PENDING_SIGNOFF pricing override.
     *
     * <p>Approving makes the override ACTIVE (superseding any current ACTIVE
     * override on the same pricing key) and recomposes the effective
     * registry; rejecting archives it for audit.
     */
    public ModelPricingOverride decideModelPricingOverride(DecideModelPricingOverrideParams params) {
        try {
            return command.decideModelPricingOverride(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Creates or revises one model registry baseline entry (catalog + list
     * prices).
     *
     * <p>Append-only: an existing ACTIVE entry for the same
     * (modelId, provider, harness) key is superseded, never mutated, and the
     * effective registry recomposes immediately.
     */
    public ModelPricingBaseline upsertModelPricingBaseline(UpsertModelPricingBaselineParams params) {
        try {
            return command.upsertModelPricingBaseline(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Retires one model from the registry catalog.
     *
     * <p>The model disappears from every price surface on the next
     * composition pass; the document is kept for audit and the key can be
     * revived by a subsequent upsert.
     */
    public ModelPricingBaseline retireModelPricingBaseline(RetireModelPricingBaselineParams params) {
        try {
            return command.retireModelPricingBaseline(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    private static Timestamp protoTimestamp(Instant instant) {
        return Timestamp.newBuilder()
                .setSeconds(instant.getEpochSecond())
                .setNanos(instant.getNano())
                .build();
    }

    // -- AdjustCreditsParams ------------------------------------------------------

    /** Parameters for manually adjusting an organization's credit balance. */
    public static final class AdjustCreditsParams {
        final String orgId;
        final long amountMicros;
        final String reason;
        final String idempotencyKey;

        private AdjustCreditsParams(Builder builder) {
            this.orgId = builder.orgId;
            this.amountMicros = builder.amountMicros;
            this.reason = builder.reason;
            this.idempotencyKey = builder.idempotencyKey;
        }

        public static Builder builder() { return new Builder(); }

        AdjustCreditsInput toProto() {
            return AdjustCreditsInput.newBuilder()
                    .setOrgId(orgId)
                    .setAmountMicros(amountMicros)
                    .setReason(reason)
                    .setIdempotencyKey(idempotencyKey)
                    .build();
        }

        public static final class Builder {
            private String orgId;
            private long amountMicros;
            private String reason;
            private String idempotencyKey;

            private Builder() {}

            /** Organization ID whose balance to adjust (required). */
            public Builder orgId(String orgId) {
                this.orgId = Objects.requireNonNull(orgId);
                return this;
            }

            /** Micro-USD to adjust by: positive adds credits, negative removes. */
            public Builder amountMicros(long amountMicros) {
                this.amountMicros = amountMicros;
                return this;
            }

            /** Human-readable reason for the adjustment, recorded in the audit trail (required). */
            public Builder reason(String reason) {
                this.reason = Objects.requireNonNull(reason);
                return this;
            }

            /** Client-supplied deduplication key to prevent double-processing (required). */
            public Builder idempotencyKey(String idempotencyKey) {
                this.idempotencyKey = Objects.requireNonNull(idempotencyKey);
                return this;
            }

            public AdjustCreditsParams build() {
                Objects.requireNonNull(orgId, "orgId is required");
                Objects.requireNonNull(reason, "reason is required");
                Objects.requireNonNull(idempotencyKey, "idempotencyKey is required");
                return new AdjustCreditsParams(this);
            }
        }
    }

    // -- GetCreditLedgerParams ----------------------------------------------------

    /** Parameters for querying the credit ledger. */
    public static final class GetCreditLedgerParams {
        final String orgId;
        final Page page;
        final List<LedgerEntryType> typeFilter;
        final LedgerView view;
        final Instant startTime;
        final Instant endTime;

        private GetCreditLedgerParams(Builder builder) {
            this.orgId = builder.orgId;
            this.page = builder.page;
            this.typeFilter = builder.typeFilter;
            this.view = builder.view;
            this.startTime = builder.startTime;
            this.endTime = builder.endTime;
        }

        public static Builder builder() { return new Builder(); }

        GetCreditLedgerInput toProto() {
            GetCreditLedgerInput.Builder req = GetCreditLedgerInput.newBuilder()
                    .setOrgId(orgId)
                    .addAllTypeFilter(typeFilter);
            if (page != null) {
                req.setPage(PageInfo.newBuilder()
                        .setNum(page.getNum())
                        .setSize(page.getSize())
                        .build());
            }
            if (view != null) {
                req.setView(view);
            }
            if (startTime != null) {
                req.setStartTime(protoTimestamp(startTime));
            }
            if (endTime != null) {
                req.setEndTime(protoTimestamp(endTime));
            }
            return req.build();
        }

        public static final class Builder {
            private String orgId;
            private Page page;
            private List<LedgerEntryType> typeFilter = List.of();
            private LedgerView view;
            private Instant startTime;
            private Instant endTime;

            private Builder() {}

            /** Organization ID whose ledger to query (required). */
            public Builder orgId(String orgId) {
                this.orgId = Objects.requireNonNull(orgId);
                return this;
            }

            /** Pagination parameters. */
            public Builder page(Page page) {
                this.page = page;
                return this;
            }

            /** Filter to specific entry types. Empty means all types. */
            public Builder typeFilter(List<LedgerEntryType> typeFilter) {
                this.typeFilter = Objects.requireNonNull(typeFilter);
                return this;
            }

            /**
             * Server-resolved ledger slice. {@link LedgerView#ledger_view_statement}
             * returns only customer-facing money-movement entries and excludes
             * internal mechanics (per-call usage debits, reservation
             * holds/releases). Defaults to the full ledger.
             */
            public Builder view(LedgerView view) {
                this.view = view;
                return this;
            }

            /** Filter to entries on or after this instant. */
            public Builder startTime(Instant startTime) {
                this.startTime = startTime;
                return this;
            }

            /** Filter to entries on or before this instant. */
            public Builder endTime(Instant endTime) {
                this.endTime = endTime;
                return this;
            }

            public GetCreditLedgerParams build() {
                Objects.requireNonNull(orgId, "orgId is required");
                return new GetCreditLedgerParams(this);
            }
        }
    }

    // -- GetBillingUsageReportParams ------------------------------------------------

    /** Parameters for querying the aggregated billing usage report. */
    public static final class GetBillingUsageReportParams {
        final String orgId;
        final Instant startTime;
        final Instant endTime;

        private GetBillingUsageReportParams(Builder builder) {
            this.orgId = builder.orgId;
            this.startTime = builder.startTime;
            this.endTime = builder.endTime;
        }

        public static Builder builder() { return new Builder(); }

        GetBillingUsageReportInput toProto() {
            return GetBillingUsageReportInput.newBuilder()
                    .setOrgId(orgId)
                    .setStartTime(protoTimestamp(startTime))
                    .setEndTime(protoTimestamp(endTime))
                    .build();
        }

        public static final class Builder {
            private String orgId;
            private Instant startTime;
            private Instant endTime;

            private Builder() {}

            /** Organization ID to report on (required). */
            public Builder orgId(String orgId) {
                this.orgId = Objects.requireNonNull(orgId);
                return this;
            }

            /** Start of the reporting period (required). */
            public Builder startTime(Instant startTime) {
                this.startTime = Objects.requireNonNull(startTime);
                return this;
            }

            /** End of the reporting period (required). */
            public Builder endTime(Instant endTime) {
                this.endTime = Objects.requireNonNull(endTime);
                return this;
            }

            public GetBillingUsageReportParams build() {
                Objects.requireNonNull(orgId, "orgId is required");
                Objects.requireNonNull(startTime, "startTime is required");
                Objects.requireNonNull(endTime, "endTime is required");
                return new GetBillingUsageReportParams(this);
            }
        }
    }

    // -- CreateCreditCheckoutSessionParams --------------------------------------------

    /** Parameters for creating a Stripe Checkout Session. */
    public static final class CreateCreditCheckoutSessionParams {
        final String orgId;
        final String packId;
        final String successUrl;
        final String cancelUrl;

        private CreateCreditCheckoutSessionParams(Builder builder) {
            this.orgId = builder.orgId;
            this.packId = builder.packId;
            this.successUrl = builder.successUrl;
            this.cancelUrl = builder.cancelUrl;
        }

        public static Builder builder() { return new Builder(); }

        CreateCreditCheckoutSessionInput toProto() {
            return CreateCreditCheckoutSessionInput.newBuilder()
                    .setOrgId(orgId)
                    .setPackId(packId)
                    .setSuccessUrl(successUrl)
                    .setCancelUrl(cancelUrl)
                    .build();
        }

        public static final class Builder {
            private String orgId;
            private String packId;
            private String successUrl;
            private String cancelUrl;

            private Builder() {}

            /** Organization purchasing the credits (required). */
            public Builder orgId(String orgId) {
                this.orgId = Objects.requireNonNull(orgId);
                return this;
            }

            /** Credit pack to purchase, e.g. "starter", "growth", "team" (required). */
            public Builder packId(String packId) {
                this.packId = Objects.requireNonNull(packId);
                return this;
            }

            /** URL to redirect to after successful payment (required). */
            public Builder successUrl(String successUrl) {
                this.successUrl = Objects.requireNonNull(successUrl);
                return this;
            }

            /** URL to redirect to if the user cancels checkout (required). */
            public Builder cancelUrl(String cancelUrl) {
                this.cancelUrl = Objects.requireNonNull(cancelUrl);
                return this;
            }

            public CreateCreditCheckoutSessionParams build() {
                Objects.requireNonNull(orgId, "orgId is required");
                Objects.requireNonNull(packId, "packId is required");
                Objects.requireNonNull(successUrl, "successUrl is required");
                Objects.requireNonNull(cancelUrl, "cancelUrl is required");
                return new CreateCreditCheckoutSessionParams(this);
            }
        }
    }

    // -- CreateBillingPortalSessionParams ---------------------------------------------

    /** Parameters for creating a Stripe Billing Portal session. */
    public static final class CreateBillingPortalSessionParams {
        final String orgId;
        final String returnUrl;

        private CreateBillingPortalSessionParams(Builder builder) {
            this.orgId = builder.orgId;
            this.returnUrl = builder.returnUrl;
        }

        public static Builder builder() { return new Builder(); }

        CreateBillingPortalSessionInput toProto() {
            return CreateBillingPortalSessionInput.newBuilder()
                    .setOrgId(orgId)
                    .setReturnUrl(returnUrl)
                    .build();
        }

        public static final class Builder {
            private String orgId;
            private String returnUrl;

            private Builder() {}

            /** Organization whose billing to manage (required). */
            public Builder orgId(String orgId) {
                this.orgId = Objects.requireNonNull(orgId);
                return this;
            }

            /** URL to redirect to after the user exits the Stripe portal (required). */
            public Builder returnUrl(String returnUrl) {
                this.returnUrl = Objects.requireNonNull(returnUrl);
                return this;
            }

            public CreateBillingPortalSessionParams build() {
                Objects.requireNonNull(orgId, "orgId is required");
                Objects.requireNonNull(returnUrl, "returnUrl is required");
                return new CreateBillingPortalSessionParams(this);
            }
        }
    }

    // -- SetAutoRechargeConfigParams --------------------------------------------------

    /** Parameters for configuring automatic credit recharge. */
    public static final class SetAutoRechargeConfigParams {
        final String orgId;
        final boolean enabled;
        final long thresholdMicros;
        final long rechargeAmountMicros;
        final long monthlyCapMicros;

        private SetAutoRechargeConfigParams(Builder builder) {
            this.orgId = builder.orgId;
            this.enabled = builder.enabled;
            this.thresholdMicros = builder.thresholdMicros;
            this.rechargeAmountMicros = builder.rechargeAmountMicros;
            this.monthlyCapMicros = builder.monthlyCapMicros;
        }

        public static Builder builder() { return new Builder(); }

        SetAutoRechargeConfigInput toProto() {
            return SetAutoRechargeConfigInput.newBuilder()
                    .setOrgId(orgId)
                    .setEnabled(enabled)
                    .setThresholdMicros(thresholdMicros)
                    .setRechargeAmountMicros(rechargeAmountMicros)
                    .setMonthlyCapMicros(monthlyCapMicros)
                    .build();
        }

        public static final class Builder {
            private String orgId;
            private boolean enabled;
            private long thresholdMicros;
            private long rechargeAmountMicros;
            private long monthlyCapMicros;

            private Builder() {}

            /** Organization to configure (required). */
            public Builder orgId(String orgId) {
                this.orgId = Objects.requireNonNull(orgId);
                return this;
            }

            /** Whether to enable auto-recharge. Disabling preserves the other settings. */
            public Builder enabled(boolean enabled) {
                this.enabled = enabled;
                return this;
            }

            /** Trigger recharge when available balance drops below this micro-USD amount. */
            public Builder thresholdMicros(long thresholdMicros) {
                this.thresholdMicros = thresholdMicros;
                return this;
            }

            /** Fixed micro-USD amount to charge per recharge event. */
            public Builder rechargeAmountMicros(long rechargeAmountMicros) {
                this.rechargeAmountMicros = rechargeAmountMicros;
                return this;
            }

            /** Maximum total auto-recharge spend per calendar month, in micro-USD. */
            public Builder monthlyCapMicros(long monthlyCapMicros) {
                this.monthlyCapMicros = monthlyCapMicros;
                return this;
            }

            public SetAutoRechargeConfigParams build() {
                Objects.requireNonNull(orgId, "orgId is required");
                return new SetAutoRechargeConfigParams(this);
            }
        }
    }

    // -- DecideModelPricingOverrideParams ---------------------------------------------

    /** Parameters for deciding a pending pricing override. */
    public static final class DecideModelPricingOverrideParams {
        final String overrideId;
        final boolean approve;
        final String decisionNote;

        private DecideModelPricingOverrideParams(Builder builder) {
            this.overrideId = builder.overrideId;
            this.approve = builder.approve;
            this.decisionNote = builder.decisionNote;
        }

        public static Builder builder() { return new Builder(); }

        DecideModelPricingOverrideInput toProto() {
            return DecideModelPricingOverrideInput.newBuilder()
                    .setOverrideId(overrideId)
                    .setApprove(approve)
                    .setDecisionNote(decisionNote)
                    .build();
        }

        public static final class Builder {
            private String overrideId;
            private boolean approve;
            private String decisionNote = "";

            private Builder() {}

            /** The PENDING_SIGNOFF override to decide (required). */
            public Builder overrideId(String overrideId) {
                this.overrideId = Objects.requireNonNull(overrideId);
                return this;
            }

            /**
             * {@code true} approves (the override becomes ACTIVE and supersedes
             * any current ACTIVE override on the same key); {@code false} rejects.
             */
            public Builder approve(boolean approve) {
                this.approve = approve;
                return this;
            }

            /** Optional note recorded on the decision for the audit trail. */
            public Builder decisionNote(String decisionNote) {
                this.decisionNote = Objects.requireNonNull(decisionNote);
                return this;
            }

            public DecideModelPricingOverrideParams build() {
                Objects.requireNonNull(overrideId, "overrideId is required");
                return new DecideModelPricingOverrideParams(this);
            }
        }
    }

    // -- UpsertModelPricingBaselineParams ---------------------------------------------

    /** Parameters for creating or revising a model registry baseline entry. */
    public static final class UpsertModelPricingBaselineParams {
        final ModelPricingBaseline baseline;
        final String revisionNote;

        private UpsertModelPricingBaselineParams(Builder builder) {
            this.baseline = builder.baseline;
            this.revisionNote = builder.revisionNote;
        }

        public static Builder builder() { return new Builder(); }

        UpsertModelPricingBaselineInput toProto() {
            return UpsertModelPricingBaselineInput.newBuilder()
                    .setBaseline(baseline)
                    .setRevisionNote(revisionNote)
                    .build();
        }

        public static final class Builder {
            private ModelPricingBaseline baseline;
            private String revisionNote = "";

            private Builder() {}

            /**
             * The baseline entry to create or revise, keyed by
             * (modelId, provider, harness). Lifecycle fields (baselineId,
             * status, decision stamps, pricing effectiveAt) are server-owned
             * and ignored (required).
             */
            public Builder baseline(ModelPricingBaseline baseline) {
                this.baseline = Objects.requireNonNull(baseline);
                return this;
            }

            /** Optional operator note recorded on the revision for the audit trail. */
            public Builder revisionNote(String revisionNote) {
                this.revisionNote = Objects.requireNonNull(revisionNote);
                return this;
            }

            public UpsertModelPricingBaselineParams build() {
                Objects.requireNonNull(baseline, "baseline is required");
                return new UpsertModelPricingBaselineParams(this);
            }
        }
    }

    // -- RetireModelPricingBaselineParams ---------------------------------------------

    /** Parameters for retiring a model from the registry catalog. */
    public static final class RetireModelPricingBaselineParams {
        final String modelId;
        final String provider;
        final String harness;
        final String revisionNote;

        private RetireModelPricingBaselineParams(Builder builder) {
            this.modelId = builder.modelId;
            this.provider = builder.provider;
            this.harness = builder.harness;
            this.revisionNote = builder.revisionNote;
        }

        public static Builder builder() { return new Builder(); }

        RetireModelPricingBaselineInput toProto() {
            return RetireModelPricingBaselineInput.newBuilder()
                    .setModelId(modelId)
                    .setProvider(provider)
                    .setHarness(harness)
                    .setRevisionNote(revisionNote)
                    .build();
        }

        public static final class Builder {
            private String modelId;
            private String provider;
            private String harness;
            private String revisionNote = "";

            private Builder() {}

            /** Model identifier to retire (required). */
            public Builder modelId(String modelId) {
                this.modelId = Objects.requireNonNull(modelId);
                return this;
            }

            /** LLM provider of the entry, e.g. "anthropic" (required). */
            public Builder provider(String provider) {
                this.provider = Objects.requireNonNull(provider);
                return this;
            }

            /** Execution harness of the entry, "native" or "cursor" (required). */
            public Builder harness(String harness) {
                this.harness = Objects.requireNonNull(harness);
                return this;
            }

            /** Optional operator note recorded on the retirement. */
            public Builder revisionNote(String revisionNote) {
                this.revisionNote = Objects.requireNonNull(revisionNote);
                return this;
            }

            public RetireModelPricingBaselineParams build() {
                Objects.requireNonNull(modelId, "modelId is required");
                Objects.requireNonNull(provider, "provider is required");
                Objects.requireNonNull(harness, "harness is required");
                return new RetireModelPricingBaselineParams(this);
            }
        }
    }
}
