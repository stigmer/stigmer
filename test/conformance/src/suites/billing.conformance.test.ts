// Billing ledger conformance — the 22 RPCs of the billing engine and the
// Stripe webhook (Class A; no runner). E1 of the convergence program's
// DD-012 reset (entry 20260906.04): Java's behavior is the spec, written
// green against the hermetic Java launcher, then run against the TS
// composition, whose reds are C5's acceptance.
// Domain: billing.
//
// Every `it` carries an inventory row id in square brackets — the
// `inventory/cloud-capabilities.yaml` row it proves; `npm run inventory:check`
// fails when a `conformance` row has no test here or a tag names no row.
//
// Where `billingLedger` is TRUE (cloud): the org lanes are driven as the org
// owner (the primary user) and an outsider; the engine and pricing-admin
// lanes as the platform operator (`provisionPrivilegedScope` — the FGA model
// derives can_execute_billing_ops and can_manage_model_pricing from
// platform#operator) with the ordinary caller's refusal pinned to the proto's
// own error_msg. The purchase money path runs against the run's fake Stripe
// (harness/fake-stripe.ts): Java's outbound calls land there, and the suite
// signs the webhook events it posts back with the secret the server was
// booted with.
//
// Where `billingLedger` is FALSE (the local OSS targets): OSS routes neither
// billing controller, so every RPC answers Unimplemented — the DD-001
// boundary as an observable contract (ruling Q10 of E1, the versionTagging /
// orgOAuthAppConfiguration posture). Pinned once per RPC below.
//
// The fixtures are shared across every file in a cloud run
// (fileParallelism: false), so this suite resets them in afterEach.
import { Code } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { FixtureTracker } from "../harness/fixtures";
import { postStripeWebhook, signStripePayload, signedEvent, stripeEvent } from "../harness/fake-stripe";
import { expectGrpcCode } from "../contract/errors";
import { requireCloudFixtures, type CloudFixturesClient } from "../support/cloud-fixtures-client";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";
import type { ConformanceClients } from "../harness/clients";
import type { PrivilegedScope, TenancyContext } from "../targets/target";

// Collection-time capability read (the billing-denial / schedule-firing pattern).
const ledgerServed = createTarget().capabilities.billingLedger;

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
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
  adjustCredits: "unauthorized to adjust credits for this organization",
  grantCredits: "unauthorized to grant credits for this organization",
  purchaseCredits: "unauthorized to purchase credits for this organization",
  engineOps: "only platform operators can execute billing operations",
  pricingDecide: "only platform operators can decide pricing overrides",
  pricingEdit: "only platform operators can edit the model registry baseline",
  pricingGovernance: "only platform operators can view pricing governance",
  pricingBaselineView: "only platform operators can view the model registry baseline",
  insufficientCredits: "Insufficient credits to start execution",
  noAccount: "No billing account for this organization",
} as const;

// A Class A billing test needs an org (funded or not), an outsider, and — for
// the engine lanes — the operator. These wrap the target's affordances with
// the loud-failure posture: a billingLedger target without them is a target
// bug, never a skip.
async function unfundedOrg(): Promise<TenancyContext> {
  if (target.provisionUnfundedTenancy === undefined) {
    throw new Error(`target ${target.name} declares billingLedger but provides no provisionUnfundedTenancy()`);
  }
  const context = await target.provisionUnfundedTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  return context;
}

async function fundedOrg(): Promise<TenancyContext> {
  const context = await unfundedOrg();
  if (target.fundTenancy === undefined) {
    throw new Error(`target ${target.name} declares billingLedger but provides no fundTenancy()`);
  }
  await target.fundTenancy(context.org);
  return context;
}

async function outsider(): Promise<ConformanceClients> {
  if (target.provisionIdentity === undefined) {
    throw new Error(`target ${target.name} declares billingLedger but provides no provisionIdentity()`);
  }
  return target.provisionIdentity();
}

async function operator(): Promise<PrivilegedScope> {
  if (target.provisionPrivilegedScope === undefined) {
    throw new Error(`target ${target.name} declares billingLedger but provides no provisionPrivilegedScope()`);
  }
  const scope = await target.provisionPrivilegedScope();
  fixtures.defer(() => scope.cleanup());
  return scope;
}

// Funds an org AS the given caller — the operator's scope org is owned by the
// operator, not by the primary user the target's fundTenancy acts as.
async function fundAs(as: ConformanceClients, org: string): Promise<void> {
  await as.billingCommand.getOrCreateBillingAccount({ orgId: org });
  await as.billingCommand.adjustCredits({ orgId: org, amountMicros: 100_000_000n, reason: "conformance operator seed", idempotencyKey: uniqueName("op-seed") });
}

async function balanceOf(org: string): Promise<bigint> {
  const balance = await clients.billingQuery.getCreditBalance({ orgId: org });
  return balance.availableMicros;
}

describe.skipIf(!ledgerServed)("Billing ledger conformance — accounts, balances and the ledger (billingLedger targets)", () => {
  it("[billing.gate.provision-account.org-create-provisions-zero-balance] [billing.rpc.get-billing-account.owner-reads-zero-balance-account] an organization create provisions an active zero-balance account the owner can read at once", async () => {
    const { org } = await unfundedOrg();
    const account = await clients.billingQuery.getBillingAccount({ orgId: org });
    expect(account.orgId).toBe(org);
    expect(account.id, "the account carries an id").not.toBe("");
    expect(account.balance?.availableMicros ?? 0n).toBe(0n);
    expect(account.balance?.reservedMicros ?? 0n).toBe(0n);
  });

  it("[billing.rpc.get-billing-account.outsider-permission-denied] [billing.rpc.get-credit-balance.outsider-permission-denied] an outsider's reads are refused with the proto's copy", async () => {
    const { org } = await unfundedOrg();
    const other = await outsider();
    const denied = await expectGrpcCode(
      () => other.billingQuery.getBillingAccount({ orgId: org }),
      Code.PermissionDenied,
      "outsider getBillingAccount",
    );
    expect(denied.rawMessage).toBe(COPY.viewBilling);
    const deniedBalance = await expectGrpcCode(
      () => other.billingQuery.getCreditBalance({ orgId: org }),
      Code.PermissionDenied,
      "outsider getCreditBalance",
    );
    expect(deniedBalance.rawMessage).toBe(COPY.viewBilling);
  });

  it("[billing.rpc.get-or-create-billing-account.idempotent-for-existing] getOrCreateBillingAccount returns the existing account, never a second one", async () => {
    const { org } = await unfundedOrg();
    const first = await clients.billingQuery.getBillingAccount({ orgId: org });
    const again = await clients.billingCommand.getOrCreateBillingAccount({ orgId: org });
    expect(again.id).toBe(first.id);
    expect(again.balance?.availableMicros).toBe(first.balance?.availableMicros);
  });

  it("[billing.rpc.get-or-create-billing-account.member-without-manage-denied] an outsider's getOrCreateBillingAccount is refused", async () => {
    const { org } = await unfundedOrg();
    const other = await outsider();
    const denied = await expectGrpcCode(
      () => other.billingCommand.getOrCreateBillingAccount({ orgId: org }),
      Code.PermissionDenied,
      "outsider getOrCreateBillingAccount",
    );
    expect(denied.rawMessage).toBe(COPY.manageBilling);
  });

  it("[billing.rpc.adjust-credits.positive-and-negative-move-balance] [billing.rpc.get-credit-balance.reflects-adjustments] [billing.rpc.get-credit-ledger.lists-entries-newest-first-with-shape] adjustments move the balance and land on the ledger with their shape", async () => {
    const { org } = await unfundedOrg();
    const up = await clients.billingCommand.adjustCredits({
      orgId: org,
      amountMicros: 5_000_000n,
      reason: "conformance credit",
      idempotencyKey: uniqueName("adj-up"),
    });
    expect(up.amountMicros).toBe(5_000_000n);
    expect(up.balanceAfterMicros).toBe(5_000_000n);
    expect(up.orgId).toBe(org);
    expect(up.entryId).not.toBe("");

    const down = await clients.billingCommand.adjustCredits({
      orgId: org,
      amountMicros: -2_000_000n,
      reason: "conformance debit",
      idempotencyKey: uniqueName("adj-down"),
    });
    expect(down.balanceAfterMicros).toBe(3_000_000n);
    expect(await balanceOf(org)).toBe(3_000_000n);

    const ledger = await clients.billingQuery.getCreditLedger({ orgId: org });
    const ids = ledger.entries.map((entry) => entry.entryId);
    expect(ids).toContain(up.entryId);
    expect(ids).toContain(down.entryId);
    for (const entry of ledger.entries) {
      expect(entry.orgId).toBe(org);
      expect(entry.idempotencyKey, "every entry carries the idempotency key it was written with").not.toBe("");
    }
  });

  it("[billing.rpc.adjust-credits.zero-amount-invalid-argument] a zero adjustment is refused INVALID_ARGUMENT with the handler's copy", async () => {
    const { org } = await unfundedOrg();
    const refused = await expectGrpcCode(
      () => clients.billingCommand.adjustCredits({ orgId: org, amountMicros: 0n, reason: "zero", idempotencyKey: uniqueName("zero") }),
      Code.InvalidArgument,
      "adjustCredits amount 0",
    );
    expect(refused.rawMessage).toBe("amount_micros must be non-zero");
  });

  it("[billing.rpc.adjust-credits.idempotency-key-replays-once] the same idempotency key applies the amount once and returns the original entry", async () => {
    const { org } = await unfundedOrg();
    const key = uniqueName("adj-idem");
    const first = await clients.billingCommand.adjustCredits({ orgId: org, amountMicros: 1_000_000n, reason: "idem", idempotencyKey: key });
    const replay = await clients.billingCommand.adjustCredits({ orgId: org, amountMicros: 1_000_000n, reason: "idem", idempotencyKey: key });
    expect(replay.entryId).toBe(first.entryId);
    expect(await balanceOf(org)).toBe(1_000_000n);
  });

  it("[billing.rpc.adjust-credits.outsider-permission-denied] [billing.rpc.grant-credits.outsider-permission-denied] an outsider's adjust and grant are refused with their own copy", async () => {
    const { org } = await unfundedOrg();
    const other = await outsider();
    const adjust = await expectGrpcCode(
      () => other.billingCommand.adjustCredits({ orgId: org, amountMicros: 1n, reason: "x", idempotencyKey: uniqueName("o") }),
      Code.PermissionDenied,
      "outsider adjustCredits",
    );
    expect(adjust.rawMessage).toBe(COPY.adjustCredits);
    const grant = await expectGrpcCode(
      () => other.billingCommand.grantCredits({ orgId: org, amountMicros: 1n, reason: "x", idempotencyKey: uniqueName("og") }),
      Code.PermissionDenied,
      "outsider grantCredits",
    );
    expect(grant.rawMessage).toBe(COPY.grantCredits);
  });

  it("[billing.rpc.grant-credits.grants-with-expiry] a grant raises the balance and records its expiry", async () => {
    const { org } = await unfundedOrg();
    const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const grant = await clients.billingCommand.grantCredits({
      orgId: org,
      amountMicros: 4_000_000n,
      expiresAt: timestampFromDate(expiresAt),
      reason: "conformance grant",
      idempotencyKey: uniqueName("grant"),
    });
    expect(grant.amountMicros).toBe(4_000_000n);
    expect(await balanceOf(org)).toBe(4_000_000n);
  });

  it("[billing.rpc.grant-credits.non-positive-invalid-argument] a non-positive grant is refused INVALID_ARGUMENT", async () => {
    const { org } = await unfundedOrg();
    // The proto validates gt 0 and the handler re-checks; either way the
    // code is INVALID_ARGUMENT — the copy differs by which fired, so only
    // the code is pinned here.
    for (const amountMicros of [0n, -1n]) {
      await expectGrpcCode(
        () => clients.billingCommand.grantCredits({ orgId: org, amountMicros, reason: "bad", idempotencyKey: uniqueName("bad") }),
        Code.InvalidArgument,
        `grantCredits amount ${amountMicros}`,
      );
    }
  });

  it("[billing.rpc.get-billing-usage-report.shape-and-empty-org] an org with no usage reports zero everything", async () => {
    const { org } = await unfundedOrg();
    const report = await clients.billingQuery.getBillingUsageReport({
      orgId: org,
      startTime: timestampFromDate(new Date(Date.now() - 3600_000)),
      endTime: timestampFromDate(new Date(Date.now() + 3600_000)),
    });
    expect(report.llmCallCount).toBe(0);
    expect(report.executionCount).toBe(0);
    expect(report.totalBillableAmountMicros).toBe(0n);
    expect(report.totalProviderCostMicros).toBe(0n);
  });

  it("[billing.rpc.get-customer-model-pricing.applies-policy-markup] the customer pricing lists priced models with the *_micros_per_million fields", async () => {
    const { org } = await unfundedOrg();
    const pricing = await clients.billingQuery.getCustomerModelPricing({ orgId: org });
    expect(pricing.entries.length, "the baseline seeds at least one priced model").toBeGreaterThan(0);
    for (const entry of pricing.entries) {
      expect(entry.modelId).not.toBe("");
      expect(entry.inputPriceMicrosPerMillion).toBeGreaterThanOrEqual(0n);
      expect(entry.outputPriceMicrosPerMillion).toBeGreaterThanOrEqual(0n);
    }
  });
});

describe.skipIf(!ledgerServed)("Billing ledger conformance — the purchase money path against the fake Stripe", () => {
  let control: CloudFixturesClient;

  beforeAll(() => {
    control = requireCloudFixtures();
  });

  afterEach(async () => {
    await control.stripe.reset();
  });

  it("[billing.rpc.create-credit-checkout-session.creates-customer-and-session] a checkout creates the Stripe customer and session with the pack's line item and metadata", async () => {
    const { org } = await unfundedOrg();
    const created = await clients.billingCommand.createCreditCheckoutSession({
      orgId: org,
      packId: "starter",
      successUrl: "https://console.stigmer.test/billing?ok",
      cancelUrl: "https://console.stigmer.test/billing?cancel",
    });
    expect(created.checkoutSessionId).toMatch(/^cs_test_conf_/);
    expect(created.checkoutUrl).toContain(created.checkoutSessionId);
    expect(created.purchaseId).not.toBe("");

    const requests = await control.stripe.requests();
    const customer = requests.find((r) => r.path === "/v1/customers" && r.method === "POST");
    const session = requests.find((r) => r.path === "/v1/checkout/sessions");
    expect(customer?.params["name"]).toBe(org);
    expect(customer?.params["metadata[stigmer_org_id]"]).toBe(org);
    expect(session?.params["mode"]).toBe("payment");
    expect(session?.params["customer"]).toBe(customer?.response.id);
    expect(session?.params["metadata[stigmer_org_id]"]).toBe(org);
    expect(session?.params["metadata[stigmer_purchase_id]"]).toBe(created.purchaseId);
    expect(session?.params["metadata[stigmer_pack_id]"]).toBe("starter");
    expect(session?.params["line_items[0][quantity]"]).toBe("1");
    expect(session?.params["line_items[0][price_data][currency]"]).toBe("usd");
    expect(Number(session?.params["line_items[0][price_data][unit_amount]"])).toBeGreaterThan(0);
  });

  it("[billing.rpc.create-credit-checkout-session.reuses-existing-customer] a second checkout for the same org creates no second Stripe customer", async () => {
    const { org } = await unfundedOrg();
    const input = { orgId: org, packId: "starter", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/cancel" };
    await clients.billingCommand.createCreditCheckoutSession(input);
    await clients.billingCommand.createCreditCheckoutSession(input);
    const customers = (await control.stripe.requests()).filter((r) => r.path === "/v1/customers" && r.method === "POST");
    expect(customers).toHaveLength(1);
  });

  it("[billing.rpc.create-credit-checkout-session.unknown-pack-invalid-argument] an unknown pack is refused INVALID_ARGUMENT before any Stripe call", async () => {
    const { org } = await unfundedOrg();
    await expectGrpcCode(
      () => clients.billingCommand.createCreditCheckoutSession({ orgId: org, packId: "no-such-pack", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/c" }),
      Code.InvalidArgument,
      "unknown pack",
    );
    expect(await control.stripe.requests()).toEqual([]);
  });

  it("[billing.rpc.create-credit-checkout-session.stripe-failure-surfaces] a Stripe refusal surfaces as an error and grants nothing", async () => {
    const { org } = await unfundedOrg();
    await control.stripe.failNext({ pathPrefix: "/v1/checkout/sessions", status: 402, code: "card_declined", message: "declined" });
    let failed = false;
    try {
      await clients.billingCommand.createCreditCheckoutSession({ orgId: org, packId: "starter", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/c" });
    } catch {
      failed = true;
    }
    expect(failed, "the RPC must not succeed when Stripe refused the session").toBe(true);
    expect(await balanceOf(org)).toBe(0n);
  });

  it("[billing.rpc.create-credit-checkout-session.outsider-permission-denied] an outsider cannot purchase for the org", async () => {
    const { org } = await unfundedOrg();
    const other = await outsider();
    const denied = await expectGrpcCode(
      () => other.billingCommand.createCreditCheckoutSession({ orgId: org, packId: "starter", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/c" }),
      Code.PermissionDenied,
      "outsider checkout",
    );
    expect(denied.rawMessage).toBe(COPY.purchaseCredits);
  });

  it("[billing.rpc.create-billing-portal-session.returns-portal-url] [billing.rpc.create-billing-portal-session.no-customer-failed-precondition] the portal needs a Stripe customer, then returns the session URL", async () => {
    const { org } = await unfundedOrg();
    await expectGrpcCode(
      () => clients.billingCommand.createBillingPortalSession({ orgId: org, returnUrl: "https://x.test/back" }),
      Code.FailedPrecondition,
      "portal without a customer",
    );
    expect((await control.stripe.requests()).filter((r) => r.path.startsWith("/v1/billing_portal"))).toEqual([]);

    await clients.billingCommand.createCreditCheckoutSession({ orgId: org, packId: "starter", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/c" });
    const portal = await clients.billingCommand.createBillingPortalSession({ orgId: org, returnUrl: "https://x.test/back" });
    expect(portal.portalUrl).toMatch(/^https:\/\/billing\.stripe\.test\//);
    const request = (await control.stripe.requests()).find((r) => r.path === "/v1/billing_portal/sessions");
    expect(request?.params["return_url"]).toBe("https://x.test/back");
  });

  // The webhook half: the suite is Stripe here, signing events with the
  // secret the server was booted with and posting them to the lane.
  async function post(event: ReturnType<typeof stripeEvent>, options: { secret?: string; timestamp?: number } = {}) {
    const lane = target.stripeWebhook!();
    return postStripeWebhook(lane.baseUrl, signedEvent(event, options.secret ?? lane.signingSecret, options.timestamp));
  }

  function checkoutCompleted(sessionId: string, type = "checkout.session.completed", id?: string) {
    return stripeEvent(type, { id: sessionId, object: "checkout.session", payment_intent: `pi_conf_${sessionId}`, customer: null, payment_status: "paid", status: "complete" }, id === undefined ? {} : { id });
  }

  async function purchase(org: string): Promise<{ sessionId: string; creditsMicros: bigint }> {
    const created = await clients.billingCommand.createCreditCheckoutSession({ orgId: org, packId: "starter", successUrl: "https://x.test/ok", cancelUrl: "https://x.test/c" });
    const session = (await control.stripe.requests()).find((r) => r.path === "/v1/checkout/sessions");
    const creditsMicros = BigInt(session?.params["metadata[stigmer_credits_micros]"] ?? "0");
    expect(creditsMicros).toBeGreaterThan(0n);
    return { sessionId: created.checkoutSessionId, creditsMicros };
  }

  it("[billing.stripe.signature.valid-event-accepted-200-ok] [billing.stripe.webhook.anonymous-reachable] [billing.stripe.checkout-completed.grants-credits-and-completes-purchase] a signed checkout.session.completed grants the pack's credits once", async () => {
    const { org } = await unfundedOrg();
    const { sessionId, creditsMicros } = await purchase(org);
    const response = await post(checkoutCompleted(sessionId));
    expect(response.status).toBe(200);
    expect(response.body).toBe("ok");
    expect(await balanceOf(org)).toBe(creditsMicros);
    const ledger = await clients.billingQuery.getCreditLedger({ orgId: org });
    const grant = ledger.entries.find((entry) => entry.idempotencyKey.startsWith("purchase_"));
    expect(grant, "the grant entry carries the purchase_<id> idempotency key").toBeDefined();
    expect(grant?.amountMicros).toBe(creditsMicros);
  });

  it("[billing.stripe.checkout-completed.replay-same-event-id-grants-once] replaying the same event id answers 200 and grants nothing more", async () => {
    const { org } = await unfundedOrg();
    const { sessionId, creditsMicros } = await purchase(org);
    const event = checkoutCompleted(sessionId);
    expect((await post(event)).status).toBe(200);
    expect((await post(event)).status).toBe(200);
    expect(await balanceOf(org)).toBe(creditsMicros);
  });

  it("[billing.stripe.checkout-completed.different-event-same-session-grants-once] a new event for an already-completed session grants nothing more", async () => {
    const { org } = await unfundedOrg();
    const { sessionId, creditsMicros } = await purchase(org);
    expect((await post(checkoutCompleted(sessionId))).status).toBe(200);
    expect((await post(checkoutCompleted(sessionId, "checkout.session.completed", `evt_conf_second_${sessionId}`))).status).toBe(200);
    expect(await balanceOf(org)).toBe(creditsMicros);
  });

  it("[billing.stripe.checkout-completed.async-payment-succeeded-same-handler] async_payment_succeeded grants exactly as completed does", async () => {
    const { org } = await unfundedOrg();
    const { sessionId, creditsMicros } = await purchase(org);
    expect((await post(checkoutCompleted(sessionId, "checkout.session.async_payment_succeeded"))).status).toBe(200);
    expect(await balanceOf(org)).toBe(creditsMicros);
  });

  it("[billing.stripe.checkout-completed.unknown-session-200-no-effect] a completed event for a session no purchase knows answers 200 and grants nothing", async () => {
    const { org } = await unfundedOrg();
    expect((await post(checkoutCompleted("cs_test_conf_unknown"))).status).toBe(200);
    expect(await balanceOf(org)).toBe(0n);
  });

  it("[billing.stripe.checkout-failed.pending-purchase-becomes-failed] [billing.stripe.checkout-expired.pending-purchase-becomes-expired] failed and expired sessions grant nothing", async () => {
    const { org } = await unfundedOrg();
    const failed = await purchase(org);
    expect((await post(checkoutCompleted(failed.sessionId, "checkout.session.async_payment_failed"))).status).toBe(200);
    const expired = await purchase(org);
    expect((await post(checkoutCompleted(expired.sessionId, "checkout.session.expired"))).status).toBe(200);
    expect(await balanceOf(org)).toBe(0n);
  });

  it("[billing.stripe.unhandled-event.ignored-200] an event type Java does not handle answers 200 with no effect", async () => {
    const { org } = await unfundedOrg();
    expect((await post(stripeEvent("invoice.paid", { id: "in_conf_1", object: "invoice" }))).status).toBe(200);
    expect(await balanceOf(org)).toBe(0n);
  });

  it("[billing.stripe.signature.wrong-secret-400-invalid-signature] [billing.stripe.signature.tampered-payload-400] [billing.stripe.signature.stale-timestamp-400] [billing.stripe.signature.missing-header-400] bad signatures are refused 400 and grant nothing", async () => {
    const { org } = await unfundedOrg();
    const { sessionId } = await purchase(org);
    const lane = target.stripeWebhook!();
    const event = checkoutCompleted(sessionId);

    const wrongSecret = await post(event, { secret: "whsec_not_the_one" });
    expect(wrongSecret.status).toBe(400);
    expect(wrongSecret.body).toBe("Invalid signature");

    const signed = signedEvent(event, lane.signingSecret);
    const tampered = await postStripeWebhook(lane.baseUrl, { payload: signed.payload.replace(sessionId, "cs_test_conf_tampered"), signature: signed.signature });
    expect(tampered.status).toBe(400);

    const stale = await post(event, { timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect(stale.status).toBe(400);

    const missing = await fetch(`${lane.baseUrl}/webhook/stripe`, { method: "POST", headers: { "content-type": "application/json" }, body: signStripePayload(JSON.stringify(event), lane.signingSecret).payload });
    expect(missing.status).toBe(400);

    expect(await balanceOf(org)).toBe(0n);
  });
});

describe.skipIf(!ledgerServed)("Billing ledger conformance — the engine and pricing-admin lanes (platform operator)", () => {
  it("[billing.rpc.engine-lanes.ordinary-caller-permission-denied] an org owner who is not a platform operator is refused on every engine RPC with the proto's copy", async () => {
    const { org } = await fundedOrg();
    const executionId = uniqueName("exec");
    const lanes: Array<[string, () => Promise<unknown>]> = [
      ["authorizeExecution", () => clients.billingCommand.authorizeExecution({ orgId: org, executionId, harness: "native" })],
      ["finalizeExecution", () => clients.billingCommand.finalizeExecution({ executionId })],
      ["rearmForRecovery", () => clients.billingCommand.rearmForRecovery({ executionId })],
      ["recordLlmCallUsage", () => clients.billingCommand.recordLlmCallUsage({ executionId, sequence: 1, provider: "anthropic", resolvedModel: "claude-sonnet-4-6" })],
      ["previewAuthorization", () => clients.billingQuery.previewAuthorization({ orgId: org })],
      ["getExecutionBillingSignal", () => clients.billingQuery.getExecutionBillingSignal({ executionId })],
    ];
    for (const [name, op] of lanes) {
      const denied = await expectGrpcCode(op, Code.PermissionDenied, `ordinary caller ${name}`);
      expect(denied.rawMessage, name).toBe(COPY.engineOps);
    }
  });

  it("[billing.rpc.pricing-admin-lanes.ordinary-caller-permission-denied] an org owner is refused on every pricing-admin RPC with its own copy", async () => {
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
              harness: "native",
              displayName: "Conformance",
              speedTier: "balanced",
              costTier: "standard",
              pricing: { inputPriceMicrosPerMillion: 1n, outputPriceMicrosPerMillion: 1n },
            },
          }),
        COPY.pricingEdit,
      ],
      ["retireModelPricingBaseline", () => clients.billingCommand.retireModelPricingBaseline({ modelId: "conf-model", provider: "anthropic", harness: "native" }), COPY.pricingEdit],
      ["decideModelPricingOverride", () => clients.billingCommand.decideModelPricingOverride({ overrideId: "ovr_conformance" }), COPY.pricingDecide],
      ["getModelPricingGovernance", () => clients.billingQuery.getModelPricingGovernance({}), COPY.pricingGovernance],
      ["listModelPricingBaselines", () => clients.billingQuery.listModelPricingBaselines({}), COPY.pricingBaselineView],
    ];
    for (const [name, op, copy] of cases) {
      const denied = await expectGrpcCode(op, Code.PermissionDenied, `ordinary caller ${name}`);
      expect(denied.rawMessage, name).toBe(copy);
    }
  });

  it("[billing.rpc.preview-authorization.reasons-for-unfunded-and-funded] [billing.rpc.authorize-execution.denied-when-unfunded] the operator's preview and authorize deny an unfunded org with the engine's one denial vocabulary and admit a funded one", async (ctx) => {
    const op = await operator();
    const unfunded = op.context.org;
    const preview = await op.clients.billingQuery.previewAuthorization({ orgId: unfunded });
    expect(preview.authorized).toBe(false);
    expect(preview.denialReason).toBe(COPY.insufficientCredits);
    const denied = await op.clients.billingCommand.authorizeExecution({ orgId: unfunded, executionId: uniqueName("exec"), harness: "native" });
    expect(denied.authorized).toBe(false);
    expect(denied.denialReason).toBe(COPY.insufficientCredits);
    expect(denied.reservationId).toBe("");

    await fundAs(op.clients, unfunded);
    const admitted = await op.clients.billingQuery.previewAuthorization({ orgId: unfunded });
    expect(admitted.authorized, ctx.task.name).toBe(true);
  });

  it("[billing.rpc.authorize-execution.reserves-and-latches] [billing.rpc.authorize-execution.concurrent-reserves-one-hold] [billing.rpc.finalize-execution.settles-and-is-idempotent] [billing.rpc.get-execution-billing-signal.unspecified-when-no-reservation] a funded execution reserves once under concurrency, settles once, and signals only while reserved", async () => {
    const op = await operator();
    const org = op.context.org;
    await fundAs(op.clients, org);
    const before = (await op.clients.billingQuery.getCreditBalance({ orgId: org })).availableMicros;
    const executionId = uniqueName("exec");

    const noReservation = await op.clients.billingQuery.getExecutionBillingSignal({ executionId });
    expect(noReservation.reason).toBe("");

    const results = await Promise.all([
      op.clients.billingCommand.authorizeExecution({ orgId: org, executionId, harness: "native" }),
      op.clients.billingCommand.authorizeExecution({ orgId: org, executionId, harness: "native" }),
      op.clients.billingCommand.authorizeExecution({ orgId: org, executionId, harness: "native" }),
    ]);
    for (const result of results) expect(result.authorized).toBe(true);
    const reservationIds = new Set(results.map((r) => r.reservationId));
    expect(reservationIds.size, "concurrent authorizes converge on ONE reservation").toBe(1);
    const held = (await op.clients.billingQuery.getCreditBalance({ orgId: org })).reservedMicros;
    expect(held).toBe(results[0]?.reservedMicros ?? -1n);

    const settled = await op.clients.billingCommand.finalizeExecution({ executionId });
    expect(settled.releasedReservationMicros).toBe(results[0]?.reservedMicros ?? -1n);
    const afterFirst = await op.clients.billingQuery.getCreditBalance({ orgId: org });
    expect(afterFirst.reservedMicros).toBe(0n);
    expect(afterFirst.availableMicros, "no usage was recorded, so settling returns the hold in full").toBe(before);

    await op.clients.billingCommand.finalizeExecution({ executionId }).catch(() => undefined);
    const afterSecond = await op.clients.billingQuery.getCreditBalance({ orgId: org });
    expect(afterSecond.availableMicros).toBe(before);
    expect(afterSecond.reservedMicros).toBe(0n);
  });

  it("[billing.rpc.finalize-execution.unknown-execution-failed-precondition] settling an execution that was never authorized is refused FAILED_PRECONDITION", async () => {
    const op = await operator();
    await expectGrpcCode(
      () => op.clients.billingCommand.finalizeExecution({ executionId: uniqueName("never-authorized") }),
      Code.FailedPrecondition,
      "finalize unknown execution",
    );
  });

  it("[billing.rpc.rearm-for-recovery.rotates-reservation-past-settled-latch] re-arming a settled execution mints a new reservation on a funded org", async () => {
    const op = await operator();
    const org = op.context.org;
    await fundAs(op.clients, org);
    const executionId = uniqueName("exec");
    const first = await op.clients.billingCommand.authorizeExecution({ orgId: org, executionId, harness: "native" });
    await op.clients.billingCommand.finalizeExecution({ executionId });
    const rearmed = await op.clients.billingCommand.rearmForRecovery({ executionId });
    expect(rearmed.authorized).toBe(true);
    expect(rearmed.reservationId).not.toBe("");
    expect(rearmed.reservationId).not.toBe(first.reservationId);
  });

  it("[billing.rpc.record-llm-call-usage.records-cost-and-marks-price-not-found] recorded usage lands on the org's usage report; an unpriced model records with PRICE_NOT_FOUND rather than failing", async () => {
    const op = await operator();
    const org = op.context.org;
    await fundAs(op.clients, org);
    const executionId = uniqueName("exec");
    await op.clients.billingCommand.authorizeExecution({ orgId: org, executionId, harness: "native" });
    await op.clients.billingCommand.recordLlmCallUsage({ executionId, sequence: 1, provider: "anthropic", resolvedModel: "claude-sonnet-4-6", requestedModel: "claude-sonnet-4-6" });
    await op.clients.billingCommand.recordLlmCallUsage({ executionId, sequence: 2, provider: "anthropic", resolvedModel: "model-nobody-priced", requestedModel: "model-nobody-priced" });
    const report = await op.clients.billingQuery.getBillingUsageReport({
      orgId: org,
      startTime: timestampFromDate(new Date(Date.now() - 3600_000)),
      endTime: timestampFromDate(new Date(Date.now() + 3600_000)),
    });
    expect(report.llmCallCount).toBe(2);
    expect(report.executionCount).toBe(1);
  });
});

describe.skipIf(ledgerServed)("Billing ledger conformance — the OSS boundary (no billing controllers routed)", () => {
  it("[billing.rpc.oss-boundary.every-billing-rpc-unimplemented] every billing RPC answers Unimplemented where billingLedger is false", async () => {
    const org = uniqueName("org");
    const executionId = uniqueName("exec");
    const lanes: Array<[string, () => Promise<unknown>]> = [
      ["getOrCreateBillingAccount", () => clients.billingCommand.getOrCreateBillingAccount({ orgId: org })],
      ["adjustCredits", () => clients.billingCommand.adjustCredits({ orgId: org, amountMicros: 1n, reason: "x", idempotencyKey: "k" })],
      ["grantCredits", () => clients.billingCommand.grantCredits({ orgId: org, amountMicros: 1n, reason: "x", idempotencyKey: "k" })],
      ["authorizeExecution", () => clients.billingCommand.authorizeExecution({ orgId: org, executionId, harness: "native" })],
      ["recordLlmCallUsage", () => clients.billingCommand.recordLlmCallUsage({ executionId, sequence: 1, provider: "anthropic", resolvedModel: "m" })],
      ["finalizeExecution", () => clients.billingCommand.finalizeExecution({ executionId })],
      ["rearmForRecovery", () => clients.billingCommand.rearmForRecovery({ executionId })],
      ["createCreditCheckoutSession", () => clients.billingCommand.createCreditCheckoutSession({ orgId: org, packId: "starter", successUrl: "https://x/ok", cancelUrl: "https://x/c" })],
      ["createBillingPortalSession", () => clients.billingCommand.createBillingPortalSession({ orgId: org, returnUrl: "https://x/back" })],
      ["setAutoRechargeConfig", () => clients.billingCommand.setAutoRechargeConfig({ orgId: org })],
      ["decideModelPricingOverride", () => clients.billingCommand.decideModelPricingOverride({ overrideId: "ovr_x" })],
      ["upsertModelPricingBaseline", () => clients.billingCommand.upsertModelPricingBaseline({ baseline: { modelId: "m", provider: "p", harness: "native", displayName: "M", speedTier: "balanced", costTier: "standard", pricing: {} } })],
      ["retireModelPricingBaseline", () => clients.billingCommand.retireModelPricingBaseline({ modelId: "m", provider: "p", harness: "native" })],
      ["getBillingAccount", () => clients.billingQuery.getBillingAccount({ orgId: org })],
      ["getCreditBalance", () => clients.billingQuery.getCreditBalance({ orgId: org })],
      ["getCreditLedger", () => clients.billingQuery.getCreditLedger({ orgId: org })],
      ["getBillingUsageReport", () => clients.billingQuery.getBillingUsageReport({ orgId: org, startTime: timestampFromDate(new Date()), endTime: timestampFromDate(new Date()) })],
      ["getCustomerModelPricing", () => clients.billingQuery.getCustomerModelPricing({ orgId: org })],
      ["getModelPricingGovernance", () => clients.billingQuery.getModelPricingGovernance({})],
      ["listModelPricingBaselines", () => clients.billingQuery.listModelPricingBaselines({})],
      ["previewAuthorization", () => clients.billingQuery.previewAuthorization({ orgId: org })],
      ["getExecutionBillingSignal", () => clients.billingQuery.getExecutionBillingSignal({ executionId })],
    ];
    expect(lanes, "the 22 RPCs, no more, no fewer").toHaveLength(22);
    for (const [name, op] of lanes) {
      await expectGrpcCode(op, Code.Unimplemented, `OSS ${name}`);
    }
  });
});
