/**
 * Pins the stalled-run checker (stalled-runs.ts) on the sqlite store, with
 * a stub engine and the test's own clock:
 *
 *   - a working run whose workflow is not found, or closed, ends FAILED
 *     with the platform's cause and an end time, and the observers hear it;
 *     one whose workflow is open is untouched;
 *   - a run younger than the minimum age, one waiting for approval and
 *     one with no creation stamp are never asked about;
 *   - one run is asked about once per recheck window;
 *   - a disconnected engine is asked nothing;
 *   - a run that completed between the ask and the write keeps COMPLETED;
 *   - an ask that throws skips that run and the pass goes on;
 *   - the read pages through more working runs than one page holds.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import type { RunStatusTransition } from "../../../extensions/status-hooks.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import {
  createRunAppendingEvents,
  updateRunAppendingEvents,
} from "../../session/events/run-writes.js";
import type {
  ConnectedExecutionEngine,
  ExecutionEngineState,
  WorkflowLiveness,
} from "../engine.js";
import { ENGINE_DISCONNECTED } from "../engine.js";
import {
  STALLED_RUN_MIN_AGE_MS,
  STALLED_RUN_PAGE,
  STALLED_RUN_RECHECK_MS,
  StalledRunChecker,
} from "../stalled-runs.js";
import type { StalledRunCheckerDeps } from "../stalled-runs.js";
import { WORKFLOW_GONE_ERROR } from "../workflow-gone.js";
import { stubConnectedEngine } from "./engine-stub.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const NOW_MS = Date.parse("2026-11-17T12:00:00Z");
const OLD_MS = NOW_MS - STALLED_RUN_MIN_AGE_MS - 60 * 1000;

let temp: TempStore;
let observed: RunStatusTransition[];
let asked: string[];
let clockMs: number;

beforeEach(() => {
  temp = tempStore();
  observed = [];
  asked = [];
  clockMs = NOW_MS;
});

afterEach(async () => {
  await temp.cleanup();
});

/** An engine answering from `answers` by run id (open when absent), recording every ask. */
function engine(
  answers: Record<string, WorkflowLiveness | Error> = {},
  before?: (runId: string) => Promise<void>,
): ConnectedExecutionEngine {
  return stubConnectedEngine({
    workflowLiveness: async (runId) => {
      asked.push(runId);
      await before?.(runId);
      const answer = answers[runId] ?? "open";
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
}

function checker(state: ExecutionEngineState): StalledRunChecker {
  const deps: StalledRunCheckerDeps = {
    store: temp.store,
    logger: silentLogger,
    sessionEventBroker: new SessionEventBroker(silentLogger),
    statusObservers: [(transition) => void observed.push(transition)],
    engineState: () => state,
    now: () => new Date(clockMs),
  };
  return new StalledRunChecker(deps);
}

function connected(e: ConnectedExecutionEngine): ExecutionEngineState {
  return { connected: true, engine: e };
}

/** `createdMs` null: a run with no creation stamp. */
function run(id: string, sessionId: string, createdMs: number | null): Run {
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: { id, org: "acme" },
    spec: {
      target:
        sessionId === ""
          ? { case: undefined }
          : { case: "sessionId", value: sessionId },
      message: id,
    },
    status: {
      phase: RunPhase.RUN_PENDING,
      ...(createdMs === null
        ? {}
        : {
            audit: {
              specAudit: {
                createdAt: {
                  seconds: BigInt(Math.floor(createdMs / 1000)),
                  nanos: 0,
                },
              },
            },
          }),
    },
  });
}

async function seed(
  id: string,
  phase: RunPhase,
  createdMs: number | null = OLD_MS,
  sessionId = `ses_${id}`,
): Promise<void> {
  const deps = {
    store: temp.store,
    sessionEventBroker: new SessionEventBroker(silentLogger),
  };
  await createRunAppendingEvents(deps, run(id, sessionId, createdMs));
  if (phase !== RunPhase.RUN_PENDING) {
    await updateRunAppendingEvents(deps, id, (r) => {
      r.status!.phase = phase;
    });
  }
}

async function stored(id: string): Promise<Run> {
  return temp.store.getResource(ApiResourceKind.run, id, RunSchema);
}

describe("StalledRunChecker.runPass", () => {
  it("ends a working run whose workflow is not found, as the platform's fault, and tells the observers", async () => {
    await seed("run_gone", RunPhase.RUN_IN_PROGRESS);

    await checker(connected(engine({ run_gone: "not_found" }))).runPass();

    expect(asked).toEqual(["run_gone"]);
    const ended = await stored("run_gone");
    expect(ended.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect([
      ended.status?.error,
      ended.status?.stopCause,
      ended.status?.stopDetail?.kind,
    ]).toEqual([WORKFLOW_GONE_ERROR, "failed", "internal"]);
    expect(ended.status?.completedAt).not.toBe("");
    expect(
      observed.map((t) => [t.oldPhase, t.newPhase, t.run.metadata?.id]),
    ).toEqual([[RunPhase.RUN_IN_PROGRESS, RunPhase.RUN_FAILED, "run_gone"]]);
  });

  it("ends a pending run whose workflow closed, and leaves one whose workflow is open", async () => {
    await seed("run_closed", RunPhase.RUN_PENDING);
    await seed("run_open", RunPhase.RUN_IN_PROGRESS);

    await checker(connected(engine({ run_closed: "closed" }))).runPass();

    expect([...asked].sort()).toEqual(["run_closed", "run_open"]);
    expect((await stored("run_closed")).status?.phase).toBe(
      RunPhase.RUN_FAILED,
    );
    expect((await stored("run_open")).status?.phase).toBe(
      RunPhase.RUN_IN_PROGRESS,
    );
  });

  it("never asks about a run younger than the minimum age, one waiting for approval, or one with no creation stamp", async () => {
    await seed(
      "run_young",
      RunPhase.RUN_IN_PROGRESS,
      NOW_MS - STALLED_RUN_MIN_AGE_MS + 60 * 1000,
    );
    await seed("run_waiting", RunPhase.RUN_WAITING_FOR_APPROVAL);
    await seed("run_unstamped", RunPhase.RUN_IN_PROGRESS, null);

    await checker(
      connected(
        engine({
          run_young: "not_found",
          run_waiting: "not_found",
          run_unstamped: "not_found",
        }),
      ),
    ).runPass();

    expect(asked).toEqual([]);
    expect((await stored("run_young")).status?.phase).toBe(
      RunPhase.RUN_IN_PROGRESS,
    );
    expect((await stored("run_waiting")).status?.phase).toBe(
      RunPhase.RUN_WAITING_FOR_APPROVAL,
    );
  });

  it("asks about one run once per recheck window", async () => {
    await seed("run_long", RunPhase.RUN_IN_PROGRESS);
    const check = checker(connected(engine()));

    await check.runPass();
    clockMs += STALLED_RUN_RECHECK_MS - 1000;
    await check.runPass();
    expect(asked).toEqual(["run_long"]);

    clockMs += 1000;
    await check.runPass();
    expect(asked).toEqual(["run_long", "run_long"]);
  });

  it("asks nothing while the engine is disconnected", async () => {
    await seed("run_gone", RunPhase.RUN_IN_PROGRESS);
    await checker(ENGINE_DISCONNECTED).runPass();
    expect((await stored("run_gone")).status?.phase).toBe(
      RunPhase.RUN_IN_PROGRESS,
    );
    expect(observed).toEqual([]);
  });

  it("keeps the ending of a run that completed between the ask and the write", async () => {
    await seed("run_raced", RunPhase.RUN_IN_PROGRESS);
    const finishes = async (runId: string): Promise<void> => {
      await updateRunAppendingEvents(
        {
          store: temp.store,
          sessionEventBroker: new SessionEventBroker(silentLogger),
        },
        runId,
        (r) => {
          r.status!.phase = RunPhase.RUN_COMPLETED;
        },
      );
    };

    await checker(
      connected(engine({ run_raced: "closed" }, finishes)),
    ).runPass();

    const kept = await stored("run_raced");
    expect([kept.status?.phase, kept.status?.stopCause]).toEqual([
      RunPhase.RUN_COMPLETED,
      "",
    ]);
    expect(observed).toEqual([]);
  });

  it("skips a run whose ask throws and goes on with the pass", async () => {
    await seed("run_a", RunPhase.RUN_IN_PROGRESS, OLD_MS);
    await seed("run_b", RunPhase.RUN_IN_PROGRESS, OLD_MS - 1000);

    await checker(
      connected(
        engine({ run_a: new Error("deadline exceeded"), run_b: "not_found" }),
      ),
    ).runPass();

    expect(asked).toEqual(["run_a", "run_b"]);
    expect((await stored("run_a")).status?.phase).toBe(
      RunPhase.RUN_IN_PROGRESS,
    );
    expect((await stored("run_b")).status?.phase).toBe(RunPhase.RUN_FAILED);
  });

  it("reads every working run across pages", async () => {
    const count = STALLED_RUN_PAGE + 5;
    for (let i = 0; i < count; i++) {
      await seed(
        `run_${String(i).padStart(4, "0")}`,
        RunPhase.RUN_IN_PROGRESS,
        OLD_MS - i * 1000,
        "",
      );
    }
    await checker(connected(engine())).runPass();
    expect(new Set(asked).size).toBe(count);
  });
});

describe("StalledRunChecker lifecycle", () => {
  it("runs passes on its interval once started, and none after stop", async () => {
    await seed("run_gone", RunPhase.RUN_IN_PROGRESS);
    const deps: StalledRunCheckerDeps = {
      store: temp.store,
      logger: silentLogger,
      sessionEventBroker: new SessionEventBroker(silentLogger),
      statusObservers: [],
      engineState: () => connected(engine({ run_gone: "not_found" })),
      now: () => new Date(clockMs),
      intervalMs: 5,
    };
    const check = new StalledRunChecker(deps);
    check.start();
    const deadline = Date.now() + 5000;
    while (
      (await stored("run_gone")).status?.phase !== RunPhase.RUN_FAILED &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await check.stop();
    expect((await stored("run_gone")).status?.phase).toBe(RunPhase.RUN_FAILED);
    const askedAtStop = asked.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(asked.length).toBe(askedAtStop);
  });
});
