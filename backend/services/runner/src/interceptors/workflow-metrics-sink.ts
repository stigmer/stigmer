/**
 * Worker-side implementation of the workflow metrics sink.
 *
 * Receives timing data pushed from within the Temporal workflow sandbox
 * and records it using the OTel metrics registry. This is the bridge
 * between the deterministic workflow code and the non-deterministic
 * observability infrastructure.
 */

import type { InjectedSinks } from "@temporalio/worker";
import type { WorkflowMetricsSinks } from "../workflows/metrics-sink.js";
import { getInstruments } from "../otel-metrics.js";

let instrumentsPromise: ReturnType<typeof getInstruments> | null = null;

function ensureInstruments() {
  if (!instrumentsPromise) {
    instrumentsPromise = getInstruments();
  }
  return instrumentsPromise;
}

export function createWorkflowMetricsSinks(): InjectedSinks<WorkflowMetricsSinks> {
  return {
    metrics: {
      recordTaskDuration: {
        fn(_workflowInfo, info) {
          ensureInstruments().then((instruments) => {
            const attrs = {
              "task.name": info.taskName,
              "task.kind": info.taskKind,
              "task.success": String(info.success),
            };
            instruments.workflowTaskDuration.record(info.durationMs, attrs);
            instruments.workflowTaskCount.add(1, attrs);
          });
        },
      },
      recordExecutionStart: {
        fn(_workflowInfo, info) {
          ensureInstruments().then((instruments) => {
            instruments.executionCount.add(1, { "workflow.name": info.workflowName });
            instruments.executionActive.add(1, { "workflow.name": info.workflowName });
          });
        },
      },
      recordExecutionEnd: {
        fn(_workflowInfo, info) {
          ensureInstruments().then((instruments) => {
            instruments.executionActive.add(-1, { "workflow.name": info.workflowName });
          });
        },
      },
    },
  };
}
