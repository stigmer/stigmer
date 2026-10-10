/**
 * One turn's usage against its cost cap: the accumulator the runtime
 * prices `streamingUsage` from, and the moment a reported delta reaches
 * `max_cost_usd` (`shared/cost-guard.ts` is the rule).
 *
 * The runtime enforces the cap (`run-turn.ts`): on the crossing delta it
 * stops the turn and later settles `costCapArm`. The agent host
 * (`agent-host/host-sink.ts`) applies the same watch to the same deltas,
 * before they cross the pipe, so the adapter's stop signal aborts inside
 * `reportUsage`, the instant it does when the adapter runs in the runner's
 * own process; the engine then stops at its next step boundary, not a step
 * later. What the turn's terminal says is still the runtime's own watch's
 * evidence alone.
 */

import type { ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { costCapExceeded } from "../shared/cost-guard.js";
import type { UsageDelta } from "./types.js";
import { UsageAccumulator } from "./usage-accumulator.js";

export class CostCapWatch {
  readonly accumulator: UsageAccumulator;
  private crossed = false;

  constructor(
    /** `status.runConfig.maxCostUsd`; 0 or less is no cap. */
    readonly maxCostUsd: number,
    serviceTier: ServiceTier,
    thinkingMode: ThinkingMode,
  ) {
    this.accumulator = new UsageAccumulator(serviceTier, thinkingMode);
  }

  /** Add one delta. True exactly once: on the delta that reaches the cap. */
  add(delta: UsageDelta): boolean {
    this.accumulator.addTurn(delta);
    if (this.crossed || !costCapExceeded(this.maxCostUsd, this.accumulator.snapshot().estimatedCostUsd)) return false;
    this.crossed = true;
    return true;
  }
}
