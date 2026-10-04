/**
 * Pins the store-backed session reader a sandbox driver's idle sweep
 * consumes (session-activity.ts), over a real sqlite store:
 *
 *   - busy while any execution of the session is pending, in progress,
 *     waiting for approval or paused; idle once every one has ended;
 *   - the activity clock is the latest creation or completion stamp the
 *     server wrote, never another session's;
 *   - a stamp more than a minute ahead of the server's clock is skipped,
 *     so the idle ladder still pauses the sandbox once the session has
 *     been idle long enough by the stamps the server trusts; one less than
 *     a minute ahead counts as it is;
 *   - a session with no executions has no clock;
 *   - every session id is paged out, past one page;
 *   - the cheap read (recentActivity) answers as the full read does through
 *     creates, completions, deletions and a stamp ahead of the clock,
 *     reading only the look-back window, and by id the active runs and
 *     the run holding the latest stamp, so that run's delete, recover or
 *     rewritten completion is never missed; it lags only another recovered
 *     run and a run seen later than the look-back, never busier or later
 *     than the full read, and one full read heals it; a run stamped inside the look-back before one already seen is
 *     caught, and an ended run is decoded once; an entry untouched for ten
 *     minutes is dropped.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toBinary } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../boot/logger.js";
import { LIST_INDEXES } from "../../boot/list-indexes.js";
import type { Store } from "../../store/interface.js";
import { SqliteStore } from "../../store/sqlite/store.js";
import type { SessionActivity } from "../provisioner.js";
import {
  ENTRY_IDLE_EVICT_MS,
  FUTURE_STAMP_ALLOWANCE_MS,
  RECENT_LOOKBACK_MS,
  newStoreSessionActivityReader,
  sessionActivityOf,
} from "../session-activity.js";
import { decideIdle, type IdleAction } from "../substrate/idle-decision.js";

/** The reader's clock: after every stamp the tests write, unless one is meant to be later. */
const NOW = () => Date.parse("2026-10-03T13:00:00Z");

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "session-activity-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

function execution(
  id: string,
  sessionId: string,
  phase: ExecutionPhase,
  createdAt: Date,
  completedAt?: Date,
) {
  return create(AgentExecutionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentExecution",
    metadata: { id, name: id, org: "org-a" },
    spec: { sessionId, agentId: "agt_1", message: "hi" },
    status: {
      phase,
      completedAt: completedAt?.toISOString() ?? "",
      audit: { specAudit: { createdAt: timestampFromDate(createdAt) } },
    },
  });
}

async function save(...executions: ReturnType<typeof execution>[]) {
  for (const e of executions) {
    await store.saveResource(
      ApiResourceKind.agent_execution,
      e.metadata?.id ?? "",
      AgentExecutionSchema,
      e,
    );
  }
}

describe("activity(sessionId)", () => {
  it("is busy while any execution is active, whatever its age", async () => {
    await save(
      execution(
        "aex_1",
        "ses_a",
        ExecutionPhase.EXECUTION_COMPLETED,
        new Date("2026-10-03T10:00:00Z"),
        new Date("2026-10-03T10:05:00Z"),
      ),
      execution(
        "aex_2",
        "ses_a",
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        new Date("2026-10-01T09:00:00Z"),
      ),
    );
    const reader = newStoreSessionActivityReader(store, silentLogger, NOW);
    expect((await reader.activity("ses_a")).busy).toBe(true);
  });

  it("is idle once every execution ended, its clock the latest stamp of that session", async () => {
    await save(
      execution(
        "aex_1",
        "ses_a",
        ExecutionPhase.EXECUTION_COMPLETED,
        new Date("2026-10-03T10:00:00Z"),
        new Date("2026-10-03T10:05:00Z"),
      ),
      execution(
        "aex_2",
        "ses_a",
        ExecutionPhase.EXECUTION_FAILED,
        new Date("2026-10-03T10:06:00Z"),
        new Date("2026-10-03T10:07:30Z"),
      ),
      execution(
        "aex_3",
        "ses_b",
        ExecutionPhase.EXECUTION_COMPLETED,
        new Date("2026-10-03T12:00:00Z"),
        new Date("2026-10-03T12:01:00Z"),
      ),
    );
    const reader = newStoreSessionActivityReader(store, silentLogger, NOW);
    expect(await reader.activity("ses_a")).toEqual({
      busy: false,
      lastActiveAt: new Date("2026-10-03T10:07:30Z"),
    });
  });

  it("has no clock for a session with no executions", async () => {
    const reader = newStoreSessionActivityReader(store, silentLogger, NOW);
    expect(await reader.activity("ses_none")).toEqual({
      busy: false,
      lastActiveAt: undefined,
    });
  });
});

describe("a row that does not decode", () => {
  it("is skipped with a warning, and the session's other executions still count", async () => {
    const warnings: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: () => {},
      sink: (entry) => warnings.push(entry.message),
    });
    const good = execution(
      "aex_1",
      "ses_a",
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      new Date("2026-10-03T10:00:00Z"),
    );
    const stub = {
      queryResources: async () => [
        { id: "aex_bad", data: new Uint8Array([0xff, 0xff, 0xff]), cursor: "" },
        {
          id: "aex_1",
          data: toBinary(AgentExecutionSchema, good),
          cursor: "",
        },
      ],
    } as unknown as Store;
    const reader = newStoreSessionActivityReader(stub, logger, NOW);
    expect((await reader.activity("ses_a")).busy).toBe(true);
    expect(warnings).toContain("Failed to unmarshal execution, skipping");
  });
});

describe("sessionActivityOf", () => {
  it("falls back to the creation stamp when an execution has no completion, and ignores an unparsable one", () => {
    expect(
      sessionActivityOf(
        [
          execution(
            "aex_1",
            "s",
            ExecutionPhase.EXECUTION_CANCELLED,
            new Date("2026-10-03T08:00:00Z"),
          ),
          create(AgentExecutionSchema, {
            status: {
              phase: ExecutionPhase.EXECUTION_COMPLETED,
              completedAt: "not a time",
            },
          }),
          create(AgentExecutionSchema, {}),
        ],
        NOW(),
      ),
    ).toEqual({ busy: false, lastActiveAt: new Date("2026-10-03T08:00:00Z") });
  });
});

describe("a stamp ahead of the server's clock", () => {
  const PAUSE_AFTER_MS = 5 * 60_000;
  const created = new Date("2026-10-03T12:00:00Z");

  /** The idle ladder's answer for a running sandbox, from the reader at `nowMs`. */
  async function ladderAt(nowMs: number): Promise<IdleAction> {
    const reader = newStoreSessionActivityReader(
      store,
      silentLogger,
      () => nowMs,
    );
    const activity = await reader.activity("ses_a");
    return decideIdle({
      state: "running",
      busy: activity.busy,
      lastActiveAt: activity.lastActiveAt ?? new Date(0),
      now: new Date(nowMs),
      pauseAfterMs: PAUSE_AFTER_MS,
      suspendAfterMs: 30 * 60_000,
    });
  }

  it("is skipped when it is more than the allowance ahead, so the sandbox still pauses on time", async () => {
    await save(
      execution(
        "aex_1",
        "ses_a",
        ExecutionPhase.EXECUTION_COMPLETED,
        created,
        new Date("2026-10-04T12:00:00Z"),
      ),
    );
    const t = created.getTime();
    expect(await ladderAt(t + PAUSE_AFTER_MS - 1)).toBe("none");
    expect(await ladderAt(t + PAUSE_AFTER_MS)).toBe("pause");
  });

  it("counts as it is when it is within the allowance, keeping the sandbox awake at most that much longer", async () => {
    const ahead = FUTURE_STAMP_ALLOWANCE_MS - 1_000;
    const t = created.getTime();
    // A long turn: created ten minutes ago, its completion stamped by a
    // runner whose clock runs a little ahead.
    await save(
      execution(
        "aex_1",
        "ses_a",
        ExecutionPhase.EXECUTION_COMPLETED,
        new Date(t - 10 * 60_000),
        new Date(t + ahead),
      ),
    );
    // Read while the completion is still ahead: it counts (skipping it
    // would leave the ten-minute-old creation and pause the sandbox).
    expect(await ladderAt(t)).toBe("none");
    expect(await ladderAt(t + ahead + PAUSE_AFTER_MS - 1)).toBe("none");
    expect(await ladderAt(t + ahead + PAUSE_AFTER_MS)).toBe("pause");
  });
});

describe("sessionIds()", () => {
  it("pages out every session id, across more than one page", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 503; i += 1) {
      const id = `ses_${String(i).padStart(4, "0")}`;
      ids.push(id);
      await store.saveResource(
        ApiResourceKind.session,
        id,
        SessionSchema,
        create(SessionSchema, { metadata: { id, name: id, org: "org-a" } }),
      );
    }
    const reader = newStoreSessionActivityReader(store, silentLogger, NOW);
    const seen: string[] = [];
    for await (const id of reader.sessionIds()) seen.push(id);
    expect(seen.sort()).toEqual(ids);
  });
});

describe("recentActivity(sessionId)", () => {
  const T0 = Date.parse("2026-10-03T12:00:00Z");
  const PASS_MS = 30_000;
  const at = (ms: number) => new Date(T0 + ms);

  /**
   * The reader under test over a store that counts what each read hands
   * out, and can corrupt a row's bytes on its next read so a test can
   * prove the reader never decodes it again.
   */
  function rig() {
    let t = T0;
    const clock = () => t;
    const counts = { rows: 0, byId: 0 };
    const corrupt = new Set<string>();
    const warnings: string[] = [];
    const counted = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "queryResources") {
          return async (...args: Parameters<Store["queryResources"]>) => {
            const rows = await target.queryResources(...args);
            counts.rows += rows.length;
            return rows.map((row) =>
              corrupt.has(row.id)
                ? { ...row, data: new Uint8Array([0xff, 0xff, 0xff]) }
                : row,
            );
          };
        }
        if (prop === "getResource") {
          return (...args: Parameters<Store["getResource"]>) => {
            counts.byId += 1;
            return target.getResource(...args);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: () => {},
      sink: (entry) => warnings.push(entry.message),
    });
    const reader = newStoreSessionActivityReader(counted, logger, clock);
    /** The full read from a reader with no memory: the answer the cheap read owes. */
    const truth = (): Promise<SessionActivity> =>
      newStoreSessionActivityReader(store, silentLogger, clock).activity(
        "ses_a",
      );
    return {
      reader,
      counts,
      corrupt,
      warnings,
      truth,
      advance: (ms: number) => {
        t += ms;
      },
      now: () => t,
    };
  }

  /** Never busier, never later than the full read. */
  function leansToAct(cheap: SessionActivity, full: SessionActivity): void {
    if (cheap.busy) expect(full.busy).toBe(true);
    if (cheap.lastActiveAt !== undefined) {
      expect(full.lastActiveAt).toBeDefined();
      expect(cheap.lastActiveAt.getTime()).toBeLessThanOrEqual(
        full.lastActiveAt?.getTime() ?? Number.NaN,
      );
    }
  }

  it("answers as the full read does through creates, completions, deletions and a stamp ahead of the clock", async () => {
    const r = rig();
    const steps: Array<[string, () => Promise<void>]> = [
      ["no runs yet", async () => {}],
      [
        "a turn starts",
        () =>
          save(
            execution(
              "aex_1",
              "ses_a",
              ExecutionPhase.EXECUTION_IN_PROGRESS,
              at(0),
            ),
          ),
      ],
      [
        "it ends",
        () =>
          save(
            execution(
              "aex_1",
              "ses_a",
              ExecutionPhase.EXECUTION_COMPLETED,
              at(0),
              at(40_000),
            ),
          ),
      ],
      [
        "another session's run changes nothing",
        () =>
          save(
            execution(
              "aex_x",
              "ses_b",
              ExecutionPhase.EXECUTION_IN_PROGRESS,
              at(60_000),
            ),
          ),
      ],
      [
        "a second turn waits for approval",
        () =>
          save(
            execution(
              "aex_2",
              "ses_a",
              ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
              at(90_000),
            ),
          ),
      ],
      [
        "time passes with the turn still waiting, past the look-back",
        async () => {},
      ],
      [
        "it ends, its completion stamped by a runner two minutes ahead",
        () =>
          save(
            execution(
              "aex_2",
              "ses_a",
              ExecutionPhase.EXECUTION_FAILED,
              at(90_000),
              new Date(r.now() + 2 * 60_000),
            ),
          ),
      ],
      ["the clock reaches the stamp less the allowance", async () => {}],
      [
        "a late report rewrites the latest completion earlier",
        () =>
          save(
            execution(
              "aex_2",
              "ses_a",
              ExecutionPhase.EXECUTION_FAILED,
              at(90_000),
              at(100_000),
            ),
          ),
      ],
      [
        "the run holding the latest stamp is recovered",
        () =>
          save(
            execution(
              "aex_2",
              "ses_a",
              ExecutionPhase.EXECUTION_IN_PROGRESS,
              at(90_000),
            ),
          ),
      ],
      [
        "it fails again",
        () =>
          save(
            execution(
              "aex_2",
              "ses_a",
              ExecutionPhase.EXECUTION_FAILED,
              at(90_000),
              new Date(r.now()),
            ),
          ),
      ],
      [
        "a third turn is deleted while it runs",
        async () => {
          await save(
            execution(
              "aex_3",
              "ses_a",
              ExecutionPhase.EXECUTION_IN_PROGRESS,
              new Date(r.now()),
            ),
          );
        },
      ],
      [
        "(deleted)",
        () => store.deleteResource(ApiResourceKind.agent_execution, "aex_3"),
      ],
      [
        "the run holding the latest stamp is deleted",
        () => store.deleteResource(ApiResourceKind.agent_execution, "aex_2"),
      ],
      [
        "the last run is deleted",
        () => store.deleteResource(ApiResourceKind.agent_execution, "aex_1"),
      ],
    ];
    for (const [step, act] of steps) {
      await act();
      const cheap = await r.reader.recentActivity("ses_a");
      expect({ step, ...cheap }).toEqual({ step, ...(await r.truth()) });
      r.advance(
        step.startsWith("time passes")
          ? 4 * PASS_MS + RECENT_LOOKBACK_MS
          : PASS_MS,
      );
      if (step.startsWith("the clock reaches")) r.advance(60_000);
    }
  });

  it("reads only the look-back window and the active runs by id once it has read a session", async () => {
    const r = rig();
    for (let i = 0; i < 20; i += 1) {
      await save(
        execution(
          `aex_${String(i).padStart(2, "0")}`,
          "ses_a",
          ExecutionPhase.EXECUTION_COMPLETED,
          at(-60 * 60_000 + i * 60_000),
          at(-60 * 60_000 + i * 60_000 + 30_000),
        ),
      );
    }
    await save(
      execution(
        "aex_old",
        "ses_a",
        ExecutionPhase.EXECUTION_PAUSED,
        at(-90 * 60_000),
      ),
    );
    await r.reader.recentActivity("ses_a");
    expect(r.counts).toEqual({ rows: 21, byId: 0 });
    r.advance(PASS_MS);
    const counts = { ...r.counts };
    expect(await r.reader.recentActivity("ses_a")).toEqual(await r.truth());
    // Nothing new: an empty window; the one active run and the run
    // holding the latest stamp, each read by id.
    expect({
      rows: r.counts.rows - counts.rows,
      byId: r.counts.byId - counts.byId,
    }).toEqual({ rows: 0, byId: 2 });
  });

  it("re-reads the run holding the latest stamp once it is older than the window", async () => {
    const r = rig();
    await save(
      execution(
        "aex_1",
        "ses_a",
        ExecutionPhase.EXECUTION_COMPLETED,
        at(-60 * 60_000),
        at(-50 * 60_000),
      ),
    );
    await r.reader.recentActivity("ses_a");
    r.advance(PASS_MS);
    const before = r.counts.byId;
    expect(await r.reader.recentActivity("ses_a")).toEqual(await r.truth());
    expect(r.counts.byId - before).toBe(1);
  });

  it("lags a recovered run and a run seen later than the look-back, toward acting, and one full read heals it", async () => {
    const cases: Array<[string, () => Promise<void>]> = [
      [
        "an old failed run recovered, not the one holding the latest stamp",
        () =>
          save(
            execution(
              "aex_1",
              "ses_a",
              ExecutionPhase.EXECUTION_IN_PROGRESS,
              at(-60 * 60_000),
            ),
          ),
      ],
      [
        "a run first seen long after its stamp",
        () =>
          save(
            execution(
              "aex_2",
              "ses_a",
              ExecutionPhase.EXECUTION_IN_PROGRESS,
              at(-RECENT_LOOKBACK_MS - PASS_MS - 1_000),
            ),
          ),
      ],
    ];
    for (const [name, act] of cases) {
      await store.deleteResourcesByKind(ApiResourceKind.agent_execution);
      await save(
        execution(
          "aex_1",
          "ses_a",
          ExecutionPhase.EXECUTION_FAILED,
          at(-60 * 60_000),
          at(-59 * 60_000),
        ),
        execution(
          "aex_9",
          "ses_a",
          ExecutionPhase.EXECUTION_COMPLETED,
          at(-30 * 60_000),
          at(-29 * 60_000),
        ),
      );
      const r = rig();
      await r.reader.recentActivity("ses_a");
      r.advance(PASS_MS);
      await act();
      const cheap = await r.reader.recentActivity("ses_a");
      const full = await r.truth();
      expect({ name, busy: cheap.busy, full: full.busy }).toEqual({
        name,
        busy: false,
        full: true,
      });
      leansToAct(cheap, full);
      expect(await r.reader.activity("ses_a")).toEqual(full);
      r.advance(PASS_MS);
      expect(await r.reader.recentActivity("ses_a")).toEqual(await r.truth());
    }
  });

  it("catches a run stamped inside the look-back before one already seen, and decodes an ended run once", async () => {
    const r = rig();
    await save(
      execution(
        "aex_1",
        "ses_a",
        ExecutionPhase.EXECUTION_COMPLETED,
        at(0),
        at(10_000),
      ),
      execution(
        "aex_2",
        "ses_a",
        ExecutionPhase.EXECUTION_COMPLETED,
        at(5_000),
        at(20_000),
      ),
    );
    await r.reader.recentActivity("ses_a");
    r.advance(PASS_MS);
    // Stamped a minute before the runs already seen, saved only now.
    await save(
      execution(
        "aex_0",
        "ses_a",
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        at(-60_000),
      ),
    );
    // aex_1 is ended and not the latest: were it decoded again, its bytes
    // would warn.
    r.corrupt.add("aex_1");
    expect(await r.reader.recentActivity("ses_a")).toEqual({
      busy: true,
      lastActiveAt: at(20_000),
    });
    expect(r.warnings).toEqual([]);
  });

  it("counts a held-back stamp only while its run still carries it", async () => {
    const cases: Array<[string, () => Promise<void>]> = [
      [
        "a late report rewrote the completion",
        () =>
          save(
            execution(
              "aex_2",
              "ses_a",
              ExecutionPhase.EXECUTION_COMPLETED,
              at(-20 * 60_000),
              at(-19 * 60_000),
            ),
          ),
      ],
      [
        "the run was deleted",
        () => store.deleteResource(ApiResourceKind.agent_execution, "aex_2"),
      ],
    ];
    for (const [name, act] of cases) {
      await store.deleteResourcesByKind(ApiResourceKind.agent_execution);
      await save(
        execution(
          "aex_1",
          "ses_a",
          ExecutionPhase.EXECUTION_COMPLETED,
          at(-10 * 60_000),
          at(-9 * 60_000),
        ),
        // A runner whose clock is five minutes ahead stamped its end.
        execution(
          "aex_2",
          "ses_a",
          ExecutionPhase.EXECUTION_COMPLETED,
          at(-20 * 60_000),
          at(5 * 60_000),
        ),
      );
      const r = rig();
      await r.reader.recentActivity("ses_a");
      await act();
      for (let pass = 0; pass < 12; pass += 1) {
        r.advance(PASS_MS);
        const cheap = await r.reader.recentActivity("ses_a");
        expect({ name, pass, ...cheap }).toEqual({
          name,
          pass,
          ...(await r.truth()),
        });
      }
    }
  });

  it("drops an entry no read has touched for ten minutes, so a stale memory is never read from", async () => {
    const r = rig();
    await save(
      execution(
        "aex_1",
        "ses_a",
        ExecutionPhase.EXECUTION_FAILED,
        at(-60 * 60_000),
        at(-59 * 60_000),
      ),
    );
    await r.reader.recentActivity("ses_a");
    r.advance(ENTRY_IDLE_EVICT_MS - 1);
    await r.reader.recentActivity("ses_b");
    r.advance(1);
    // A recover the cheap read would lag behind, were the entry still kept.
    await save(
      execution(
        "aex_1",
        "ses_a",
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        at(-60 * 60_000),
      ),
    );
    expect((await r.reader.recentActivity("ses_a")).busy).toBe(true);
  });
});
