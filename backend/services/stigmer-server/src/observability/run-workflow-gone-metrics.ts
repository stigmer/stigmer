/**
 * The count of runs the server ended because their workflow was gone,
 * `stigmer.run.workflow_gone` (domain/run/workflow-gone.ts).
 *
 * A run ends this way when the engine no longer holds a live workflow for
 * it: the server crashed between saving a turn and starting its workflow,
 * or the engine lost or closed the workflow without the run hearing. The
 * person sees the turn end as the platform's fault; this counter is the
 * operator's one sign, beside the log line, that the engine is losing
 * workflows (stigmer#3120). Its attributes say how and never whose:
 *
 *   - `phase`: the phase the run left (`pending`, `in_progress`,
 *     `waiting_for_approval`);
 *   - `found`: what the engine answered, `closed` (it holds the workflow,
 *     ended) or `not_found` (it holds none).
 *
 * No run, session or organization is an attribute: they are unbounded and
 * they would put one tenant's turns on every dashboard.
 *
 * runner-work-queue-metrics.ts's idiom: the counter created lazily on the
 * global meter on `@opentelemetry/api` alone, a no-op until a host
 * registers a provider, and born at zero at boot.
 */
import type { Counter } from "@opentelemetry/api";

const METER_NAME = "stigmer-server";

/** What the engine answered for a run whose workflow is gone. */
export type WorkflowGoneFound = "closed" | "not_found";

export interface RunWorkflowGone {
  /** The phase the run left, as its enum name without the `RUN_` prefix, lower-cased. */
  readonly phase: string;
  readonly found: WorkflowGoneFound;
}

let counterPromise: Promise<Counter> | null = null;

function counter(): Promise<Counter> {
  counterPromise ??= import("@opentelemetry/api").then((api) =>
    api.metrics
      .getMeter(METER_NAME)
      .createCounter("stigmer.run.workflow_gone", {
        description:
          "Runs the Stigmer server ended because the engine held no live workflow for them",
      }),
  );
  return counterPromise;
}

/** Fire-and-forget: the write never awaits instrument resolution. */
export function recordRunWorkflowGone(ended: RunWorkflowGone): void {
  void counter().then((instrument) => {
    instrument.add(1, { phase: ended.phase, found: ended.found });
  });
}

/** Births the series at zero, attribute-less, before the port binds. */
export async function initRunWorkflowGoneMetrics(): Promise<void> {
  (await counter()).add(0);
}

/** Test seam: clears the memoized counter. */
export function resetRunWorkflowGoneMetrics(): void {
  counterPromise = null;
}
