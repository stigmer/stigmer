/**
 * The stalled-run checker: a working run whose workflow is gone is ended,
 * in every edition and with every sandbox driver (stigmer#3120).
 *
 * A turn is driven by its workflow. When the workflow never started (the
 * server stopped between saving the turn and starting it) or the engine
 * lost or closed it without the run hearing, the run stays pending or in
 * progress forever: its session reads running, every message queues
 * behind it, and the idle sweeps never let its sandbox sleep. Nothing on
 * the run says so (no progress stamp; a status write is not a heartbeat),
 * and age alone cannot tell a stall from a long turn, so the checker asks
 * the engine (ConnectedExecutionEngine.workflowLiveness).
 *
 * It runs as the organization purge runner does
 * (domain/organization/purge/runner.ts): composed with the server, started
 * with its loops and stopped before the store closes. A pass, every
 * `STALLED_RUN_PASS_INTERVAL_MS`:
 *
 *   - does nothing while the engine is disconnected;
 *   - reads the server's working runs on the run index's `working` key
 *     (list-index.ts), in pages, only those created more than
 *     `STALLED_RUN_MIN_AGE_MS` ago, far above any workflow start
 *     (temporal/agentexecution/engine-client.ts makes one start call).
 *     The index has no "created before" bound, so the read starts after
 *     the bound's position in its newest-first order. A run with no
 *     creation stamp has no age and is left alone;
 *   - asks the engine about each run it has not asked about within
 *     `STALLED_RUN_RECHECK_MS` (a map in memory, pruned to the working
 *     runs each full read finds), so a long turn costs one engine read per
 *     recheck window per pod;
 *   - ends each run whose workflow is closed or not found through
 *     workflow-gone.ts, conditional on the run still working, so a run
 *     that ended between the ask and the write keeps its ending. That
 *     write tells the status observers, which start the session's queued
 *     turn, and counts it on `stigmer.run.workflow_gone`.
 *
 * A turn waiting for a person's answer or paused is not working, so it is
 * never read: its workflow is open by design.
 *
 * Faults are never thrown out of a pass: a read that fails ends the pass,
 * an engine read or a write that fails skips that run, and each is logged.
 * No lease: two pods asking about one run repeat an idempotent conditional
 * write. A pass that ends runs logs one summary line, with the count and a
 * capped sample.
 *
 * Proven by __tests__/stalled-runs.test.ts, and composed by
 * boot/__tests__/stalled-runs.composed.temporal.test.ts.
 */
import type { Logger } from "../../boot/logger.js";
import type { ListIndexCursor } from "../../store/list-index.js";
import { listIndexInstantOfMillis } from "../../store/list-index.js";
import type {
  ExecutionEngineStateProvider,
  WorkflowLiveness,
} from "./engine.js";
import { agentExecutionListIndex } from "./list-index.js";
import { WORKING_PHASES } from "./phases.js";
import type { WorkflowGoneDeps } from "./workflow-gone.js";
import { failRunWithoutWorkflow } from "./workflow-gone.js";

/** How often a pass reads the working runs. */
export const STALLED_RUN_PASS_INTERVAL_MS = 60 * 1000;

/**
 * A run younger than this is not asked about: its workflow may still be
 * starting. Five minutes is far above one start call, and a stuck turn's
 * person waits at most about this plus one pass.
 */
export const STALLED_RUN_MIN_AGE_MS = 5 * 60 * 1000;

/** A run asked about is not asked again within this. */
export const STALLED_RUN_RECHECK_MS = 5 * 60 * 1000;

/** Runs read per page. */
export const STALLED_RUN_PAGE = 100;

/** Ended runs a pass's summary line names. */
const SUMMARY_SAMPLE = 10;

/** The one value every working run holds for the `working` key (list-index.ts). */
const WORKING_VALUE = "Run";

export interface StalledRunCheckerDeps extends WorkflowGoneDeps {
  readonly engineState: ExecutionEngineStateProvider;
  readonly logger: Logger;
  /** The clock; tests pass their own. */
  readonly now?: () => Date;
  /** The interval between passes; tests pass their own. */
  readonly intervalMs?: number;
}

export class StalledRunChecker {
  private readonly now: () => Date;
  /** When this process last asked the engine about each working run, in epoch ms. */
  private readonly asked = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;
  private pass: Promise<void> | undefined;
  private stopped = false;

  constructor(private readonly deps: StalledRunCheckerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Starts the interval. The first pass comes one interval after boot: nothing is younger than the minimum age then anyway. */
  start(): void {
    if (this.timer !== undefined || this.stopped) {
      return;
    }
    this.timer = setInterval(() => {
      if (this.pass === undefined) {
        this.pass = this.runPass().finally(() => {
          this.pass = undefined;
        });
      }
    }, this.deps.intervalMs ?? STALLED_RUN_PASS_INTERVAL_MS);
    this.timer.unref();
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

  /** One pass over the working runs. Never throws. */
  async runPass(): Promise<void> {
    const engineState = this.deps.engineState();
    if (!engineState.connected) {
      return;
    }
    const engine = engineState.engine;
    const nowMs = this.now().getTime();
    const ended: Array<{ readonly runId: string; readonly createdAt: string }> =
      [];
    const seen = new Set<string>();
    // The bound's position: every row after it was created before it.
    let after: ListIndexCursor = {
      createdAt: listIndexInstantOfMillis(nowMs - STALLED_RUN_MIN_AGE_MS),
      id: "",
    };
    let complete = false;
    while (!this.stopped) {
      let rows;
      try {
        rows = await this.deps.store.queryResources(agentExecutionListIndex, {
          anyKey: [{ name: "working", value: WORKING_VALUE }],
          after,
          limit: STALLED_RUN_PAGE,
        });
      } catch (error) {
        this.deps.logger.warn(
          "stalled-run pass could not read the working runs",
          { error: errorText(error) },
        );
        break;
      }
      for (const row of rows) {
        if (this.stopped) {
          break;
        }
        if (row.cursor.createdAt === "") {
          continue;
        }
        seen.add(row.id);
        const last = this.asked.get(row.id);
        if (last !== undefined && nowMs - last < STALLED_RUN_RECHECK_MS) {
          continue;
        }
        this.asked.set(row.id, nowMs);
        let liveness: WorkflowLiveness;
        try {
          liveness = await engine.workflowLiveness(row.id);
        } catch (error) {
          this.deps.logger.warn(
            "stalled-run pass could not ask the engine about a run",
            {
              runId: row.id,
              error: errorText(error),
            },
          );
          continue;
        }
        if (liveness === "open") {
          continue;
        }
        try {
          const outcome = await failRunWithoutWorkflow(
            this.deps,
            row.id,
            WORKING_PHASES,
            liveness,
          );
          if (outcome.written) {
            ended.push({ runId: row.id, createdAt: row.cursor.createdAt });
          }
        } catch (error) {
          this.deps.logger.warn(
            "stalled-run pass could not end a run whose workflow is gone",
            {
              runId: row.id,
              error: errorText(error),
            },
          );
        }
      }
      const lastRow = rows[rows.length - 1];
      if (rows.length < STALLED_RUN_PAGE || lastRow === undefined) {
        complete = !this.stopped;
        break;
      }
      after = lastRow.cursor;
    }
    // Only a full read knows which runs stopped working.
    if (complete) {
      for (const runId of this.asked.keys()) {
        if (!seen.has(runId)) {
          this.asked.delete(runId);
        }
      }
    }
    if (ended.length > 0) {
      this.deps.logger.warn(
        "stalled-run pass ended runs whose workflow is gone",
        {
          ended: ended.length,
          sample: ended.slice(0, SUMMARY_SAMPLE).map((run) => ({
            ...run,
            ageSeconds: ageSecondsOf(run.createdAt, nowMs),
          })),
        },
      );
    }
  }
}

/** A run's age at `nowMs` from its index instant (`YYYY-MM-DDTHH:MM:SS.nnnnnnnnnZ`), to the second. */
function ageSecondsOf(createdAt: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(`${createdAt.slice(0, 19)}Z`)) / 1000);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
