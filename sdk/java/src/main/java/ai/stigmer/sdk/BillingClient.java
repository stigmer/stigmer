package ai.stigmer.sdk;

import ai.stigmer.billing.v1.BillingAccount;
import ai.stigmer.billing.v1.BillingCommandControllerGrpc;
import ai.stigmer.billing.v1.BillingQueryControllerGrpc;
import ai.stigmer.billing.v1.CreateBillingPortalSessionInput;
import ai.stigmer.billing.v1.CreateBillingPortalSessionResponse;
import ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionInput;
import ai.stigmer.billing.v1.CreatePaymentMethodSetupSessionResponse;
import ai.stigmer.billing.v1.GetBillingAccountInput;
import ai.stigmer.billing.v1.GetOrCreateBillingAccountInput;
import ai.stigmer.billing.v1.ListModelPricingBaselinesInput;
import ai.stigmer.billing.v1.ModelPricingBaseline;
import ai.stigmer.billing.v1.ModelPricingBaselinesResponse;
import ai.stigmer.billing.v1.RetireModelPricingBaselineInput;
import ai.stigmer.billing.v1.UpsertModelPricingBaselineInput;
import ai.stigmer.sdk.gen.Pages;
import ai.stigmer.sdk.gen.StigmerException;
import io.grpc.Channel;
import io.grpc.StatusRuntimeException;

import java.util.Objects;

/**
 * Client for the billing bounded context.
 *
 * <p>Wraps the user-facing billing RPCs: the organization's billing account
 * (its Stripe customer), the Stripe portal and card setup sessions, and the
 * platform-operator pricing surfaces. Token usage is read from the run
 * client's usage reports ({@code getRunUsageReport},
 * {@code getSessionUsageReport}, {@code getAgentUsageReport},
 * {@code getOrgUsageReport}), counted in tokens and never priced. The proxy's
 * metering write ({@code recordLlmCallUsage}) is not exposed; only the server
 * calls it.
 *
 * <p>Billing is not an API Resource: RPCs authorize against the owning
 * organization ({@code can_view_billing} for queries,
 * {@code can_manage_billing} for the organization's own commands), and the
 * model-catalog methods ({@code can_manage_model_pricing}) require
 * platform-operator privileges.
 *
 * <pre>{@code
 * BillingAccount account = client.billing().getBillingAccount(org);
 * }</pre>
 */
public final class BillingClient {

    private final BillingCommandControllerGrpc.BillingCommandControllerBlockingStub command;
    private final BillingQueryControllerGrpc.BillingQueryControllerBlockingStub query;

    BillingClient(Channel channel) {
        this.command = BillingCommandControllerGrpc.newBlockingStub(channel);
        this.query = BillingQueryControllerGrpc.newBlockingStub(channel);
    }

    // -- Account ----------------------------------------------------------------

    /**
     * Provisions or retrieves the billing account for an organization.
     *
     * <p>Idempotent: creates the account on first call, returns the existing
     * account on subsequent calls.
     */
    public BillingAccount getOrCreateBillingAccount(String org) {
        Objects.requireNonNull(org, "org is required");
        try {
            return command.getOrCreateBillingAccount(GetOrCreateBillingAccountInput.newBuilder()
                    .setOrg(org)
                    .build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /** Retrieves the billing account for an organization. */
    public BillingAccount getBillingAccount(String org) {
        Objects.requireNonNull(org, "org is required");
        try {
            return query.getBillingAccount(GetBillingAccountInput.newBuilder()
                    .setOrg(org)
                    .build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    // -- Stripe integration -------------------------------------------------------

    /**
     * Creates a Stripe Customer Portal session for payment method management.
     *
     * <p>Returns the Stripe-hosted portal URL; redirect the user there to
     * add, update, or remove saved payment methods. Requires an existing
     * Stripe Customer (created when the organization first saves a card
     * through {@link #createPaymentMethodSetupSession}).
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
     * Creates a Stripe Checkout Session that saves a payment method without
     * charging it.
     *
     * <p>Returns the Stripe-hosted setup URL; redirect the user there. This is
     * how an organization puts a card on file for its plan's invoices.
     */
    public CreatePaymentMethodSetupSessionResponse createPaymentMethodSetupSession(
            CreatePaymentMethodSetupSessionParams params) {
        try {
            return command.createPaymentMethodSetupSession(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    // -- Model pricing ------------------------------------------------------------

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
        return listModelPricingBaselines(includeHistory, 0, "");
    }

    /**
     * Retrieves one page of the model registry baseline catalog. A
     * {@code pageSize} of 0 asks for the default page of 50, and above 100
     * reads 100; pass a response's next page token to continue.
     */
    public ModelPricingBaselinesResponse listModelPricingBaselines(boolean includeHistory, int pageSize, String pageToken) {
        try {
            return query.listModelPricingBaselines(ListModelPricingBaselinesInput.newBuilder()
                    .setIncludeHistory(includeHistory)
                    .setPageSize(pageSize)
                    .setPageToken(pageToken)
                    .build());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    /**
     * Every baseline of the catalog, page after page: follows the next page
     * token until the catalog ends. Each page is read as the iteration
     * reaches it.
     */
    public Iterable<ModelPricingBaseline> listModelPricingBaselinesAll(boolean includeHistory) {
        return Pages.<ModelPricingBaselinesResponse, ModelPricingBaseline>iterate(
                "",
                token -> listModelPricingBaselines(includeHistory, 0, token),
                ModelPricingBaselinesResponse::getEntriesList,
                ModelPricingBaselinesResponse::getNextPageToken);
    }

    /**
     * Creates or revises one model registry baseline entry (catalog + list
     * prices).
     *
     * <p>Append-only: an existing ACTIVE entry for the same
     * (modelId, provider, harness) key is superseded, never mutated, and the
     * registry is rebuilt immediately.
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
     * <p>The rebuilt registry drops it from every price surface; the document
     * is kept for audit and the key can be revived by a subsequent upsert.
     */
    public ModelPricingBaseline retireModelPricingBaseline(RetireModelPricingBaselineParams params) {
        try {
            return command.retireModelPricingBaseline(params.toProto());
        } catch (StatusRuntimeException e) {
            throw StigmerException.wrap(e);
        }
    }

    // -- CreateBillingPortalSessionParams ---------------------------------------------

    /** Parameters for creating a Stripe Billing Portal session. */
    public static final class CreateBillingPortalSessionParams {
        final String org;
        final String returnUrl;

        private CreateBillingPortalSessionParams(Builder builder) {
            this.org = builder.org;
            this.returnUrl = builder.returnUrl;
        }

        public static Builder builder() { return new Builder(); }

        CreateBillingPortalSessionInput toProto() {
            return CreateBillingPortalSessionInput.newBuilder()
                    .setOrg(org)
                    .setReturnUrl(returnUrl)
                    .build();
        }

        public static final class Builder {
            private String org;
            private String returnUrl;

            private Builder() {}

            /** Organization whose billing to manage (required). */
            public Builder org(String org) {
                this.org = Objects.requireNonNull(org);
                return this;
            }

            /** URL to redirect to after the user exits the Stripe portal (required). */
            public Builder returnUrl(String returnUrl) {
                this.returnUrl = Objects.requireNonNull(returnUrl);
                return this;
            }

            public CreateBillingPortalSessionParams build() {
                Objects.requireNonNull(org, "org is required");
                Objects.requireNonNull(returnUrl, "returnUrl is required");
                return new CreateBillingPortalSessionParams(this);
            }
        }
    }

    // -- CreatePaymentMethodSetupSessionParams ---------------------------------------

    /** Parameters for {@link #createPaymentMethodSetupSession}. */
    public static final class CreatePaymentMethodSetupSessionParams {
        final String org;
        final String successUrl;
        final String cancelUrl;

        private CreatePaymentMethodSetupSessionParams(Builder builder) {
            this.org = builder.org;
            this.successUrl = builder.successUrl;
            this.cancelUrl = builder.cancelUrl;
        }

        public static Builder builder() { return new Builder(); }

        CreatePaymentMethodSetupSessionInput toProto() {
            return CreatePaymentMethodSetupSessionInput.newBuilder()
                    .setOrg(org)
                    .setSuccessUrl(successUrl)
                    .setCancelUrl(cancelUrl)
                    .build();
        }

        public static final class Builder {
            private String org;
            private String successUrl;
            private String cancelUrl;

            private Builder() {}

            /** Organization to save the payment method for (required). */
            public Builder org(String org) {
                this.org = Objects.requireNonNull(org);
                return this;
            }

            /** URL to redirect to after the payment method is saved (required). */
            public Builder successUrl(String successUrl) {
                this.successUrl = Objects.requireNonNull(successUrl);
                return this;
            }

            /** URL to redirect to if the user leaves without saving one (required). */
            public Builder cancelUrl(String cancelUrl) {
                this.cancelUrl = Objects.requireNonNull(cancelUrl);
                return this;
            }

            public CreatePaymentMethodSetupSessionParams build() {
                Objects.requireNonNull(org, "org is required");
                Objects.requireNonNull(successUrl, "successUrl is required");
                Objects.requireNonNull(cancelUrl, "cancelUrl is required");
                return new CreatePaymentMethodSetupSessionParams(this);
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

            /** Execution harness of the entry, "stigmer" or "claude" (required). */
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
