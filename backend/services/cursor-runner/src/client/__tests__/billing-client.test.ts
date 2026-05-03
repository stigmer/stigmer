/**
 * Tests for BillingClient — billing usage reporting for cursor-runner.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BillingClient } from "../billing-client.js";
import { ExecutionBillingSignal } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";

describe("BillingClient", () => {
  let mockTransport: any;
  let billingClient: BillingClient;

  beforeEach(() => {
    mockTransport = {};
    billingClient = new BillingClient(mockTransport, "exec-test-001", "cursor");
  });

  describe("shouldStop", () => {
    it("returns true for stop_execution signal", () => {
      const report = {
        signal: ExecutionBillingSignal.stop_execution,
        balanceAfterMicros: 0n,
        billableAmountMicros: 50000n,
      };
      expect(BillingClient.shouldStop(report)).toBe(true);
    });

    it("returns false for continue signal", () => {
      const report = {
        signal: ExecutionBillingSignal.continue_execution,
        balanceAfterMicros: 9000000n,
        billableAmountMicros: 50000n,
      };
      expect(BillingClient.shouldStop(report)).toBe(false);
    });

    it("returns false for null report (RPC failure)", () => {
      expect(BillingClient.shouldStop(null)).toBe(false);
    });
  });

  describe("sequence counter", () => {
    it("increments on each reportUsage call", async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        signal: ExecutionBillingSignal.continue_execution,
        balanceAfterMicros: 9000000n,
        billableAmountMicros: 50000n,
      });
      (billingClient as any).client = { reportLlmCallUsage: mockRpc };

      await billingClient.reportUsage({
        model: "composer-2", costTier: "standard",
        providerCostMicros: 50000, inputTokens: 1000,
        outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0,
      });
      await billingClient.reportUsage({
        model: "composer-2", costTier: "standard",
        providerCostMicros: 60000, inputTokens: 1200,
        outputTokens: 250, cacheCreationTokens: 0, cacheReadTokens: 100,
      });

      expect(mockRpc.mock.calls[0][0].sequence).toBe(1);
      expect(mockRpc.mock.calls[1][0].sequence).toBe(2);
    });
  });

  describe("graceful degradation", () => {
    it("returns null on RPC error", async () => {
      (billingClient as any).client = {
        reportLlmCallUsage: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };
      const result = await billingClient.reportUsage({
        model: "composer-2", costTier: "standard",
        providerCostMicros: 50000, inputTokens: 1000,
        outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 0,
      });
      expect(result).toBeNull();
    });
  });
});
