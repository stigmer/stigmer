/**
 * OTel metric instrument registry for the unified runner.
 *
 * Matches Go workflow-runner's `pkg/otel/metrics.go` instrument names.
 * All instruments are created lazily on first access. When no
 * MeterProvider is configured, they are no-ops (OTel global fallback).
 */

import type { Counter, Histogram, UpDownCounter } from "@opentelemetry/api";

const METER_NAME = "stigmer-runner";

export interface RunnerInstruments {
  readonly executionCount: Counter;
  readonly executionActive: UpDownCounter;
  readonly activityDuration: Histogram;
  readonly workflowTaskDuration: Histogram;
  readonly workflowTaskCount: Counter;
}

let instruments: RunnerInstruments | null = null;

export async function getInstruments(): Promise<RunnerInstruments> {
  if (instruments) return instruments;

  const api = await import("@opentelemetry/api");
  const meter = api.metrics.getMeter(METER_NAME);

  instruments = {
    executionCount: meter.createCounter("stigmer.execution.count", {
      description: "Total number of workflow executions started",
    }),
    executionActive: meter.createUpDownCounter("stigmer.execution.active", {
      description: "Currently active workflow executions",
    }),
    activityDuration: meter.createHistogram("stigmer.activity.duration", {
      unit: "ms",
      description: "Duration of Temporal activities in milliseconds",
    }),
    workflowTaskDuration: meter.createHistogram("stigmer.workflow.task.duration", {
      unit: "ms",
      description: "Duration of individual workflow tasks in milliseconds",
    }),
    workflowTaskCount: meter.createCounter("stigmer.workflow.task.count", {
      description: "Total number of workflow tasks executed",
    }),
  };

  return instruments;
}

export function resetInstruments(): void {
  instruments = null;
}
