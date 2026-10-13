// Wire-shape tests for BillingClient: a router transport fakes the billing
// services in-process, captures the outgoing request messages, and the tests
// assert the SDK params mapped onto the right proto fields. This mirrors
// sdk/java's BillingClientTest and sdk/go's billing_test.go — the reference
// pattern for testing the handwritten (non-resource) clients.
import { describe, expect, it } from "vitest";
import { createRouterTransport, type Transport } from "@connectrpc/connect";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import { BillingClient } from "../billing.js";

describe("BillingClient's organization-scoped calls name the organization as org", () => {
  /** The last request each organization-scoped method received, keyed by method. */
  function capturingTransport(seen: Map<string, { readonly org: string }>): Transport {
    return createRouterTransport(({ service }) => {
      service(BillingCommandController, {
        getOrCreateBillingAccount: (req) => (seen.set("getOrCreateBillingAccount", req), {}),
        createBillingPortalSession: (req) => (seen.set("createBillingPortalSession", req), {}),
        createPaymentMethodSetupSession: (req) => (seen.set("createPaymentMethodSetupSession", req), {}),
      });
      service(BillingQueryController, {
        getBillingAccount: (req) => (seen.set("getBillingAccount", req), {}),
      });
    });
  }

  const calls: ReadonlyArray<readonly [string, (client: BillingClient) => Promise<unknown>]> = [
    ["getOrCreateBillingAccount", (c) => c.getOrCreateBillingAccount("acme")],
    ["getBillingAccount", (c) => c.getBillingAccount("acme")],
    ["createBillingPortalSession", (c) => c.createBillingPortalSession({ org: "acme", returnUrl: "https://back" })],
    [
      "createPaymentMethodSetupSession",
      (c) => c.createPaymentMethodSetupSession({ org: "acme", successUrl: "https://ok", cancelUrl: "https://no" }),
    ],
  ];

  it.each(calls)("%s sends org", async (method, call) => {
    const seen = new Map<string, { readonly org: string }>();
    await call(new BillingClient(capturingTransport(seen)));
    expect(seen.get(method)?.org).toBe("acme");
  });
});
