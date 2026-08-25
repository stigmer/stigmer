/**
 * The Syncer — ports pkg/domain/schedule/temporal/syncer.go: converges one
 * Schedule resource's Temporal artifact to its desired state and records
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
 * Status writes go through store.updateResource — the OSS equivalent of
 * the cloud's targeted leaf patches (DD-015 D-C): SQLite stores one
 * protobuf blob, so the atomic read-modify-write under the store's write
 * lock is what keeps a concurrent `stigmer apply` from clobbering the
 * stamp (and vice versa). status.next_fire_at is the contract's arming
 * witness: stamped from Temporal's own answer when armed, cleared when the
 * artifact is paused, absent while nothing has converged.
 *
 * Go's Clock/Syncer also carries a Trigger method (the DD-014
 * artifact-trigger lane); DD-017 D-5 rewired the trigger RPC to the
 * direct-run path and left it with zero production callers, so this port
 * deliberately omits it (sub-project decision 2, owner-ratified at the
 * plan gate; disclosed in the PR register).
 */
import type { Client, ScheduleDescription } from "@temporalio/client";
import { ScheduleAlreadyRunning, ScheduleNotFoundError } from "@temporalio/client";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { ScheduleArtifact } from "./artifact.js";
import { desiredPaused, note } from "./artifact.js";
import { artifactId } from "./names.js";
import { bumpStatusAudit, ensureStatus } from "./status-writes.js";

/**
 * The syncer's answer when no Temporal client exists right now (Go
 * ErrTemporalUnavailable). Callers on the write path treat it as "converge
 * later" (arming is best-effort — DD-015 D-A).
 */
export class TemporalUnavailableError extends Error {
  constructor() {
    super("temporal is not connected");
    this.name = "TemporalUnavailableError";
  }
}

export class ScheduleSyncer {
  constructor(
    /** May return undefined (Temporal down or never connected). */
    private readonly clientProvider: () => Client | undefined,
    private readonly store: Store,
    private readonly artifact: ScheduleArtifact,
    private readonly logger: Logger,
  ) {}

  /**
   * Creates or updates the resource's artifact to the desired state, then
   * stamps status.next_fire_at from Temporal's answer. Returns the stamped
   * time (undefined when the artifact is paused) so write paths can mirror
   * it into their response state (Go EnsureAndRecord).
   */
  async ensureAndRecord(schedule: Schedule): Promise<Date | undefined> {
    const client = this.clientProvider();
    if (client === undefined) {
      throw new TemporalUnavailableError();
    }

    const resourceId = schedule.metadata?.id ?? "";
    const id = artifactId(resourceId);

    try {
      await client.schedule.create(this.artifact.createOptions(schedule));
      this.logger.info("Created schedule artifact", {
        artifact_id: id,
        note: note(schedule),
        paused: desiredPaused(schedule),
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
            this.artifact.applyDesiredState(previous, schedule),
          );
      } catch (updateError) {
        throw new Error(
          `update schedule artifact ${id}: ${message(updateError)}`,
          { cause: updateError },
        );
      }
      this.logger.info("Updated schedule artifact", {
        artifact_id: id,
        note: note(schedule),
        paused: desiredPaused(schedule),
      });
    }

    return this.recordNextFireAt(schedule);
  }

  /**
   * Reads the next fire time from the LIVE artifact — Temporal's answer is
   * authoritative (it accounts for the catch-up window; the platform
   * computes nothing). Undefined while paused, per status.next_fire_at's
   * contract (Go PeekNextFireAt).
   */
  async peekNextFireAt(schedule: Schedule): Promise<Date | undefined> {
    if (desiredPaused(schedule)) {
      return undefined;
    }
    const client = this.clientProvider();
    if (client === undefined) {
      throw new TemporalUnavailableError();
    }
    let description: ScheduleDescription;
    try {
      description = await client.schedule
        .getHandle(artifactId(schedule.metadata?.id ?? ""))
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
   * not (Go Teardown).
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
   * Stamps status.next_fire_at from peekNextFireAt onto the LIVE row
   * (updateResource re-reads inside the lock — the stamp can never
   * resurrect a stale snapshot of the rest of status). Go recordNextFireAt.
   */
  private async recordNextFireAt(schedule: Schedule): Promise<Date | undefined> {
    const nextFireAt = await this.peekNextFireAt(schedule);

    try {
      await this.store.updateResource(
        ApiResourceKind.schedule,
        schedule.metadata?.id ?? "",
        ScheduleSchema,
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
          "Schedule row gone before next_fire_at stamp — skipping",
          { schedule_id: schedule.metadata?.id ?? "" },
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
