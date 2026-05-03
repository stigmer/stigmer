/**
 * Connect-RPC client for billing usage reporting.
 *
 * Reports per-turn usage to the billing service after each Cursor SDK
 * turn-ended event. The billing service applies markup, debits credits,
 * and returns a signal directing the runner's next action.
 *
 * Follows the same transport/auth pattern as StigmerClient.
 */

import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { BillingCommandController } from "@stigmer/protos/ai/stigmer/billing/v1/command_pb";
import {
  ReportLlmCallUsageInputSchema,
  type ReportLlmCallUsageResponse,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { ExecutionBillingSignal } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";

export interface BillingUsageReport {
  signal: ExecutionBillingSignal;
  balanceAfterMicros: bigint;
  billableAmountMicros: bigint;
}

/**
 * Reports per-turn LLM usage to the billing service.
 *
 * Constructed once per execution with the execution context (ID, harness).
 * Each turn calls reportUsage() which fires the gRPC and returns the signal.
 *
 * Graceful degradation: if the RPC fails, returns null and the execution
 * continues. The reservation caps financial exposure.
 */
export class BillingClient {
  private readonly client: Client<typeof BillingCommandController>;
  private readonly executionId: string;
  private readonly harness: string;
  private sequence = 0;

  constructor(transport: Transport, executionId: string, harness: string = "cursor") {
    this.client = createClient(BillingCommandController, transport);
    this.executionId = executionId;
    this.harness = harness;
  }

  /**
   * Report a single turn's usage to the billing service.
   *
   * @returns Billing signal (continue/warning/stop) or null on RPC failure
   */
  async reportUsage(params: {
    model: string;
    costTier: string;
    providerCostMicros: number;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }): Promise<BillingUsageReport | null> {
    this.sequence++;

    const input = create(ReportLlmCallUsageInputSchema, {
      executionId: this.executionId,
      sequence: this.sequence,
      model: params.model,
      harness: this.harness,
      costTier: params.costTier,
      providerCostMicros: BigInt(params.providerCostMicros),
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cacheCreationTokens: params.cacheCreationTokens,
      cacheReadTokens: params.cacheReadTokens,
    });

    try {
      const response: ReportLlmCallUsageResponse = await this.client.reportLlmCallUsage(input);

      const result: BillingUsageReport = {
        signal: response.signal,
        balanceAfterMicros: response.balanceAfterMicros,
        billableAmountMicros: response.billableAmountMicros,
      };

      if (result.signal === ExecutionBillingSignal.stop_execution) {
        console.warn(
          "[BILLING] STOP signal: execution=%s seq=%d balance=%s billable=%s",
          this.executionId, this.sequence,
          result.balanceAfterMicros.toString(),
          result.billableAmountMicros.toString(),
        );
      } else if (result.signal === ExecutionBillingSignal.low_balance_warning) {
        console.warn(
          "[BILLING] LOW_BALANCE warning: execution=%s seq=%d balance=%s",
          this.executionId, this.sequence,
          result.balanceAfterMicros.toString(),
        );
      }

      return result;

    } catch (err) {
      console.error(
        "[BILLING] RPC failed (graceful degradation): execution=%s seq=%d error=%s",
        this.executionId, this.sequence,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  /**
   * Check if a billing report indicates the execution must stop.
   */
  static shouldStop(report: BillingUsageReport | null): boolean {
    return report?.signal === ExecutionBillingSignal.stop_execution;
  }
}
