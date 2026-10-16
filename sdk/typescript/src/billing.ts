import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { BillingCommandController } from "@stigmer/apis/ai/stigmer/billing/v1/command_pb";
import { BillingQueryController } from "@stigmer/apis/ai/stigmer/billing/v1/query_pb";
import {
  GetOrCreateBillingAccountInputSchema,
  GetBillingAccountInputSchema,
  CreateBillingPortalSessionInputSchema,
  CreatePaymentMethodSetupSessionInputSchema,
  UpsertModelPricingBaselineInputSchema,
  RetireModelPricingBaselineInputSchema,
  ListModelPricingBaselinesInputSchema,
  type CreateBillingPortalSessionResponse,
  type CreatePaymentMethodSetupSessionResponse,
  type ModelPricingBaselinesResponse,
} from "@stigmer/apis/ai/stigmer/billing/v1/io_pb";
import type { ModelPricingBaseline } from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import type { BillingAccount } from "@stigmer/apis/ai/stigmer/billing/v1/billing_account_pb";
import { wrapError } from "./gen/errors.js";
import { everyEntry } from "./pages.js";

/** Parameters for creating a Stripe Billing Portal session. */
export interface CreateBillingPortalSessionParams {
  readonly org: string;
  readonly returnUrl: string;
}

/** Parameters for creating a Stripe Checkout Session that saves a card. */
export interface CreatePaymentMethodSetupSessionParams {
  readonly org: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
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
  /** The most entries to return: 0 or unset asks for the default page of 50, and above 100 reads 100. */
  readonly pageSize?: number;
  /** The previous response's `nextPageToken`, to continue the same list. */
  readonly pageToken?: string;
}

/**
 * Client for the billing bounded context.
 *
 * Wraps the user-facing billing RPCs: the organization's billing
 * account (its Stripe customer), the Stripe portal and card setup
 * sessions, and the platform operator's model catalog. Token usage is
 * read from the run client's usage reports, counted in tokens and never
 * priced. The proxy's metering write (`recordLlmCallUsage`) is not
 * exposed; only the server calls it.
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
  async getOrCreateBillingAccount(org: string): Promise<BillingAccount> {
    try {
      return await this.command.getOrCreateBillingAccount(
        create(GetOrCreateBillingAccountInputSchema, { org }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /** Retrieve the billing account for an organization. */
  async getBillingAccount(org: string): Promise<BillingAccount> {
    try {
      return await this.query.getBillingAccount(
        create(GetBillingAccountInputSchema, { org }),
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
          org: params.org,
          returnUrl: params.returnUrl,
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Create a Stripe Checkout Session that saves a payment method without
   * charging it.
   *
   * Returns the Stripe-hosted setup URL. The caller should redirect the
   * user to `setupUrl`. This is how an organization puts a card on
   * file for its plan's invoices; the saved card becomes the account's
   * default via webhook.
   */
  async createPaymentMethodSetupSession(
    params: CreatePaymentMethodSetupSessionParams,
  ): Promise<CreatePaymentMethodSetupSessionResponse> {
    try {
      return await this.command.createPaymentMethodSetupSession(
        create(CreatePaymentMethodSetupSessionInputSchema, {
          org: params.org,
          successUrl: params.successUrl,
          cancelUrl: params.cancelUrl,
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
   * `platform:stigmer`): rates are the providers' list prices.
   */
  async listModelPricingBaselines(
    params?: ListModelPricingBaselinesParams,
  ): Promise<ModelPricingBaselinesResponse> {
    try {
      return await this.query.listModelPricingBaselines(
        create(ListModelPricingBaselinesInputSchema, {
          includeHistory: params?.includeHistory ?? false,
          pageSize: params?.pageSize ?? 0,
          pageToken: params?.pageToken ?? "",
        }),
      );
    } catch (e) {
      throw wrapError(e);
    }
  }

  /**
   * Every baseline of the catalog, page after page, following
   * `nextPageToken` from the token the params name. Breaking out of the
   * loop stops the reads.
   */
  listModelPricingBaselinesAll(
    params?: ListModelPricingBaselinesParams,
  ): AsyncGenerator<ModelPricingBaseline> {
    return everyEntry(
      (pageToken) => this.listModelPricingBaselines({ ...params, pageToken }),
      params?.pageToken ?? "",
    );
  }

  /**
   * Create or revise one model registry baseline entry (catalog + list
   * prices). Append-only: an existing ACTIVE entry for the same
   * (modelId, provider, harness) key is superseded, never mutated, and
   * the registry is rebuilt immediately. Returns the new
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
   * Retire one model from the registry catalog. The rebuilt registry
   * drops it from every price surface; the document is kept for audit
   * and the key can be revived by a subsequent upsert.
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
