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
  CreditLedgerResponseSchema,
  type AdjustCreditsInput,
  type GetCreditLedgerInput,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { CreditLedgerEntrySchema } from "@stigmer/protos/ai/stigmer/billing/v1/credit_pb";
import { LedgerEntryType, LedgerView } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import { BillingClient } from "../billing.js";

interface Captured {
  adjustCredits?: AdjustCreditsInput;
  getCreditLedger?: GetCreditLedgerInput;
}

function fakeTransport(captured: Captured): Transport {
  return createRouterTransport(({ service }) => {
    service(BillingCommandController, {
      adjustCredits: (req) => {
        captured.adjustCredits = req;
        return create(CreditLedgerEntrySchema, { amountMicros: req.amountMicros });
      },
    });
    service(BillingQueryController, {
      getCreditLedger: (req) => {
        captured.getCreditLedger = req;
        return create(CreditLedgerResponseSchema, {});
      },
    });
  });
}

describe("BillingClient.adjustCredits", () => {
  it("maps params onto AdjustCreditsInput and returns the ledger entry", async () => {
    const captured: Captured = {};
    const client = new BillingClient(fakeTransport(captured));

    const entry = await client.adjustCredits({
      orgId: "acme",
      amountMicros: 25_000_000n,
      reason: "initial tenant funding",
      idempotencyKey: "fund-acme-001",
    });

    expect(entry.amountMicros).toBe(25_000_000n);
    expect(captured.adjustCredits?.orgId).toBe("acme");
    expect(captured.adjustCredits?.amountMicros).toBe(25_000_000n);
    expect(captured.adjustCredits?.reason).toBe("initial tenant funding");
    expect(captured.adjustCredits?.idempotencyKey).toBe("fund-acme-001");
  });
});

describe("BillingClient.getCreditLedger", () => {
  it("maps all filters including the time range", async () => {
    const captured: Captured = {};
    const client = new BillingClient(fakeTransport(captured));

    const startTime = new Date("2026-08-01T00:00:00Z");
    const endTime = new Date("2026-08-13T00:00:00Z");
    await client.getCreditLedger({
      orgId: "acme",
      page: { num: 2, size: 50 },
      typeFilter: [LedgerEntryType.adjustment_credit],
      startTime,
      endTime,
      view: LedgerView.statement,
    });

    const req = captured.getCreditLedger;
    expect(req?.orgId).toBe("acme");
    expect(req?.page?.num).toBe(2);
    expect(req?.page?.size).toBe(50);
    expect(req?.typeFilter).toEqual([LedgerEntryType.adjustment_credit]);
    expect(req?.startTime && timestampDate(req.startTime)).toEqual(startTime);
    expect(req?.endTime && timestampDate(req.endTime)).toEqual(endTime);
    expect(req?.view).toBe(LedgerView.statement);
  });

  it("omits unset optional filters", async () => {
    const captured: Captured = {};
    const client = new BillingClient(fakeTransport(captured));

    await client.getCreditLedger({ orgId: "acme" });

    const req = captured.getCreditLedger;
    expect(req?.page).toBeUndefined();
    expect(req?.startTime).toBeUndefined();
    expect(req?.endTime).toBeUndefined();
    expect(req?.typeFilter).toEqual([]);
    expect(req?.view).toBe(LedgerView.unspecified);
  });
});
