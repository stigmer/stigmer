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
 *   - every session id is paged out, past one page.
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
import {
  FUTURE_STAMP_ALLOWANCE_MS,
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
