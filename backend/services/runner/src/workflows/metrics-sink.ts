/**
 * Workflow sink for recording per-task metrics from within the
 * Temporal deterministic sandbox. Sinks are the SDK-sanctioned way
 * to push data from workflow code to worker-side infrastructure
 * (OTel, logging, etc.) without breaking determinism.
 *
 * The sink interface is imported by the workflow bundle; the
 * implementation (injected sink) is created by the worker.
 */

import { proxySinks } from "@temporalio/workflow";

export type WorkflowMetricsSink = {
  recordTaskDuration(info: {
    taskName: string;
    taskKind: string;
    durationMs: number;
    success: boolean;
  }): void;
  recordExecutionStart(info: {
    workflowName: string;
  }): void;
  recordExecutionEnd(info: {
    workflowName: string;
    success: boolean;
    durationMs: number;
  }): void;
  [key: string]: (...args: any[]) => any;
};

export type WorkflowMetricsSinks = {
  metrics: WorkflowMetricsSink;
  [key: string]: WorkflowMetricsSink;
};

const { metrics } = proxySinks<WorkflowMetricsSinks>();

export function recordTaskMetric(taskName: string, taskKind: string, durationMs: number, success: boolean): void {
  metrics.recordTaskDuration({ taskName, taskKind, durationMs, success });
}

export function recordExecutionStartMetric(workflowName: string): void {
  metrics.recordExecutionStart({ workflowName });
}

export function recordExecutionEndMetric(workflowName: string, success: boolean, durationMs: number): void {
  metrics.recordExecutionEnd({ workflowName, success, durationMs });
}
