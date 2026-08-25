/**
 * The ONE resource-to-Temporal mapping — ports
 * pkg/domain/schedule/temporal/artifact.go (the cloud ScheduleArtifact's
 * twin). Whatever this writes is final for every artifact it creates,
 * because the baked action is invisible to Temporal's schedule listing and
 * cannot be repaired by the reconciliation sweep.
 *
 * Pinned policy, identical to cloud (Go CreateOptions):
 *   - Overlap SKIP is explicit: since a tick SPANS its run (tracking),
 *     SKIP genuinely means "never start a run while the last is active".
 *   - PauseOnFailure stays false: Temporal must never pause behind the
 *     platform's back, or the artifact would oscillate against the
 *     reconciliation pass (which converges paused-state from the row).
 *   - The action carries exactly ONE argument — the schedule resource id.
 *     The nominal fire time cannot ride here (Temporal bakes action args
 *     once and replays them verbatim per fire); the tick derives it from
 *     the fire itself.
 */
import {
  ScheduleOverlapPolicy,
  type ScheduleDescription,
  type ScheduleOptions,
  type ScheduleOptionsAction,
  type ScheduleUpdateOptions,
  type ScheduleOptionsStartWorkflowAction,
} from "@temporalio/client";
import type { Workflow } from "@temporalio/common";

import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";

import type { ScheduleTemporalConfig } from "./config.js";
import { TICK_WORKFLOW_TYPE, artifactId } from "./names.js";

/**
 * The drift fingerprint written into the artifact's state note. Cron
 * itself does NOT round-trip (the Temporal server compiles it into
 * calendar specs and describes cronExpressions as empty), so the note is
 * the only way the reconciliation pass can detect a spec change (Go Note).
 */
export function note(schedule: Schedule): string {
  return `cron=${specOf(schedule).cron} tz=${specOf(schedule).timeZone}`;
}

/**
 * The artifact must be paused when the owner disabled the schedule
 * (spec.enabled=false) OR the platform latched it (status.paused_reason) —
 * two levers, one artifact state (Go DesiredPaused).
 */
export function desiredPaused(schedule: Schedule): boolean {
  return !specOf(schedule).enabled || (schedule.status?.pausedReason ?? "") !== "";
}

function specOf(schedule: Schedule): { cron: string; timeZone: string; enabled: boolean } {
  return {
    cron: schedule.spec?.cron ?? "",
    timeZone: schedule.spec?.timeZone ?? "",
    enabled: schedule.spec?.enabled ?? false,
  };
}

export class ScheduleArtifact {
  constructor(private readonly config: ScheduleTemporalConfig) {}

  /** Builds the complete desired artifact for create (Go CreateOptions). */
  createOptions(schedule: Schedule): ScheduleOptions {
    const resourceId = schedule.metadata?.id ?? "";
    return {
      scheduleId: artifactId(resourceId),
      spec: {
        cronExpressions: [specOf(schedule).cron],
        timezone: specOf(schedule).timeZone,
      },
      action: this.tickAction(resourceId),
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: this.config.catchupWindowMinutes * 60_000,
        pauseOnFailure: false,
      },
      state: {
        paused: desiredPaused(schedule),
        note: note(schedule),
      },
    };
  }

  /**
   * Rewrites a described artifact to the resource's complete desired
   * state — the update half of ensure's create-or-update (Go
   * ApplyDesiredState). A lost race between two writers is benign: both
   * write the same desired state.
   *
   * The ACTION is deliberately rewritten too, even though drift detection
   * cannot see it (invisible to describe-level diffing): on the update
   * path rewriting it is free and self-heals a hand-edited artifact.
   */
  applyDesiredState(
    previous: ScheduleDescription,
    schedule: Schedule,
  ): ScheduleUpdateOptions<ScheduleOptionsStartWorkflowAction<Workflow>> {
    const resourceId = schedule.metadata?.id ?? "";
    return {
      spec: {
        cronExpressions: [specOf(schedule).cron],
        timezone: specOf(schedule).timeZone,
      },
      action: this.tickAction(resourceId),
      policies: {
        overlap: ScheduleOverlapPolicy.SKIP,
        catchupWindow: this.config.catchupWindowMinutes * 60_000,
        pauseOnFailure: false,
      },
      state: {
        ...previous.state,
        paused: desiredPaused(schedule),
        note: note(schedule),
      },
    };
  }

  /**
   * Bakes the tick workflow start: workflow id = artifact id (Temporal
   * appends the nominal fire time per fire — the tick's second-tier
   * nominal-time derivation), the schedule's own queue, and the 24h
   * run-timeout backstop. Retry deliberately stays at the workflow default
   * (none): a failed tick is a missed fire, not a hot loop (Go tickAction).
   */
  private tickAction(resourceId: string): ScheduleOptionsAction {
    return {
      type: "startWorkflow",
      workflowId: artifactId(resourceId),
      workflowType: TICK_WORKFLOW_TYPE,
      args: [resourceId],
      taskQueue: this.config.stigmerQueue,
      workflowRunTimeout: this.config.tickRunTimeoutHours * 3_600_000,
    };
  }
}
