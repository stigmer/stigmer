// Wire-shape tests for BillingClient: a router transport fakes the billing
// services in-process, captures the outgoing request messages, and the tests
// assert the SDK params mapped onto the right proto fields. This mirrors
// sdk/java's BillingClientTest and sdk/go's billing_test.go — the reference
// pattern for testing the handwritten (non-resource) clients.
import { describe, expect, it } from "vitest";
import { createRouterTransport, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import {
  BillingUsageReportResponseSchema,
  type GetBillingUsageReportInput,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { BillingClient } from "../billing.js";

describe("BillingClient.getBillingUsageReport", () => {
  it("maps the time range onto GetBillingUsageReportInput and returns the counts", async () => {
    let captured: GetBillingUsageReportInput | undefined;
    const transport = createRouterTransport(({ service }) => {
      service(BillingQueryController, {
        getBillingUsageReport: (req) => {
          captured = req;
          return create(BillingUsageReportResponseSchema, { runCount: 3, llmCallCount: 12 });
        },
      });
    });
    const client = new BillingClient(transport);

    const startTime = new Date("2026-08-01T00:00:00Z");
    const endTime = new Date("2026-08-13T00:00:00Z");
    const report = await client.getBillingUsageReport({ org: "acme", startTime, endTime });

    expect(report.runCount).toBe(3);
    expect(report.llmCallCount).toBe(12);
    expect(captured?.org).toBe("acme");
    expect(captured?.startTime && timestampDate(captured.startTime)).toEqual(startTime);
    expect(captured?.endTime && timestampDate(captured.endTime)).toEqual(endTime);
  });
});

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
        getBillingUsageReport: (req) => (seen.set("getBillingUsageReport", req), {}),
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
    [
      "getBillingUsageReport",
      (c) => c.getBillingUsageReport({ org: "acme", startTime: new Date(0), endTime: new Date(1000) }),
    ],
  ];

  it.each(calls)("%s sends org", async (method, call) => {
    const seen = new Map<string, { readonly org: string }>();
    await call(new BillingClient(capturingTransport(seen)));
    expect(seen.get(method)?.org).toBe("acme");
  });
});
