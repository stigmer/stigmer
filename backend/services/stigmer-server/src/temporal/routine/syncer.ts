/**
 * The Syncer: converges one
 * routine's Temporal artifact to its desired state and records
 * the result on the resource's status. The ONE arming/teardown authority,
 * shared by the write-path steps, the reconciliation pass, and the tick's
 * next-fire refresh.
 *
 * The client arrives through a provider, not a field: the server hot-swaps
 * its Temporal client on reconnect (src/temporal/manager.ts), and a
 * component holding a stale client silently dies after the first blip.
 * Reading through the provider on every call makes that entire bug class
 * unrepresentable here.
 *
 * Status writes go through store.updateResource: the store keeps one
 * protobuf blob per row, so the atomic read-modify-write under the
 * store's write lock is what keeps a concurrent `stigmer apply` from clobbering the
 * stamp (and vice versa). status.next_fire_at is the contract's arming
 * witness: stamped from Temporal's own answer when armed, cleared when the
 * artifact is paused, absent while nothing has converged.
 *
 * A routine with no cron wants no artifact: converging it removes any
 * artifact a removed cron left and clears next_fire_at, and needs the
 * engine only for that removal, so a routine that never had a schedule is
 * written with the engine away. The reconciliation pass removes what a
 * write made while the engine was away could not.
 *
 * Fires do not pass through the syncer: the fire RPC runs through the
 * direct-run path.
 */
import type { Client, ScheduleDescription } from "@temporalio/client";
import { ScheduleAlreadyRunning, ScheduleNotFoundError } from "@temporalio/client";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { bumpStatusAudit } from "../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { RoutineArtifact } from "./artifact.js";
import { desiredPaused, hasSchedule, note } from "./artifact.js";
import { artifactId } from "./names.js";
import { ensureStatus } from "./status-writes.js";

/**
 * The syncer's answer when no Temporal client exists right now. Callers on the write path treat it as "converge
 * later" (arming is best-effort).
 */
export class TemporalUnavailableError extends Error {
  constructor() {
    super("temporal is not connected");
    this.name = "TemporalUnavailableError";
  }
}

export class RoutineSyncer {
  constructor(
    /** May return undefined (Temporal down or never connected). */
    private readonly clientProvider: () => Client | undefined,
    private readonly store: Store,
    private readonly artifact: RoutineArtifact,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates or updates the resource's artifact to the desired state, then
   * stamps status.next_fire_at from Temporal's answer. Returns the stamped
   * time (undefined when the artifact is paused) so write paths can mirror
   * it into their response state.
   */
  async ensureAndRecord(routine: Routine): Promise<Date | undefined> {
    const resourceId = routine.metadata?.id ?? "";
    if (!hasSchedule(routine)) {
      await this.disarm(routine);
      return undefined;
    }
    const client = this.clientProvider();
    if (client === undefined) {
      throw new TemporalUnavailableError();
    }

    const id = artifactId(resourceId);

    try {
      await client.schedule.create(this.artifact.createOptions(routine));
      this.logger.info("Created schedule artifact", {
        artifact_id: id,
        note: note(routine),
        paused: desiredPaused(routine),
      });
    } catch (error) {
      if (!(error instanceof ScheduleAlreadyRunning)) {
        throw new Error(`create schedule artifact ${id}: ${message(error)}`, {
          cause: error,
        });
      }
      // Create-or-update convergence: rewrite the existing artifact to the
      // complete desired state. A lost race between two writers is benign —
      // both write the same desired state.
      try {
        await client.schedule
          .getHandle(id)
          .update((previous: ScheduleDescription) =>
            this.artifact.applyDesiredState(previous, routine),
          );
      } catch (updateError) {
        throw new Error(
          `update schedule artifact ${id}: ${message(updateError)}`,
          { cause: updateError },
        );
      }
      this.logger.info("Updated schedule artifact", {
        artifact_id: id,
        note: note(routine),
        paused: desiredPaused(routine),
      });
    }

    return this.recordNextFireAt(routine);
  }

  /**
   * Reads the next fire time from the LIVE artifact — Temporal's answer is
   * authoritative (it accounts for the catch-up window; the platform
   * computes nothing). Undefined while paused, per status.next_fire_at's
   * contract.
   */
  async peekNextFireAt(routine: Routine): Promise<Date | undefined> {
    if (!hasSchedule(routine) || desiredPaused(routine)) {
      return undefined;
    }
    const client = this.clientProvider();
    if (client === undefined) {
      throw new TemporalUnavailableError();
    }
    let description: ScheduleDescription;
    try {
      description = await client.schedule
        .getHandle(artifactId(routine.metadata?.id ?? ""))
        .describe();
    } catch (error) {
      throw new Error(`describe schedule artifact: ${message(error)}`, {
        cause: error,
      });
    }
    return description.info.nextActionTimes[0];
  }

  /**
   * Deletes the resource's artifact. Not-found is success — delete is
   * idempotent from the platform's point of view even though Temporal's is
   * not.
   */
  async teardown(resourceId: string): Promise<void> {
    const client = this.clientProvider();
    if (client === undefined) {
      throw new TemporalUnavailableError();
    }
    const id = artifactId(resourceId);
    try {
      await client.schedule.getHandle(id).delete();
    } catch (error) {
      if (error instanceof ScheduleNotFoundError) {
        this.logger.info("Schedule artifact already gone", { artifact_id: id });
        return;
      }
      throw new Error(`delete schedule artifact ${id}: ${message(error)}`, {
        cause: error,
      });
    }
    this.logger.info("Deleted schedule artifact", { artifact_id: id });
  }

  /**
   * Converges a routine with no cron: removes the artifact a removed cron
   * left, when the engine is here to ask (not-found is success; away, the
   * reconciliation pass removes it later), and clears next_fire_at.
   */
  private async disarm(routine: Routine): Promise<void> {
    const resourceId = routine.metadata?.id ?? "";
    if (this.clientProvider() !== undefined) {
      await this.teardown(resourceId);
    }
    if (routine.status?.nextFireAt === undefined) {
      return;
    }
    try {
      await this.store.updateResource(ApiResourceKind.routine, resourceId, RoutineSchema, (live) => {
        const status = ensureStatus(live);
        status.nextFireAt = undefined;
        bumpStatusAudit(status);
      });
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return;
      }
      throw new Error(`clear next_fire_at: ${message(error)}`, { cause: error });
    }
  }

  /**
   * Stamps status.next_fire_at from peekNextFireAt onto the LIVE row
   * (updateResource re-reads inside the lock — the stamp can never
   * resurrect a stale snapshot of the rest of status).
   */
  private async recordNextFireAt(routine: Routine): Promise<Date | undefined> {
    const nextFireAt = await this.peekNextFireAt(routine);

    try {
      await this.store.updateResource(
        ApiResourceKind.routine,
        routine.metadata?.id ?? "",
        RoutineSchema,
        (live) => {
          const status = ensureStatus(live);
          status.nextFireAt =
            nextFireAt === undefined ? undefined : timestampFromDate(nextFireAt);
          bumpStatusAudit(status);
        },
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        // Deleted between arm and stamp: the orphaned artifact is harmless
        // (revalidation no-ops it) and the reconciliation pass reaps it.
        this.logger.info(
          "Routine row gone before next_fire_at stamp — skipping",
          { routine_id: routine.metadata?.id ?? "" },
        );
        return nextFireAt;
      }
      throw new Error(`stamp next_fire_at: ${message(error)}`, { cause: error });
    }
    return nextFireAt;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
