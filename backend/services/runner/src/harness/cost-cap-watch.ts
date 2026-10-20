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

import type { ServiceTier, ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { costCapExceeded } from "../shared/cost-guard.js";
import type { TurnInput, UsageDelta } from "./types.js";
import { UsageAccumulator } from "./usage-accumulator.js";

/**
 * Whether this invocation's count continues the run's: a turn the runtime
 * continues after an interruption (`TurnInput.continuation`) carries what the
 * run already spent, so neither a deploy nor a recovered stall resets the
 * cap. A run resuming after an approval starts a fresh count, as
 * `max_cost_usd`'s contract states (`invocation.proto`); an approval resume
 * is told by the decisions it carries.
 */
export function continuesTheRunsCount(input: Pick<TurnInput, "continuation" | "approvalDecisions">): boolean {
  return input.continuation !== undefined && input.approvalDecisions.size === 0;
}

/**
 * The watch a turn starts with, on the run's cap, seeded from the run's
 * summary so far when its count continues ({@link continuesTheRunsCount}).
 * The one construction the runtime and the agent host share, so the host's
 * early stop and the runtime's terminal read the same count.
 */
export function costCapWatchFor(input: Pick<TurnInput, "continuation" | "approvalDecisions" | "execution" | "model">): CostCapWatch {
  const watch = new CostCapWatch(input.execution.status?.runConfig?.maxCostUsd ?? 0, input.model.serviceTier, input.model.thinkingMode);
  const summary = input.execution.status?.streamingUsage;
  if (summary !== undefined && continuesTheRunsCount(input)) watch.accumulator.seed(summary);
  return watch;
}

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
    return this.reached();
  }

  /** Add a runtime call's cost (`UsageAccumulator.addAuxiliaryCost`). True exactly once, as {@link add}. */
  addAuxiliary(costUsd: number): boolean {
    this.accumulator.addAuxiliaryCost(costUsd);
    return this.reached();
  }

  private reached(): boolean {
    if (this.crossed || !costCapExceeded(this.maxCostUsd, this.accumulator.snapshot().estimatedCostUsd)) return false;
    this.crossed = true;
    return true;
  }
}
