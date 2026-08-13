import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import {
  GetOrCreateBillingAccountInputSchema,
  GetBillingAccountInputSchema,
  GetCreditBalanceInputSchema,
  AdjustCreditsInputSchema,
  GetCreditLedgerInputSchema,
  CreateCreditCheckoutSessionInputSchema,
  CreateBillingPortalSessionInputSchema,
  SetAutoRechargeConfigInputSchema,
  GetBillingUsageReportInputSchema,
  GetCustomerModelPricingInputSchema,
  GetModelPricingGovernanceInputSchema,
  DecideModelPricingOverrideInputSchema,
  UpsertModelPricingBaselineInputSchema,
  RetireModelPricingBaselineInputSchema,
  ListModelPricingBaselinesInputSchema,
  type CreateCreditCheckoutSessionResponse,
  type CreateBillingPortalSessionResponse,
  type CreditLedgerResponse,
  type BillingUsageReportResponse,
  type CustomerModelPricingResponse,
  type ModelPricingGovernanceResponse,
  type ModelPricingBaselinesResponse,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import type { CreditLedgerEntry } from "@stigmer/protos/ai/stigmer/billing/v1/credit_pb";
import type { ModelPricingOverride } from "@stigmer/protos/ai/stigmer/billing/v1/pricing_override_pb";
import type { ModelPricingBaseline } from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import type { BillingAccount, CreditBalance } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import type { LedgerEntryType, LedgerView } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { wrapError } from "./gen/errors.js";

/** Parameters for creating a Stripe Checkout Session. */
export interface CreateCheckoutSessionParams {
  readonly orgId: string;
  readonly packId: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

/** Parameters for creating a Stripe Billing Portal session. */
export interface CreateBillingPortalSessionParams {
  readonly orgId: string;
  readonly returnUrl: string;
}

/** Parameters for configuring auto-recharge. */
export interface SetAutoRechargeConfigParams {
  readonly orgId: string;
  readonly enabled: boolean;
  readonly thresholdMicros: bigint;
  readonly rechargeAmountMicros: bigint;
  readonly monthlyCapMicros: bigint;
}

/** Parameters for a manual credit adjustment. */
export interface AdjustCreditsParams {
  readonly orgId: string;
  /** Positive to add credits, negative to remove. */
  readonly amountMicros: bigint;
  /** Human-readable reason recorded on the ledger entry (audit trail). */
  readonly reason: string;
  /** Client-supplied deduplication key to prevent double-processing. */
  readonly idempotencyKey: string;
}

/** Parameters for querying the credit ledger. */
export interface GetCreditLedgerParams {
  readonly orgId: string;
  /** Pagination: `{ num, size }` where `num` is the 0-based page number. */
  readonly page?: { readonly num: number; readonly size: number };
  readonly typeFilter?: LedgerEntryType[];
  /** Filter to entries on or after this timestamp. */
  readonly startTime?: Date;
  /** Filter to entries on or before this timestamp. */
  readonly endTime?: Date;
  /**
   * Server-resolved ledger slice. When set to `LedgerView.statement`, the
   * server returns only customer-facing money-movement entry types and
   * excludes internal mechanics (per-call usage debits, reservation
   * holds/releases). Defaults to the full ledger.
   */
  readonly view?: LedgerView;
}

/** Parameters for querying the billing usage report. */
export interface GetBillingUsageReportParams {
  readonly orgId: string;
  readonly startTime: Date;
  readonly endTime: Date;
}

/** Parameters for querying customer model pricing. */
export interface GetCustomerModelPricingParams {
  readonly orgId?: string;
}

/** Parameters for creating or revising a model registry baseline entry. */
export interface UpsertModelPricingBaselineParams {
  /**
   * The baseline entry to create or revise, keyed by
   * (modelId, provider, harness). Lifecycle fields (baselineId, status,
   * decision stamps, pricing effectiveAt) are server-owned and ignored.
   */
  readonly baseline: ModelPricingBaseline;
  /** Optional operator note recorded on the revision for the audit trail. */
  readonly revisionNote?: string;
}

/** Parameters for retiring a model from the registry catalog. */
export interface RetireModelPricingBaselineParams {
  readonly modelId: string;
  readonly provider: string;
  readonly harness: string;
  /** Optional operator note recorded on the retirement. */
  readonly revisionNote?: string;
}

/** Parameters for listing the model registry baseline catalog. */
export interface ListModelPricingBaselinesParams {
  /**
   * When `true`, includes SUPERSEDED and RETIRED revisions (the full
   * audit history). Default: ACTIVE documents only.
   */
  readonly includeHistory?: boolean;
}

/** Parameters for deciding a pending pricing override. */
export interface DecideModelPricingOverrideParams {
  /** The PENDING_SIGNOFF override to decide. */
  readonly overrideId: string;
  /**
   * `true` approves (the override becomes ACTIVE and supersedes any
   * current ACTIVE override on the same pricing key); `false` rejects.
   */
  readonly approve: boolean;
  /** Optional note recorded on the decision for the audit trail. */
  readonly decisionNote?: string;
}

/**
 * Client for the billing bounded context.
 *
 * Wraps the user-facing billing RPCs: account provisioning,
 * balance queries, ledger history, and credit purchases via
 * Stripe Checkout. Internal execution-billing RPCs (authorize,
 * report, finalize) are not exposed — they are called only by
 * the Temporal workflow and agent runner.
 */
export class BillingClient {
  private readonly command: Client<typeof BillingCommandController>;
  private readonly query: Client<typeof BillingQueryController>;

  constructor(transport: Transport) {
    this.command = createClient(BillingCommandController, transport);
    this.query = createClient(BillingQueryController, transport);
  }

  /**
   * Provision or retrieve the billing account for an organization.
   *
   * Idempotent: creates the account on first call, returns the
   * existing account on subsequent calls.
   */
  async getOrCreateBillingAccount(orgId: string): Promise<BillingAccount> {
    try {
      return await this.command.getOrCreateBillingAccount(
        create(GetOrCreateBillingAccountInputSchema, { orgId }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Retrieve the billing account for an organization. */
  async getBillingAccount(orgId: string): Promise<BillingAccount> {
    try {
      return await this.query.getBillingAccount(
        create(GetBillingAccountInputSchema, { orgId }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Retrieve the credit balance breakdown for an organization. */
  async getCreditBalance(orgId: string): Promise<CreditBalance> {
    try {
      return await this.query.getCreditBalance(
        create(GetCreditBalanceInputSchema, { orgId }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Manually adjust an organization's credit balance.
   *
   * Positive `amountMicros` adds credits (e.g. funding a tenant org),
   * negative removes them. The adjustment is recorded as a ledger entry
   * with the supplied reason; the idempotency key deduplicates retries.
   * Requires `can_manage_billing` on the org.
   */
  async adjustCredits(params: AdjustCreditsParams): Promise<CreditLedgerEntry> {
    try {
      return await this.command.adjustCredits(
        create(AdjustCreditsInputSchema, {
          orgId: params.orgId,
          amountMicros: params.amountMicros,
          reason: params.reason,
          idempotencyKey: params.idempotencyKey,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Retrieve paginated credit ledger entries with optional filters. */
  async getCreditLedger(params: GetCreditLedgerParams): Promise<CreditLedgerResponse> {
    try {
      return await this.query.getCreditLedger(
        create(GetCreditLedgerInputSchema, {
          orgId: params.orgId,
          ...(params.page && {
            page: create(PageInfoSchema, {
              num: params.page.num,
              size: params.page.size,
            }),
          }),
          ...(params.typeFilter?.length && { typeFilter: params.typeFilter }),
          ...(params.startTime && { startTime: timestampFromDate(params.startTime) }),
          ...(params.endTime && { endTime: timestampFromDate(params.endTime) }),
          ...(params.view !== undefined && { view: params.view }),
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Create a Stripe Checkout Session to purchase a credit pack.
   *
   * Returns the Stripe-hosted checkout URL. The caller should
   * redirect the user to `checkoutUrl` to complete payment.
   * Credits are provisioned asynchronously via webhook after
   * payment succeeds.
   */
  async createCreditCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<CreateCreditCheckoutSessionResponse> {
    try {
      return await this.command.createCreditCheckoutSession(
        create(CreateCreditCheckoutSessionInputSchema, {
          orgId: params.orgId,
          packId: params.packId,
          successUrl: params.successUrl,
          cancelUrl: params.cancelUrl,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Create a Stripe Billing Portal session for payment method management.
   *
   * Returns the Stripe-hosted portal URL. The caller should redirect
   * the user to `portalUrl` to manage their saved payment methods.
   * Changes made in the portal are synced back via webhooks.
   */
  async createBillingPortalSession(
    params: CreateBillingPortalSessionParams,
  ): Promise<CreateBillingPortalSessionResponse> {
    try {
      return await this.command.createBillingPortalSession(
        create(CreateBillingPortalSessionInputSchema, {
          orgId: params.orgId,
          returnUrl: params.returnUrl,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Configure automatic credit recharge for an organization.
   *
   * When enabled, the billing system charges the account's saved
   * payment method whenever the available balance drops below the
   * configured threshold. Returns the updated BillingAccount.
   */
  async setAutoRechargeConfig(
    params: SetAutoRechargeConfigParams,
  ): Promise<BillingAccount> {
    try {
      return await this.command.setAutoRechargeConfig(
        create(SetAutoRechargeConfigInputSchema, {
          orgId: params.orgId,
          enabled: params.enabled,
          thresholdMicros: params.thresholdMicros,
          rechargeAmountMicros: params.rechargeAmountMicros,
          monthlyCapMicros: params.monthlyCapMicros,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Retrieve an aggregated billing usage report for a date range.
   *
   * Returns total provider cost, total billable amount, execution
   * and LLM call counts, and a per-model breakdown with cost tier
   * attribution. Data is sourced from the `llm_call_usage_record`
   * collection (proxy-observed, tamper-proof).
   */
  async getBillingUsageReport(
    params: GetBillingUsageReportParams,
  ): Promise<BillingUsageReportResponse> {
    try {
      return await this.query.getBillingUsageReport(
        create(GetBillingUsageReportInputSchema, {
          orgId: params.orgId,
          startTime: timestampFromDate(params.startTime),
          endTime: timestampFromDate(params.endTime),
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Retrieve the customer-facing model price list with markup applied.
   *
   * Returns per-million-token prices for all billable models, with
   * the active billing policy markup already factored in. These are
   * the prices the customer pays, organized by harness and cost tier.
   *
   * Pass `orgId` to resolve org-specific policy overrides (future).
   * Omit for default pricing.
   */
  async getCustomerModelPricing(
    params?: GetCustomerModelPricingParams,
  ): Promise<CustomerModelPricingResponse> {
    try {
      return await this.query.getCustomerModelPricing(
        create(GetCustomerModelPricingInputSchema, {
          orgId: params?.orgId ?? "",
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Retrieve the platform pricing governance view: baseline vs effective
   * rates per model, ACTIVE override provenance, and pending sign-off
   * proposals from the pricing feedback loop.
   *
   * Platform-operator surface (`can_manage_model_pricing` on
   * `platform:stigmer`): rates are raw provider prices, pre-markup.
   */
  async getModelPricingGovernance(): Promise<ModelPricingGovernanceResponse> {
    try {
      return await this.query.getModelPricingGovernance(
        create(GetModelPricingGovernanceInputSchema, {}),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Record a human decision on a PENDING_SIGNOFF pricing override.
   *
   * Approving makes the override ACTIVE (superseding any current ACTIVE
   * override on the same pricing key) and recomposes the effective
   * registry; rejecting archives it for audit. Returns the decided
   * override with the decision stamped.
   */
  async decideModelPricingOverride(
    params: DecideModelPricingOverrideParams,
  ): Promise<ModelPricingOverride> {
    try {
      return await this.command.decideModelPricingOverride(
        create(DecideModelPricingOverrideInputSchema, {
          overrideId: params.overrideId,
          approve: params.approve,
          decisionNote: params.decisionNote ?? "",
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Retrieve the model registry baseline catalog: ACTIVE entries by
   * default, or the full append-only revision history with
   * `includeHistory`.
   *
   * Platform-operator surface (`can_manage_model_pricing` on
   * `platform:stigmer`): rates are raw provider prices, pre-markup.
   */
  async listModelPricingBaselines(
    params?: ListModelPricingBaselinesParams,
  ): Promise<ModelPricingBaselinesResponse> {
    try {
      return await this.query.listModelPricingBaselines(
        create(ListModelPricingBaselinesInputSchema, {
          includeHistory: params?.includeHistory ?? false,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Create or revise one model registry baseline entry (catalog + list
   * prices). Append-only: an existing ACTIVE entry for the same
   * (modelId, provider, harness) key is superseded, never mutated, and
   * the effective registry recomposes immediately. Returns the new
   * revision with server-stamped lifecycle fields.
   */
  async upsertModelPricingBaseline(
    params: UpsertModelPricingBaselineParams,
  ): Promise<ModelPricingBaseline> {
    try {
      return await this.command.upsertModelPricingBaseline(
        create(UpsertModelPricingBaselineInputSchema, {
          baseline: params.baseline,
          revisionNote: params.revisionNote ?? "",
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Retire one model from the registry catalog. The model disappears
   * from every price surface on the next composition pass; the document
   * is kept for audit and the key can be revived by a subsequent upsert.
   */
  async retireModelPricingBaseline(
    params: RetireModelPricingBaselineParams,
  ): Promise<ModelPricingBaseline> {
    try {
      return await this.command.retireModelPricingBaseline(
        create(RetireModelPricingBaselineInputSchema, {
          modelId: params.modelId,
          provider: params.provider,
          harness: params.harness,
          revisionNote: params.revisionNote ?? "",
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }
}
