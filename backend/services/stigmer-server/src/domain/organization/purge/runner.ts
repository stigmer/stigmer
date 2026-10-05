/**
 * The organization purge runner: removes everything an organization owned
 * once its delete is accepted, in every edition, Temporal or not.
 *
 * Its state is the deletion table (`Store.organizationDeletions`), so the
 * runner holds nothing a restart loses. It runs as the schedule reconciler
 * does (temporal/schedule/reconciler.ts): composed with the server, started
 * with its loops and stopped before the store closes, fed by a kick queue
 * (the delete chain's AcceptPurge kicks the organization it accepted) and
 * by an interval pass that reads the table.
 *
 * A pass:
 *   - a pending mark older than `STALE_PENDING_MS` is unmarked: its delete
 *     request failed and could not unmark it, so it answered an error and
 *     the organization is live again, as its caller was told. The unmark
 *     is conditional on the mark still being pending, so it cannot race
 *     an accept.
 *   - every accepted purge whose heartbeat is empty, or older than
 *     `STALE_HEARTBEAT_MS`, is taken: a pod working a purge heartbeats
 *     between batches, so another pod leaves it alone, and a dead pod's
 *     purge moves to whoever passes next. Two pods that overlap repeat
 *     idempotent work and never answer wrong, so no lease is kept.
 *
 * A purge runs the stages in order (extensions/organization-purge.ts),
 * from the stage its record names, each until it answers `more: false`,
 * heartbeating after every batch. A stage that answers `wait` ends the
 * purge's turn until a later pass. A fault records the stage and fixed
 * copy (`PURGE_FAULT_MESSAGE`), logs the cause, and backs the purge off
 * (doubling from `RETRY_BASE_MS` to `RETRY_MAX_MS`); the organization
 * keeps answering not-found meanwhile. Faults are never thrown out of a
 * pass: the runner is background work.
 *
 * The purge acts as the server acting for the deletion (`PURGE_ACTOR`),
 * an internal caller, so the stores that record who removed a row name the
 * purge rather than a person.
 *
 * What the tests pin (__tests__/runner.test.ts): stage order and resume,
 * batching and heartbeat, wait, fault and backoff, the stale pending mark,
 * the stale heartbeat take-over, and stop.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { Logger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type {
  OrganizationPurgeStage,
  OrganizationPurgeTarget,
} from "../../../extensions/organization-purge.js";
import { serverActingFor } from "../../../pipeline/interceptors/auth.js";
import { PURGE_ACTOR } from "../lifecycle.js";
import type { OrganizationDeletion, Store } from "../../../store/interface.js";
import { ResourceNotFoundError } from "../../../store/interface.js";

/** How often the interval pass reads the deletion table. */
export const PURGE_PASS_INTERVAL_MS = 30 * 1000;

/** A heartbeat older than this means the pod working the purge is gone. */
export const STALE_HEARTBEAT_MS = 5 * 60 * 1000;

/**
 * A pending mark older than this belongs to a delete request that is over:
 * longer than any request's deadline, so a live request never loses its
 * mark to the runner.
 */
export const STALE_PENDING_MS = 10 * 60 * 1000;

/** The first retry's delay after a fault; it doubles per fault up to the cap. */
export const RETRY_BASE_MS = 30 * 1000;
export const RETRY_MAX_MS = 15 * 60 * 1000;

/** The fixed copy a fault leaves on the deletion record; the cause is logged. */
export const PURGE_FAULT_MESSAGE = "the purge stage failed; it will be retried";

/** The principal the purge acts for (lifecycle.ts admits its own requests). */
export { PURGE_ACTOR };

export interface OrganizationPurgeRunnerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** Every stage, in the order the purge runs them. */
  readonly stages: ReadonlyArray<OrganizationPurgeStage>;
  /** The clock; tests pass their own. */
  readonly now?: () => Date;
  /** The interval between passes; tests pass their own. */
  readonly intervalMs?: number;
}

/** What the delete chain hands an accepted organization to. */
export interface OrganizationPurgeKick {
  kick(org: string): void;
}

export class OrganizationPurgeRunner implements OrganizationPurgeKick {
  private readonly now: () => Date;
  private readonly caller: CallerIdentity = serverActingFor(PURGE_ACTOR);
  private readonly running = new Set<string>();
  /** The purges this pod has taken and not finished: its own heartbeats do not hold it off them. */
  private readonly owned = new Set<string>();
  private readonly backoff = new Map<
    string,
    { readonly faults: number; readonly until: number }
  >();
  private timer: NodeJS.Timeout | undefined;
  private pass: Promise<void> | undefined;
  private queued = false;
  private stopped = false;

  constructor(private readonly deps: OrganizationPurgeRunnerDeps) {
    this.now = deps.now ?? (() => new Date());
    const names = new Set<string>();
    for (const stage of deps.stages) {
      if (names.has(stage.name)) {
        throw new Error(
          `organization purge stage '${stage.name}' is composed twice — stage names are unique`,
        );
      }
      names.add(stage.name);
    }
  }

  /** Starts the interval and runs a first pass at once. */
  start(): void {
    if (this.timer !== undefined || this.stopped) {
      return;
    }
    this.timer = setInterval(
      () => this.schedulePass(),
      this.deps.intervalMs ?? PURGE_PASS_INTERVAL_MS,
    );
    this.timer.unref();
    this.schedulePass();
  }

  /** Asks for a pass soon: the delete chain's kick after an accept. */
  kick(_org: string): void {
    if (this.timer === undefined || this.stopped) {
      return;
    }
    this.schedulePass();
  }

  /** Stops the interval and waits for a pass in flight. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.pass;
  }

  private schedulePass(): void {
    if (this.pass !== undefined) {
      this.queued = true;
      return;
    }
    this.pass = this.runPass().finally(() => {
      this.pass = undefined;
      if (this.queued && !this.stopped) {
        this.queued = false;
        this.schedulePass();
      }
    });
  }

  /** One pass over the deletion table. Never throws. */
  async runPass(): Promise<void> {
    let deletions: OrganizationDeletion[];
    try {
      deletions = await this.deps.store.organizationDeletions.list();
    } catch (error) {
      this.deps.logger.warn("organization purge pass could not read the deletion table", {
        error: errorText(error),
      });
      return;
    }
    const nowMs = this.now().getTime();
    for (const deletion of deletions) {
      if (this.stopped) {
        return;
      }
      if (deletion.phase === "pending") {
        await this.recoverStalePending(deletion, nowMs);
        continue;
      }
      if (this.running.has(deletion.org) || !this.isDue(deletion, nowMs)) {
        continue;
      }
      this.running.add(deletion.org);
      try {
        await this.purge(deletion);
      } finally {
        this.running.delete(deletion.org);
      }
    }
  }

  private isDue(deletion: OrganizationDeletion, nowMs: number): boolean {
    const held = this.backoff.get(deletion.org);
    if (held !== undefined && nowMs < held.until) {
      return false;
    }
    // A purge this pod has taken carries this pod's own fresh heartbeat;
    // the backoff above alone decides when it goes on.
    if (deletion.heartbeatAt === "" || this.owned.has(deletion.org)) {
      return true;
    }
    return nowMs - Date.parse(deletion.heartbeatAt) >= STALE_HEARTBEAT_MS;
  }

  private async recoverStalePending(
    deletion: OrganizationDeletion,
    nowMs: number,
  ): Promise<void> {
    if (nowMs - Date.parse(deletion.markedAt) < STALE_PENDING_MS) {
      return;
    }
    try {
      if (await this.deps.store.organizationDeletions.unmark(deletion.org)) {
        this.deps.logger.warn(
          "an organization delete left its mark behind; the organization is live again",
          { org: deletion.org, markedAt: deletion.markedAt },
        );
      }
    } catch (error) {
      this.deps.logger.warn("could not remove a stale organization delete mark", {
        org: deletion.org,
        error: errorText(error),
      });
    }
  }

  private async purge(deletion: OrganizationDeletion): Promise<void> {
    const deletions = this.deps.store.organizationDeletions;
    const stages = this.deps.stages;
    const resumeAt = Math.max(
      0,
      stages.findIndex((stage) => stage.name === deletion.stage),
    );
    let stageName = stages[resumeAt]?.name ?? "";
    this.owned.add(deletion.org);
    try {
      const org = await this.target(deletion.org);
      for (let index = resumeAt; index < stages.length; index++) {
        const stage = stages[index]!;
        stageName = stage.name;
        await deletions.heartbeat(deletion.org, stage.name, this.stamp());
        for (;;) {
          if (this.stopped) {
            return;
          }
          const progress = await stage.run({
            org,
            logger: this.deps.logger,
            caller: this.caller,
          });
          if (!progress.more) {
            break;
          }
          if (progress.wait === true) {
            this.backoff.delete(deletion.org);
            return;
          }
          await deletions.heartbeat(deletion.org, stage.name, this.stamp());
        }
      }
      this.backoff.delete(deletion.org);
      this.owned.delete(deletion.org);
      this.deps.logger.info("organization purged", { org: deletion.org });
    } catch (error) {
      const faults = (this.backoff.get(deletion.org)?.faults ?? 0) + 1;
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (faults - 1));
      this.backoff.set(deletion.org, {
        faults,
        until: this.now().getTime() + delay,
      });
      this.deps.logger.error("organization purge stage failed; retrying later", {
        org: deletion.org,
        stage: stageName,
        retryInMs: delay,
        error: errorText(error),
      });
      try {
        await deletions.recordError(
          deletion.org,
          stageName,
          PURGE_FAULT_MESSAGE,
          this.stamp(),
        );
      } catch (recordError) {
        this.deps.logger.warn("could not record an organization purge fault", {
          org: deletion.org,
          error: errorText(recordError),
        });
      }
    }
  }

  /** The organization's id and parent; a row already gone (the final stage crashed after it) has no parent left to name. */
  private async target(org: string): Promise<OrganizationPurgeTarget> {
    try {
      const row = await this.deps.store.getResource(
        ApiResourceKind.organization,
        org,
        OrganizationSchema,
      );
      return { id: org, parentOrg: row.spec?.parentOrg ?? "" };
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return { id: org, parentOrg: "" };
      }
      throw error;
    }
  }

  private stamp(): string {
    return this.now().toISOString();
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
