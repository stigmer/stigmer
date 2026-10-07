/**
 * OTel metric instrument registry for the unified runner.
 *
 * Instrument names follow the platform-wide `stigmer.*` convention shared
 * with stigmer-service (SigNoz renders the dots as underscores). The
 * cold-start instruments (runner boot / execution setup / pool attach) are
 * sandbox-runner-specific — they mirror the `stigmer_timing` stdout
 * timelines (see `shared/cold-start-timing.ts`) as dashboard aggregates and
 * have no counterpart in other runners.
 *
 * All instruments are created lazily on first access. When no
 * MeterProvider is configured, they are no-ops (OTel global fallback).
 */

import type { Histogram } from "@opentelemetry/api";

const METER_NAME = "stigmer-runner";

export interface RunnerInstruments {
  readonly activityDuration: Histogram;
  readonly runnerBootDuration: Histogram;
  readonly executionSetupDuration: Histogram;
  readonly poolAttachDuration: Histogram;
}

let instruments: RunnerInstruments | null = null;

export async function getInstruments(): Promise<RunnerInstruments> {
  if (instruments) return instruments;

  const api = await import("@opentelemetry/api");
  const meter = api.metrics.getMeter(METER_NAME);

  instruments = {
    activityDuration: meter.createHistogram("stigmer.activity.duration", {
      unit: "ms",
      description: "Duration of Temporal activities in milliseconds",
    }),
    // Cold-start timelines as dashboard aggregates.
    // Attribute cardinality is bounded by the emitter's whitelist in
    // cold-start-timing.ts: `mode` / `harness` only, never per-pod values.
    runnerBootDuration: meter.createHistogram("stigmer.runner.boot.duration", {
      unit: "ms",
      description: "Runner process boot: Node start to Temporal worker polling",
    }),
    executionSetupDuration: meter.createHistogram("stigmer.execution.setup.duration", {
      unit: "ms",
      description: "Per-execution setup: activity start to agent ready to stream",
    }),
    poolAttachDuration: meter.createHistogram("stigmer.sandbox.pool.attach.duration", {
      unit: "ms",
      description: "Warm-pool attach hand-off on the member: token exchange to session worker polling",
    }),
  };

  return instruments;
}

export function resetInstruments(): void {
  instruments = null;
}
