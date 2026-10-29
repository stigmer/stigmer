// Billing engine conformance — the 8 RPCs of the billing engine and the
// Stripe webhook (Class A; no runner). The composition is held to the
// inventory's rows.
// Domain: billing.
//
// Every `it` carries an inventory row id in square brackets — the
// `inventory/cloud-capabilities.yaml` row it proves; `npm run inventory:check`
// fails when a `conformance` row has no test here or a tag names no row.
//
// Where `billingEngine` is TRUE (cloud): the organization's own lanes (its
// billing account, its card on file) are driven as the org owner (the
// primary user) and an outsider; the usage meter and model catalog lanes as
// the platform operator (`provisionPrivilegedScope` — the FGA model derives
// can_execute_billing_ops and can_manage_model_pricing from
// platform#operator) with the ordinary caller's refusal pinned to the
// proto's own error_msg. The meter's records are read back through the
// run's own usage report, the only usage read there is. The card-on-file path runs against the run's fake
// Stripe (harness/fake-stripe.ts): the server's outbound calls land there,
// and the suite signs the webhook events it posts back with the secret the
// server was booted with.
//
// Where `billingEngine` is FALSE (the local OSS targets): OSS routes neither
// billing controller, so every RPC answers Unimplemented — the edition
// boundary as an observable contract (the versionTagging posture). Pinned
// once per RPC below.
//
// The fixtures are shared across every file in a cloud run
// (fileParallelism: false), so each block that drives the fake Stripe resets
// it in its own afterEach — the blocks that never touch Stripe do not pay for
// a reset they do not need.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ProviderKeySource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { BillingAccountStatus } from "@stigmer/apis/ai/stigmer/billing/v1/enum_pb";
import { ModelPricingBaselineStatus, type ModelPricingBaseline } from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { FixtureTracker } from "../harness/fixtures";
import { FAKE_CARD, paymentMethodAttached, postStripeWebhook, signStripePayload, signedEvent, stripeEvent } from "../harness/fake-stripe";
import { expectGrpcCode } from "../contract/errors";
import { requireCloudFixtures, type CloudFixturesClient } from "../support/cloud-fixtures-client";
import { agentRefOf, makeAgent } from "../support/agents";
import { makeAgentExecution } from "../support/runs";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";
import type { ConformanceClients } from "../harness/clients";
import type { PrivilegedScope, TenancyContext } from "../targets/target";

// Collection-time capability read (the billing-denial / routine-firing pattern).
const engineServed = createTarget().capabilities.billingEngine;

let target: TargetProfile;
let clients: ConformanceClients;
// The run's fixture control client — the fake Stripe's captures and scripted
// failures. Resolved once the target confirms it serves the engine (the local
// OSS targets publish no fixtures and never reach the Stripe blocks).
let control: CloudFixturesClient;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  if (engineServed) control = requireCloudFixtures();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

// The refusal copy the proto declares per RPC (billing/v1/command.proto,
// query.proto authorization options) — contract by construction in both
// editions, so the suite pins the bytes.
const COPY = {
  viewBilling: "unauthorized to view billing for this organization",
  manageBilling: "unauthorized to manage billing for this organization",
  engineOps: "only platform operators can execute billing operations",
  pricingEdit: "only platform operators can edit the model registry baseline",
  pricingBaselineView: "only platform operators can view the model registry baseline",
} as const;

// The engine's OWN validation copy — service code, not a proto option, so a
// different provenance from COPY above and pinned in its own table: the
// composition carries the domain exactly, and the console / SDKs surface
// these strings to the user, which makes the bytes the contract. Each line
// names the handler the string belongs to.
const DOMAIN_COPY = {
  // RetireModelPricingBaselineHandler
  noActiveBaseline: (modelId: string, provider: string, harness: string) =>
    `No ACTIVE baseline found for ${modelId}/${provider}/${harness} — it may already be retired, or the key is misspelled.`,
} as const;

// A Class A billing test needs an org, an outsider, and — for the meter and
// catalog lanes — the operator. These wrap the target's affordances with the
// loud-failure posture: a billingEngine target without them is a target bug,
// never a skip.
async function keylessOrg(): Promise<TenancyContext> {
  if (target.provisionKeylessTenancy === undefined) {
    throw new Error(`target ${target.name} declares billingEngine but provides no provisionKeylessTenancy()`);
  }
  const context = await target.provisionKeylessTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  return context;
}

// An org holding the target's provider keys, so a run can be created in it:
// the meter attributes a call to the organization of the run it names.
async function keyedOrg(): Promise<TenancyContext> {
  const context = await keylessOrg();
  if (target.keyTenancy === undefined) {
    throw new Error(`target ${target.name} declares billingEngine but provides no keyTenancy()`);
  }
  await target.keyTenancy(context.org);
  return context;
}

// A real agent execution in the org, owned by the primary: the run a
// recorded call names, and whose organization the call is counted against.
async function ownedExecution(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("meter-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("meter-exec"), agentRef: agentRefOf(agent) }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution.metadata!.id;
}

async function outsider(): Promise<ConformanceClients> {
  if (target.provisionIdentity === undefined) {
    throw new Error(`target ${target.name} declares billingEngine but provides no provisionIdentity()`);
  }
  return target.provisionIdentity();
}

async function operator(): Promise<PrivilegedScope> {
  if (target.provisionPrivilegedScope === undefined) {
    throw new Error(`target ${target.name} declares billingEngine but provides no provisionPrivilegedScope()`);
  }
  const scope = await target.provisionPrivilegedScope();
  fixtures.defer(() => scope.cleanup());
  return scope;
}

// ---------------------------------------------------------------------------
// The Stripe half. Outbound, the server dials the run's fake
// (harness/fake-stripe.ts) and the suite reads what landed there; inbound,
// the suite IS Stripe — it authors the event payloads below and signs them
// with the secret the server was booted with. The fake owns Stripe's response
// shapes; the suite owns the events it posts, so the builders live here
// beside the arms that use them, except `payment_method.attached`, which
// the plan move shares (harness/fake-stripe.ts).

async function post(event: ReturnType<typeof stripeEvent>, options: { secret?: string; timestamp?: number } = {}) {
  const lane = target.stripeWebhook!();
  return postStripeWebhook(lane.baseUrl, signedEvent(event, options.secret ?? lane.signingSecret, options.timestamp));
}

// `customer.updated` carries the customer with its invoice settings; the
// handler reads `invoice_settings.default_payment_method` and, when set,
// retrieves the payment method from the (fake) API before writing it onto
// the account.
function customerUpdated(customerId: string, defaultPaymentMethodId: string | null) {
  return stripeEvent("customer.updated", { id: customerId, object: "customer", invoice_settings: { default_payment_method: defaultPaymentMethodId } });
}

// The server mints the org's Stripe customer the first time the org saves a
// card (the setup session); the fake's captured `POST /v1/customers` answer
// is the id. Customer creation and use must share one test — the fake
// forgets its customers on reset().
async function seedStripeCustomer(as: ConformanceClients, org: string): Promise<string> {
  await as.billingCommand.createPaymentMethodSetupSession({ org, successUrl: "https://x.test/saved", cancelUrl: "https://x.test/back" });
  const created = (await control.stripe.requests()).filter((r) => r.method === "POST" && r.path === "/v1/customers").at(-1);
  const customerId = created?.response.id;
  if (customerId === undefined) throw new Error(`seedStripeCustomer(${org}): the setup session created no Stripe customer on the fake`);
  return customerId;
}

describe.skipIf(!engineServed)("Billing engine conformance — the billing account (billingEngine targets)", () => {
  it("[billing.gate.provision-account.org-create-provisions-account] [billing.rpc.get-billing-account.owner-reads-active-account] [rpc:BillingQueryController.getBillingAccount] an organization create provisions an active account the owner can read at once", async () => {
    const { org } = await keylessOrg();
    const account = await clients.billingQuery.getBillingAccount({ org });
    expect(account.org).toBe(org);
    expect(account.id, "the account carries an id").not.toBe("");
    expect(account.status).toBe(BillingAccountStatus.billing_account_active);
    expect(account.stripeCustomerId, "no Stripe customer before the org saves a card").toBe("");
    expect(account.defaultPaymentMethod, "no card on file").toBeUndefined();
  });

  it("[billing.rpc.get-billing-account.outsider-permission-denied] [rpc:BillingQueryController.getBillingAccount] an outsider's read is refused with the proto's copy", async () => {
    const { org } = await keylessOrg();
    const other = await outsider();
    const denied = await expectGrpcCode(
      () => other.billingQuery.getBillingAccount({ org }),
      Code.PermissionDenied,
      "outsider getBillingAccount",
    );
    expect(denied.rawMessage).toBe(COPY.viewBilling);
  });

  it("[billing.rpc.get-or-create-billing-account.idempotent-for-existing] [rpc:BillingCommandController.getOrCreateBillingAccount] getOrCreateBillingAccount returns the existing account, never a second one", async () => {
    const { org } = await keylessOrg();
    const first = await clients.billingQuery.getBillingAccount({ org });
    const again = await clients.billingCommand.getOrCreateBillingAccount({ org });
    expect(again.id).toBe(first.id);
    expect(again.status).toBe(first.status);
  });

  it("[billing.rpc.get-or-create-billing-account.member-without-manage-denied] [rpc:BillingCommandController.getOrCreateBillingAccount] an outsider's getOrCreateBillingAccount is refused", async () => {
    const { org } = await keylessOrg();
    const other = await outsider();
    const denied = await expectGrpcCode(
      () => other.billingCommand.getOrCreateBillingAccount({ org }),
      Code.PermissionDenied,
      "outsider getOrCreateBillingAccount",
    );
    expect(denied.rawMessage).toBe(COPY.manageBilling);
  });
});

describe.skipIf(!engineServed)("Billing engine conformance — the card on file against the fake Stripe", () => {
  afterEach(async () => {
    await control.stripe.reset();
  });

  it("[billing.rpc.create-billing-portal-session.returns-portal-url] [billing.rpc.create-billing-portal-session.no-customer-failed-precondition] [rpc:BillingCommandController.createBillingPortalSession] the portal needs a Stripe customer, then returns the session URL", async () => {
    const { org } = await keylessOrg();
    await expectGrpcCode(
      () => clients.billingCommand.createBillingPortalSession({ org, returnUrl: "https://x.test/back" }),
      Code.FailedPrecondition,
      "portal without a customer",
    );
    expect((await control.stripe.requests()).filter((r) => r.path.startsWith("/v1/billing_portal"))).toEqual([]);

    const customerId = await seedStripeCustomer(clients, org);
    const portal = await clients.billingCommand.createBillingPortalSession({ org, returnUrl: "https://x.test/back" });
    expect(portal.portalUrl).toMatch(/^https:\/\/billing\.stripe\.test\//);
    const request = (await control.stripe.requests()).find((r) => r.path === "/v1/billing_portal/sessions");
    expect(request?.params["customer"]).toBe(customerId);
    expect(request?.params["return_url"]).toBe("https://x.test/back");
  });

  it("[billing.rpc.create-payment-method-setup-session.creates-customer-and-setup-session] [rpc:BillingCommandController.createPaymentMethodSetupSession] a setup session saves a card for the org, charging nothing", async () => {
    const { org } = await keylessOrg();
    const input = { org, successUrl: "https://x.test/saved", cancelUrl: "https://x.test/back" };
    const first = await clients.billingCommand.createPaymentMethodSetupSession(input);
    expect(first.setupUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(first.checkoutSessionId).not.toBe("");
    await clients.billingCommand.createPaymentMethodSetupSession(input);

    const requests = await control.stripe.requests();
    const customers = requests.filter((r) => r.path === "/v1/customers" && r.method === "POST");
    expect(customers, "the customer is created once and reused").toHaveLength(1);
    expect(customers[0]?.params["name"]).toBe(org);
    expect(customers[0]?.params["metadata[stigmer_org_id]"]).toBe(org);
    const sessions = requests.filter((r) => r.path === "/v1/checkout/sessions" && r.method === "POST");
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.params["mode"]).toBe("setup");
    expect(sessions[0]?.params["customer"]).toBe(customers[0]?.response.id);
    expect(sessions[0]?.params["success_url"]).toBe("https://x.test/saved");
    expect(sessions[0]?.params["cancel_url"]).toBe("https://x.test/back");
    expect(requests.filter((r) => r.path.startsWith("/v1/payment_intents")), "a setup session charges nothing").toEqual([]);
    const account = await clients.billingQuery.getBillingAccount({ org });
    expect(account.stripeCustomerId).toBe(customers[0]?.response.id);
  });

  it("[billing.rpc.create-payment-method-setup-session.outsider-permission-denied] [rpc:BillingCommandController.createPaymentMethodSetupSession] an outsider cannot save a card for the org", async () => {
    const { org } = await keylessOrg();
    const other = await outsider();
    const denied = await expectGrpcCode(
      () => other.billingCommand.createPaymentMethodSetupSession({ org, successUrl: "https://x.test/ok", cancelUrl: "https://x.test/c" }),
      Code.PermissionDenied,
      "outsider setup session",
    );
    expect(denied.rawMessage).toBe(COPY.manageBilling);
    expect((await control.stripe.requests()).filter((r) => r.path.startsWith("/v1/checkout"))).toEqual([]);
  });

  // --- the webhook half: the suite is Stripe here (the builders at module
  // scope), posting the events a saved card produces back to the lane.

  it("[billing.stripe.payment-method-attached.sets-default-when-none] payment_method.attached becomes the account's default card only when none is set, tells Stripe so, ignores a second card and a non-card, and does nothing for a customer the server does not know", async () => {
    const { org } = await keylessOrg();
    const customerId = await seedStripeCustomer(clients, org);
    expect((await clients.billingQuery.getBillingAccount({ org })).defaultPaymentMethod, "no default before any card").toBeUndefined();

    const first = uniqueName("pm_conf_first");
    expect((await post(paymentMethodAttached(first, customerId))).status).toBe(200);
    const account = await clients.billingQuery.getBillingAccount({ org });
    expect(account.defaultPaymentMethod?.paymentMethodId).toBe(first);
    expect(account.defaultPaymentMethod?.brand).toBe(FAKE_CARD.brand);
    expect(account.defaultPaymentMethod?.last4).toBe(FAKE_CARD.last4);
    expect(account.defaultPaymentMethod?.expMonth).toBe(FAKE_CARD.exp_month);
    expect(account.defaultPaymentMethod?.expYear).toBe(FAKE_CARD.exp_year);
    // The server also makes the card the customer's default ON STRIPE.
    const customerUpdates = (await control.stripe.requests()).filter((r) => r.method === "POST" && r.path === `/v1/customers/${customerId}`);
    expect(customerUpdates.map((r) => r.params["invoice_settings[default_payment_method]"])).toEqual([first]);

    // A second card does not displace the first — and Stripe is not told again.
    const second = uniqueName("pm_conf_second");
    expect((await post(paymentMethodAttached(second, customerId))).status).toBe(200);
    expect((await clients.billingQuery.getBillingAccount({ org })).defaultPaymentMethod?.paymentMethodId).toBe(first);
    expect((await control.stripe.requests()).filter((r) => r.method === "POST" && r.path === `/v1/customers/${customerId}`)).toHaveLength(1);

    // A non-card method carries no card and is ignored; an unknown customer is a silent 200.
    const other = await keylessOrg();
    const otherCustomer = await seedStripeCustomer(clients, other.org);
    expect((await post(paymentMethodAttached(uniqueName("pm_conf_bank"), otherCustomer, { type: "us_bank_account" }))).status).toBe(200);
    expect((await clients.billingQuery.getBillingAccount({ org: other.org })).defaultPaymentMethod).toBeUndefined();
    const unknown = await post(paymentMethodAttached(uniqueName("pm_conf_stray"), "cus_conf_nobody"));
    expect(unknown.status).toBe(200);
    expect(unknown.body).toBe("ok");
  });

  it("[billing.stripe.signature.valid-event-accepted-200-ok] [billing.stripe.webhook.anonymous-reachable] [billing.stripe.customer-updated.syncs-default-payment-method] a signed customer.updated, posted with no bearer, answers 200 ok; with a default payment method the server retrieves the card and records it, with none it clears the account's default, and an unknown customer is a silent 200", async () => {
    const { org } = await keylessOrg();
    const customerId = await seedStripeCustomer(clients, org);

    const paymentMethodId = uniqueName("pm_conf_sync");
    const accepted = await post(customerUpdated(customerId, paymentMethodId));
    expect(accepted.status).toBe(200);
    expect(accepted.body).toBe("ok");
    const retrieved = (await control.stripe.requests()).find((r) => r.method === "GET" && r.path === `/v1/payment_methods/${paymentMethodId}`);
    expect(retrieved, "the server retrieves the method Stripe named — the card details are not on the event").toBeDefined();
    const synced = await clients.billingQuery.getBillingAccount({ org });
    expect(synced.defaultPaymentMethod?.paymentMethodId).toBe(paymentMethodId);
    expect(synced.defaultPaymentMethod?.brand).toBe(FAKE_CARD.brand);
    expect(synced.defaultPaymentMethod?.last4).toBe(FAKE_CARD.last4);
    expect(synced.defaultPaymentMethod?.expMonth).toBe(FAKE_CARD.exp_month);
    expect(synced.defaultPaymentMethod?.expYear).toBe(FAKE_CARD.exp_year);

    // Stripe reports the default removed → the account's default is cleared.
    expect((await post(customerUpdated(customerId, null))).status).toBe(200);
    expect((await clients.billingQuery.getBillingAccount({ org })).defaultPaymentMethod, "a cleared default is gone, not zeroed").toBeUndefined();

    // A customer the server never minted: 200, nothing looked up.
    const before = (await control.stripe.requests()).length;
    const unknown = await post(customerUpdated("cus_conf_nobody", uniqueName("pm_conf_stray")));
    expect(unknown.status).toBe(200);
    expect(unknown.body).toBe("ok");
    expect((await control.stripe.requests()).length, "no payment-method retrieve for an unknown customer").toBe(before);
  });

  it("[billing.stripe.unhandled-event.ignored-200] an event type the server does not handle — a credit-pack checkout's and an off-session top-up's among them — answers 200 ok with no effect", async () => {
    const { org } = await keylessOrg();
    const customerId = await seedStripeCustomer(clients, org);
    const session = uniqueName("cs_test_conf_pack");
    const intent = uniqueName("pi_conf_topup");
    const packCheckout = { id: session, object: "checkout.session", mode: "payment", customer: customerId, payment_intent: intent, payment_status: "paid", status: "complete", metadata: { stigmer_org_id: org, stigmer_pack_id: "starter" } };
    const topUp = { id: intent, object: "payment_intent", customer: customerId, status: "succeeded", metadata: { stigmer_org_id: org, stigmer_recharge_event_id: uniqueName("evt-topup") } };
    const unhandled = [
      stripeEvent("checkout.session.completed", packCheckout),
      stripeEvent("checkout.session.async_payment_succeeded", packCheckout),
      stripeEvent("checkout.session.async_payment_failed", packCheckout),
      stripeEvent("checkout.session.expired", { ...packCheckout, status: "expired", payment_status: "unpaid" }),
      stripeEvent("payment_intent.succeeded", topUp),
      stripeEvent("payment_intent.payment_failed", { ...topUp, status: "requires_payment_method", last_payment_error: { code: "card_declined", message: "Your card was declined." } }),
      stripeEvent("charge.refunded", { id: uniqueName("ch_conf"), object: "charge", customer: customerId }),
    ];
    const before = await clients.billingQuery.getBillingAccount({ org });
    const outbound = (await control.stripe.requests()).length;
    for (const event of unhandled) {
      const response = await post(event);
      expect(response.status, event.type).toBe(200);
      expect(response.body, event.type).toBe("ok");
    }
    expect((await control.stripe.requests()).length, "no event made the server call Stripe").toBe(outbound);
    expect(await clients.billingQuery.getBillingAccount({ org }), "the account is unchanged").toEqual(before);
  });

  it("[billing.stripe.signature.wrong-secret-400-invalid-signature] [billing.stripe.signature.tampered-payload-400] [billing.stripe.signature.stale-timestamp-400] [billing.stripe.signature.missing-header-400] bad signatures are refused 400 and change nothing", async () => {
    const { org } = await keylessOrg();
    const customerId = await seedStripeCustomer(clients, org);
    const paymentMethodId = uniqueName("pm_conf_forged");
    const lane = target.stripeWebhook!();
    const event = customerUpdated(customerId, paymentMethodId);

    const wrongSecret = await post(event, { secret: "whsec_not_the_one" });
    expect(wrongSecret.status).toBe(400);
    expect(wrongSecret.body).toBe("Invalid signature");

    const signed = signedEvent(event, lane.signingSecret);
    const tampered = await postStripeWebhook(lane.baseUrl, { payload: signed.payload.replace(paymentMethodId, "pm_conf_tampered"), signature: signed.signature });
    expect(tampered.status).toBe(400);

    const stale = await post(event, { timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(stale.status).toBe(400);

    const missing = await fetch(`${lane.baseUrl}/webhook/stripe`, { method: "POST", headers: { "content-type": "application/json" }, body: signStripePayload(JSON.stringify(event), lane.signingSecret).payload });
    expect(missing.status, "no Stripe-Signature header is a bad request").toBe(400);

    expect((await control.stripe.requests()).filter((r) => r.path.startsWith("/v1/payment_methods")), "no refused event was acted on").toEqual([]);
    expect((await clients.billingQuery.getBillingAccount({ org })).defaultPaymentMethod).toBeUndefined();
  });
});

describe.skipIf(!engineServed)("Billing engine conformance — the usage meter and the model catalog (platform operator)", () => {
  it("[billing.rpc.engine-lanes.ordinary-caller-permission-denied] [rpc:BillingCommandController.recordLlmCallUsage] an org owner who is not a platform operator is refused on the meter's write with the proto's copy", async () => {
    const denied = await expectGrpcCode(
      () => clients.billingCommand.recordLlmCallUsage({ runId: uniqueName("exec"), sequence: 1, provider: "anthropic", resolvedModel: "claude-sonnet-4-6" }),
      Code.PermissionDenied,
      "ordinary caller recordLlmCallUsage",
    );
    expect(denied.rawMessage).toBe(COPY.engineOps);
  });

  it("[billing.rpc.pricing-admin-lanes.ordinary-caller-permission-denied] [rpc:BillingCommandController.upsertModelPricingBaseline] [rpc:BillingCommandController.retireModelPricingBaseline] [rpc:BillingQueryController.listModelPricingBaselines] an org owner is refused on every pricing-admin RPC with its own copy", async () => {
    // Input validation runs before authorization on these handlers, so each
    // call is structurally valid — the refusal must be the authorization's.
    const cases: Array<[string, () => Promise<unknown>, string]> = [
      [
        "upsertModelPricingBaseline",
        () =>
          clients.billingCommand.upsertModelPricingBaseline({
            baseline: {
              modelId: "conf-model",
              provider: "anthropic",
              harness: "stigmer",
              displayName: "Conformance",
              speedTier: "balanced",
              costTier: "standard",
              pricing: { inputPriceMicrosPerMillion: 1n, outputPriceMicrosPerMillion: 1n },
            },
          }),
        COPY.pricingEdit,
      ],
      ["retireModelPricingBaseline", () => clients.billingCommand.retireModelPricingBaseline({ modelId: "conf-model", provider: "anthropic", harness: "stigmer" }), COPY.pricingEdit],
      ["listModelPricingBaselines", () => clients.billingQuery.listModelPricingBaselines({}), COPY.pricingBaselineView],
    ];
    for (const [name, op, copy] of cases) {
      const denied = await expectGrpcCode(op, Code.PermissionDenied, `ordinary caller ${name}`);
      expect(denied.rawMessage, name).toBe(copy);
    }
  });

  it("[billing.rpc.record-llm-call-usage.records-calls-and-unknown-models] [billing.rpc.get-run-usage-report.reads-metered-tokens] [rpc:BillingCommandController.recordLlmCallUsage] recorded calls land on their run's usage report, metered on the organization's key; a model the catalog lacks is recorded rather than refused", async () => {
    const op = await operator();
    const { org } = await keyedOrg();
    const runId = await ownedExecution(org);
    const onOrgKey = { providerKeySource: ProviderKeySource.ORGANIZATION, harness: "stigmer", provider: "anthropic" } as const;
    const first = await op.clients.billingCommand.recordLlmCallUsage({
      runId,
      sequence: 1,
      resolvedModel: "claude-sonnet-4-6",
      requestedModel: "claude-sonnet-4-6",
      tokens: { inputTokens: 100n, outputTokens: 40n, totalTokens: 140n },
      ...onOrgKey,
    });
    const second = await op.clients.billingCommand.recordLlmCallUsage({
      runId,
      sequence: 2,
      resolvedModel: "model-nobody-catalogued",
      requestedModel: "model-nobody-catalogued",
      tokens: { inputTokens: 7n, outputTokens: 3n, totalTokens: 10n },
      ...onOrgKey,
    });
    expect(first.usageRecordId, "the meter mints a record id").not.toBe("");
    expect(second.usageRecordId).not.toBe(first.usageRecordId);
    expect(second.isDuplicate).toBe(false);

    // The run's own report reads the meter: two calls, their tokens, both on
    // the organization's key, and one breakdown row per model.
    const report = await clients.agentExecutionQuery.getRunUsageReport({ runId });
    expect(report.aggregate?.llmCallCount).toBe(2);
    expect(report.aggregate?.totalTokens).toBe(150n);
    expect(report.aggregate?.inputTokens).toBe(107n);
    expect(report.aggregate?.outputTokens).toBe(43n);
    expect(report.aggregate?.servedBy.map((row) => [row.providerKeySource, row.totalTokens, row.llmCallCount])).toEqual([
      [ProviderKeySource.ORGANIZATION, 150n, 2],
    ]);
    expect(report.aggregate?.primaryModel, "the model with the most tokens").toBe("claude-sonnet-4-6");
    expect(report.modelBreakdown.map((model) => [model.model, model.callCount, model.totalTokens]), "ordered by tokens, every call counted").toEqual([
      ["claude-sonnet-4-6", 1, 140n],
      ["model-nobody-catalogued", 1, 10n],
    ]);
  });

  // --- the model catalog lanes (operator tooling with a console).
  // Baselines are PLATFORM-GLOBAL state, not org
  // state: every arm keys its baseline on a run-unique model id and retires it
  // on cleanup, so nothing it creates outlives the test or reaches another
  // file's registry assertions.

  // A structurally valid baseline for a run-unique model. The registry
  // picks it up on upsert; retire removes it again.
  function conformanceBaseline(modelId: string, inputMicros = 1_000_000n, outputMicros = 5_000_000n) {
    return {
      modelId,
      provider: "anthropic",
      harness: "stigmer",
      displayName: `Conformance ${modelId}`,
      speedTier: "balanced",
      costTier: "standard",
      pricing: { inputPriceMicrosPerMillion: inputMicros, outputPriceMicrosPerMillion: outputMicros },
    };
  }

  async function upsertBaseline(op: PrivilegedScope, modelId: string, inputMicros?: bigint, outputMicros?: bigint) {
    const revision = await op.clients.billingCommand.upsertModelPricingBaseline({ baseline: conformanceBaseline(modelId, inputMicros, outputMicros), revisionNote: "conformance" });
    fixtures.defer(() => op.clients.billingCommand.retireModelPricingBaseline({ modelId, provider: "anthropic", harness: "stigmer" }).then(() => undefined, () => undefined));
    return revision;
  }

  // Every baseline the catalog lists, across its pages: a target's catalog
  // can hold more entries before an arm's key than one page carries, so an
  // arm never looks for its rows on the first page alone.
  async function everyBaseline(op: PrivilegedScope, includeHistory = false): Promise<ModelPricingBaseline[]> {
    const all: ModelPricingBaseline[] = [];
    let pageToken = "";
    do {
      const page = await op.clients.billingQuery.listModelPricingBaselines({ includeHistory, pageToken });
      all.push(...page.entries);
      pageToken = page.nextPageToken;
    } while (pageToken !== "");
    return all;
  }

  it("[billing.rpc.upsert-model-pricing-baseline.round-trips-through-list] [rpc:BillingCommandController.upsertModelPricingBaseline] [rpc:BillingQueryController.listModelPricingBaselines] an operator's upsert is listed ACTIVE with the server's stamps, and a second upsert of the same key supersedes the first", async () => {
    const op = await operator();
    const modelId = uniqueName("conf-model");

    const first = await upsertBaseline(op, modelId, 1_000_000n, 5_000_000n);
    expect(first.baselineId, "the server mints the baseline id").not.toBe("");
    expect(first.status).toBe(ModelPricingBaselineStatus.pricing_baseline_active);
    expect(first.supersedesBaselineId, "a fresh key supersedes nothing").toBe("");
    expect(first.decidedBy, "the deciding operator is stamped").not.toBe("");
    expect(first.pricing?.effectiveAt, "effective_at is stamped by the server").toBeDefined();
    expect(first.pricing?.inputPriceMicrosPerMillion).toBe(1_000_000n);

    const active = await everyBaseline(op);
    const listed = active.find((b) => b.modelId === modelId);
    expect(listed?.baselineId).toBe(first.baselineId);
    expect(listed?.pricing?.outputPriceMicrosPerMillion).toBe(5_000_000n);
    for (const baseline of active) expect(baseline.status, `${baseline.modelId} in the ACTIVE list`).toBe(ModelPricingBaselineStatus.pricing_baseline_active);

    // The same key again is a revision: the prior document is superseded and chained, not duplicated.
    const second = await op.clients.billingCommand.upsertModelPricingBaseline({ baseline: conformanceBaseline(modelId, 2_000_000n, 5_000_000n), revisionNote: "conformance revision" });
    expect(second.baselineId).not.toBe(first.baselineId);
    expect(second.supersedesBaselineId).toBe(first.baselineId);
    const activeNow = (await everyBaseline(op)).filter((b) => b.modelId === modelId);
    expect(activeNow.map((b) => b.baselineId), "exactly one ACTIVE document per key").toEqual([second.baselineId]);
    const history = (await everyBaseline(op, true)).filter((b) => b.modelId === modelId);
    expect(history.map((b) => [b.baselineId, b.status]), "history lists the ACTIVE revision first, then the superseded one").toEqual([
      [second.baselineId, ModelPricingBaselineStatus.pricing_baseline_active],
      [first.baselineId, ModelPricingBaselineStatus.pricing_baseline_superseded],
    ]);
  });

  it("[billing.rpc.retire-model-pricing-baseline.unknown-not-found] [rpc:BillingCommandController.retireModelPricingBaseline] retiring an unknown key is NOT_FOUND with the handler's copy; retiring a known one removes it from the ACTIVE list, and retiring it again is NOT_FOUND", async () => {
    const op = await operator();
    const unknown = uniqueName("conf-never-upserted");
    const missing = await expectGrpcCode(
      () => op.clients.billingCommand.retireModelPricingBaseline({ modelId: unknown, provider: "anthropic", harness: "stigmer" }),
      Code.NotFound,
      "retire an unknown key",
    );
    expect(missing.rawMessage).toBe(DOMAIN_COPY.noActiveBaseline(unknown, "anthropic", "stigmer"));

    const modelId = uniqueName("conf-model");
    const upserted = await upsertBaseline(op, modelId);
    const retired = await op.clients.billingCommand.retireModelPricingBaseline({ modelId, provider: "anthropic", harness: "stigmer", revisionNote: "conformance retire" });
    expect(retired.baselineId).toBe(upserted.baselineId);
    expect(retired.status).toBe(ModelPricingBaselineStatus.pricing_baseline_retired);
    const active = await everyBaseline(op);
    expect(active.some((b) => b.modelId === modelId), "a retired key is not ACTIVE").toBe(false);
    const history = await everyBaseline(op, true);
    expect(history.find((b) => b.baselineId === upserted.baselineId)?.status).toBe(ModelPricingBaselineStatus.pricing_baseline_retired);

    const again = await expectGrpcCode(
      () => op.clients.billingCommand.retireModelPricingBaseline({ modelId, provider: "anthropic", harness: "stigmer" }),
      Code.NotFound,
      "retire an already-retired key",
    );
    expect(again.rawMessage).toBe(DOMAIN_COPY.noActiveBaseline(modelId, "anthropic", "stigmer"));
  });
});

describe.skipIf(engineServed)("Billing engine conformance — the OSS boundary (no billing controllers routed)", () => {
  it("[billing.rpc.oss-boundary.every-billing-rpc-unimplemented] [rpc:BillingCommandController.getOrCreateBillingAccount] [rpc:BillingCommandController.recordLlmCallUsage] [rpc:BillingCommandController.createBillingPortalSession] [rpc:BillingCommandController.createPaymentMethodSetupSession] [rpc:BillingCommandController.upsertModelPricingBaseline] [rpc:BillingCommandController.retireModelPricingBaseline] [rpc:BillingQueryController.getBillingAccount] [rpc:BillingQueryController.listModelPricingBaselines] every billing RPC answers Unimplemented where billingEngine is false", async () => {
    const org = uniqueName("org");
    const executionId = uniqueName("exec");
    const lanes: Array<[string, () => Promise<unknown>]> = [
      ["getOrCreateBillingAccount", () => clients.billingCommand.getOrCreateBillingAccount({ org })],
      ["recordLlmCallUsage", () => clients.billingCommand.recordLlmCallUsage({ runId: executionId, sequence: 1, provider: "anthropic", resolvedModel: "m" })],
      ["createBillingPortalSession", () => clients.billingCommand.createBillingPortalSession({ org, returnUrl: "https://x/back" })],
      ["createPaymentMethodSetupSession", () => clients.billingCommand.createPaymentMethodSetupSession({ org, successUrl: "https://x/ok", cancelUrl: "https://x/c" })],
      ["upsertModelPricingBaseline", () => clients.billingCommand.upsertModelPricingBaseline({ baseline: { modelId: "m", provider: "p", harness: "stigmer", displayName: "M", speedTier: "balanced", costTier: "standard", pricing: {} } })],
      ["retireModelPricingBaseline", () => clients.billingCommand.retireModelPricingBaseline({ modelId: "m", provider: "p", harness: "stigmer" })],
      ["getBillingAccount", () => clients.billingQuery.getBillingAccount({ org })],
      ["listModelPricingBaselines", () => clients.billingQuery.listModelPricingBaselines({})],
    ];
    expect(lanes, "the 8 RPCs, no more, no fewer").toHaveLength(8);
    for (const [name, op] of lanes) {
      await expectGrpcCode(op, Code.Unimplemented, `OSS ${name}`);
    }
  });
});
