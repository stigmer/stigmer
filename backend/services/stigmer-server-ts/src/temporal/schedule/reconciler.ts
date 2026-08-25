/**
 * The reconciler — ports pkg/domain/schedule/temporal/reconcile.go:
 * converges Schedule rows and Temporal artifacts in both directions — rows
 * without artifacts get armed, drifted artifacts get rewritten, artifacts
 * without rows get deleted.
 *
 * In cloud this pass is belt-and-braces behind a non-critical arming step.
 * In OSS it is LOAD-BEARING (DD-015 D-B): `stigmer up` runs a managed
 * Temporal DEV SERVER whose state is a local SQLite file — a restart,
 * crash, or reset destroys every artifact, and without this pass every
 * schedule would silently never fire again. That is also why
 * startReconciliation hooks the Temporal RECONNECT path, not just a timer:
 * a reconnect is precisely the moment the artifacts are most likely to be
 * gone.
 *
 * Lifecycle in TS idiom (sub-project decision 4, owner-ratified): Go's
 * goroutine+channel loop becomes an unref'd interval plus a kick queue
 * with an explicit stop() called from the compose shutdown — nothing may
 * fire after shutdown (the #18 manager-close panel lesson). Semantics are
 * preserved exactly: an immediate boot pass, periodic passes gated by the
 * env kill-switch, and kicked passes that ALWAYS run (reconnect
 * convergence is correctness, not hygiene).
 */
import type { Client } from "@temporalio/client";
import { fromBinary } from "@bufbuild/protobuf";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { desiredPaused, note } from "./artifact.js";
import type { ScheduleTemporalConfig } from "./config.js";
import { PROBE_ID_PREFIX, TICK_ID_PREFIX, resourceIdOf } from "./names.js";
import { pruneRunLedger } from "./run-ledger.js";
import type { ScheduleSyncer } from "./syncer.js";

/** Summarizes one convergence pass, for the log line (Go ReconcileCounts). */
export interface ReconcileCounts {
  rowsExamined: number;
  armed: number;
  repaired: number;
  orphansDeleted: number;
  failures: number;
}

function formatCounts(counts: ReconcileCounts): string {
  return `rows=${counts.rowsExamined} armed=${counts.armed} repaired=${counts.repaired} orphans_deleted=${counts.orphansDeleted} failures=${counts.failures}`;
}

/**
 * The describable slice the drift diff runs on. The baked ACTION is
 * invisible to the listing — which is why the state note carries the
 * cron+tz fingerprint (cron does not round-trip).
 */
interface ArtifactState {
  readonly note: string;
  readonly paused: boolean;
}

export class ScheduleReconciler {
  private interval: NodeJS.Timeout | undefined;
  private stopped = false;
  /** One queued kick is enough (Go's 1-buffered channel). */
  private kickQueued = false;
  private running: Promise<void> = Promise.resolve();

  constructor(
    private readonly clientProvider: () => Client | undefined,
    private readonly store: Store,
    private readonly syncer: ScheduleSyncer,
    private readonly config: ScheduleTemporalConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Executes one convergence pass. Per-row failures are counted and the
   * pass continues — one broken schedule must never stop the rest from
   * converging (Go RunPass).
   */
  async runPass(): Promise<ReconcileCounts> {
    const counts: ReconcileCounts = {
      rowsExamined: 0,
      armed: 0,
      repaired: 0,
      orphansDeleted: 0,
      failures: 0,
    };

    const client = this.clientProvider();
    if (client === undefined) {
      this.logger.debug("Schedule reconciliation skipped — Temporal not connected");
      return counts;
    }

    // Phase 1: snapshot every tick artifact in one listing.
    const artifacts = new Map<string, ArtifactState>();
    try {
      for await (const entry of client.schedule.list({ pageSize: 100 })) {
        if (entry.scheduleId.startsWith(TICK_ID_PREFIX)) {
          artifacts.set(resourceIdOf(entry.scheduleId), {
            note: entry.state.note ?? "",
            paused: entry.state.paused,
          });
        } else if (entry.scheduleId.startsWith(PROBE_ID_PREFIX)) {
          // Not ours: OSS creates no probes (names.ts PROBE_ID_PREFIX).
        }
        // Anything else is someone else's schedule (e.g. a user's own
        // Temporal use on the shared dev server) — never touch it.
      }
    } catch (error) {
      this.logger.error("Schedule reconciliation could not list artifacts", {
        error: message(error),
      });
      counts.failures++;
      return counts;
    }

    // Phase 2: walk every row; arm the unarmed, repair the drifted.
    // Removal from the map is what leaves the orphans behind for phase 3.
    let rows: Schedule[];
    try {
      rows = await this.listSchedules();
    } catch (error) {
      this.logger.error("Schedule reconciliation could not list rows", {
        error: message(error),
      });
      counts.failures++;
      return counts;
    }
    for (const row of rows) {
      counts.rowsExamined++;
      const resourceId = row.metadata?.id ?? "";
      const actual = artifacts.get(resourceId);
      artifacts.delete(resourceId);

      if (actual === undefined) {
        try {
          await this.syncer.ensureAndRecord(row);
        } catch (error) {
          counts.failures++;
          this.logger.error(
            "Reconciliation failed to arm a schedule (pass continues)",
            { schedule_id: resourceId, error: message(error) },
          );
          continue;
        }
        counts.armed++;
        this.logger.info("Reconciliation armed a schedule without an artifact", {
          schedule_id: resourceId,
        });
      } else if (actual.note !== note(row) || actual.paused !== desiredPaused(row)) {
        try {
          await this.syncer.ensureAndRecord(row);
        } catch (error) {
          counts.failures++;
          this.logger.error(
            "Reconciliation failed to repair a drifted artifact (pass continues)",
            { schedule_id: resourceId, error: message(error) },
          );
          continue;
        }
        counts.repaired++;
        this.logger.info("Reconciliation repaired a drifted artifact", {
          schedule_id: resourceId,
          actual_note: actual.note,
          actual_paused: actual.paused,
        });
      }
    }

    // Phase 3: reap orphans — but ONLY after a targeted point read
    // confirms the row is genuinely gone. A row created after phase 2's
    // listing must never lose its just-armed clock (THE guard, pinned by
    // test in both editions).
    for (const resourceId of artifacts.keys()) {
      try {
        await this.store.getResource(
          ApiResourceKind.schedule,
          resourceId,
          ScheduleSchema,
        );
        continue; // the row exists — not an orphan
      } catch (error) {
        if (!(error instanceof ResourceNotFoundError)) {
          counts.failures++;
          this.logger.error(
            "Reconciliation could not confirm an orphan (leaving it; pass continues)",
            { schedule_id: resourceId, error: message(error) },
          );
          continue;
        }
      }
      try {
        await this.syncer.teardown(resourceId);
      } catch (error) {
        counts.failures++;
        this.logger.error(
          "Reconciliation failed to delete an orphaned artifact (pass continues)",
          { schedule_id: resourceId, error: message(error) },
        );
        continue;
      }
      counts.orphansDeleted++;
      this.logger.info("Reconciliation deleted an orphaned artifact", {
        schedule_id: resourceId,
      });
    }

    // Phase 4: fire-ledger retention (DD-017 D-7) — the clock's one
    // periodic hook, so the ledger's bound needs no machinery of its own.
    await pruneRunLedger(
      this.store,
      this.logger,
      this.config.resolvedRunHistoryRetentionDays(),
    );

    this.logger.info("Schedule reconciliation pass complete", {
      counts: formatCounts(counts),
    });
    return counts;
  }

  /**
   * Runs the convergence loop: an immediate first pass (the boot is itself
   * a "reconnect" — the dev server may have restarted while the daemon was
   * down), then one pass per interval, plus out-of-band passes requested
   * through the returned kick function (wired to the Temporal manager's
   * reconnect hook). The env kill-switch disables only the PERIODIC
   * passes; kicked passes still run (Go StartReconciliation).
   */
  startReconciliation(): () => void {
    void this.enqueuePass();

    if (this.config.reconciliationEnabled) {
      this.interval = setInterval(
        () => void this.enqueuePass(),
        this.config.reconciliationIntervalMinutes * 60_000,
      );
      // Unref'd like the manager's monitor: an unclosed reconciler must
      // not keep the process alive past main's intent.
      this.interval.unref();
    } else {
      this.logger.info(
        "Periodic schedule reconciliation disabled (STIGMER_SCHEDULES_RECONCILIATION_ENABLED=false) — reconnect passes still run",
      );
    }

    return () => {
      void this.enqueuePass();
    };
  }

  /**
   * Stops the loop; in-flight and queued passes drain, nothing new starts
   * (Go's context cancellation; called from the compose shutdown).
   */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    await this.running;
  }

  /**
   * Serializes passes (Go's single goroutine consuming ticker + kicks): at
   * most one pass runs at a time, and at most one further pass queues —
   * exactly the 1-buffered kick channel's coalescing.
   */
  private enqueuePass(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    if (this.kickQueued) {
      return this.running; // a pass is already queued — one is enough
    }
    this.kickQueued = true;
    this.running = this.running.then(async () => {
      this.kickQueued = false;
      if (this.stopped) {
        return;
      }
      await this.runPass();
    });
    return this.running;
  }

  /**
   * Loads every schedule row, skipping corrupt blobs (the lenient-read
   * posture list endpoints use). OSS scale is a handful of schedules on
   * one user's machine; the full listing per pass is noise (Go
   * listSchedules).
   */
  private async listSchedules(): Promise<Schedule[]> {
    const blobs = await this.store.listResources(ApiResourceKind.schedule);
    const schedules: Schedule[] = [];
    for (const data of blobs) {
      try {
        schedules.push(fromBinary(ScheduleSchema, data));
      } catch (error) {
        this.logger.warn("Schedule reconciliation skipped a corrupt row", {
          error: message(error),
        });
      }
    }
    return schedules;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
