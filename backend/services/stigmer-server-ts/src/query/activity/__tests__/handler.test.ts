/**
 * Pins the activity handler against Go's
 * pkg/query/activity/handler/handler_test.go, case-for-case: the two-kind
 * newest-first merge, the projection fields, the subject sentinels, the
 * runtime-origin exclusions, the page-size table (default 30 / cap 100 —
 * the constants conformance deliberately does not drive over the wire),
 * the timestamp fallback + tie ordering (sessions before executions), the
 * empty store, and the resolvePhase / timestampAfter tables.
 */
import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ListRecentActivityRequestSchema } from "@stigmer/protos/ai/stigmer/activity/v1/io_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  tempStore,
  type TempStore,
} from "../../../store/sqlite/__tests__/support.js";
import {
  ActivityHandler,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  normalizePageSize,
  resolvePhase,
  resolveSubject,
  timestampAfter,
} from "../handler.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => undefined,
});

function request(pageSize: number) {
  return create(ListRecentActivityRequestSchema, { pageSize, org: "" });
}

let temp: TempStore;
let handler: ActivityHandler;

beforeEach(() => {
  temp = tempStore();
  handler = new ActivityHandler(temp.store, silentLogger);
});

afterEach(async () => {
  await temp.cleanup();
});

async function seedSession(
  id: string,
  opts?: {
    subject?: string;
    labels?: Record<string, string>;
    statusUpdatedAtSeconds?: number;
    statusUpdatedAtNanos?: number;
    specCreatedAtSeconds?: number;
  },
): Promise<void> {
  const statusAudit =
    opts?.statusUpdatedAtSeconds === undefined
      ? undefined
      : {
          updatedAt: {
            seconds: BigInt(opts.statusUpdatedAtSeconds),
            nanos: opts.statusUpdatedAtNanos ?? 0,
          },
        };
  const specAudit =
    opts?.specCreatedAtSeconds === undefined
      ? undefined
      : { createdAt: { seconds: BigInt(opts.specCreatedAtSeconds) } };
  const session = create(SessionSchema, {
    metadata: { id, name: id, org: "acme", labels: opts?.labels ?? {} },
    spec: { subject: opts?.subject ?? "", agentInstanceId: "agi_test" },
    status: { audit: { statusAudit, specAudit } },
  });
  await temp.store.saveResource(
    ApiResourceKind.session,
    id,
    SessionSchema,
    session,
  );
}

async function seedExecution(
  id: string,
  opts?: {
    name?: string;
    phase?: ExecutionPhase;
    statusUpdatedAtSeconds?: number;
  },
): Promise<void> {
  const execution = create(WorkflowExecutionSchema, {
    metadata: { id, name: opts?.name ?? id, org: "acme" },
    status: {
      phase: opts?.phase ?? ExecutionPhase.EXECUTION_COMPLETED,
      audit:
        opts?.statusUpdatedAtSeconds === undefined
          ? undefined
          : {
              statusAudit: {
                updatedAt: { seconds: BigInt(opts.statusUpdatedAtSeconds) },
              },
            },
    },
  });
  await temp.store.saveResource(
    ApiResourceKind.workflow_execution,
    id,
    WorkflowExecutionSchema,
    execution,
  );
}

describe("listRecentActivity (Go handler_test.go)", () => {
  it("merges both kinds newest-first", async () => {
    await seedSession("ses_old", {
      subject: "oldest",
      statusUpdatedAtSeconds: 100,
    });
    await seedExecution("wfe_mid", { statusUpdatedAtSeconds: 200 });
    await seedSession("ses_new", {
      subject: "newest",
      statusUpdatedAtSeconds: 300,
    });

    const response = await handler.listRecentActivity(request(100));

    expect(response.entries.map((entry) => entry.id)).toEqual([
      "ses_new",
      "wfe_mid",
      "ses_old",
    ]);
  });

  it("projects the sidebar fields per kind", async () => {
    await seedSession("ses_1", {
      subject: "Plan the migration",
      statusUpdatedAtSeconds: 100,
    });
    await seedExecution("wfe_1", {
      name: "nightly-sync",
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      statusUpdatedAtSeconds: 200,
    });

    const response = await handler.listRecentActivity(request(100));

    const session = response.entries.find((entry) => entry.id === "ses_1");
    expect(session?.type).toBe("session");
    expect(session?.subject).toBe("Plan the migration");
    expect(session?.status).toBe("");
    expect(session?.updatedAt).toBeDefined();

    const execution = response.entries.find((entry) => entry.id === "wfe_1");
    expect(execution?.type).toBe("workflow_execution");
    expect(execution?.subject).toBe("nightly-sync");
    expect(execution?.status).toBe("running");
  });

  it("maps the subject sentinels to display placeholders", async () => {
    await seedSession("ses_auto", {
      subject: "Auto-created session",
      statusUpdatedAtSeconds: 100,
    });
    await seedSession("ses_empty", {
      subject: "",
      statusUpdatedAtSeconds: 200,
    });
    await seedExecution("wfe_unnamed", {
      name: "",
      statusUpdatedAtSeconds: 300,
    });

    const response = await handler.listRecentActivity(request(100));
    const byId = new Map(response.entries.map((entry) => [entry.id, entry]));

    expect(byId.get("ses_auto")?.subject).toBe("Untitled session");
    expect(byId.get("ses_empty")?.subject).toBe("Untitled session");
    expect(byId.get("wfe_unnamed")?.subject).toBe("Untitled execution");
  });

  it("excludes runtime-origin sessions for every label key", async () => {
    await seedSession("ses_console", {
      subject: "personal",
      statusUpdatedAtSeconds: 100,
    });
    const labeled: Array<[id: string, key: string]> = [
      ["ses_channel", "stigmer.ai/channel-id"],
      ["ses_share", "stigmer.ai/share-id"],
      ["ses_guest", "stigmer.ai/guest-cookie-id"],
      ["ses_schedule", "stigmer.ai/schedule-id"],
    ];
    for (const [id, key] of labeled) {
      await seedSession(id, {
        subject: "runtime",
        labels: { [key]: "x" },
        statusUpdatedAtSeconds: 200,
      });
    }

    const response = await handler.listRecentActivity(request(100));
    const ids = response.entries.map((entry) => entry.id);

    expect(ids).toContain("ses_console");
    for (const [id] of labeled) {
      expect(ids, `${id} must be excluded`).not.toContain(id);
    }
  });

  it("trims to page_size keeping the newest; zero and negatives mean the default page", async () => {
    for (let i = 0; i < 3; i++) {
      await seedSession(`ses_${i}`, {
        subject: `s${i}`,
        statusUpdatedAtSeconds: 100 + i,
      });
    }

    const trimmed = await handler.listRecentActivity(request(1));
    expect(trimmed.entries.map((entry) => entry.id)).toEqual(["ses_2"]);

    for (const pageSize of [0, -5]) {
      const response = await handler.listRecentActivity(request(pageSize));
      expect(response.entries).toHaveLength(3);
    }

    const oversize = await handler.listRecentActivity(request(100_000));
    expect(oversize.entries).toHaveLength(3);
  });

  it("falls back to specAudit.createdAt when the status audit is unstamped", async () => {
    await seedSession("ses_stamped", {
      subject: "stamped",
      statusUpdatedAtSeconds: 100,
    });
    await seedSession("ses_fallback", {
      subject: "fallback",
      specCreatedAtSeconds: 200,
    });

    const response = await handler.listRecentActivity(request(100));

    expect(response.entries.map((entry) => entry.id)).toEqual([
      "ses_fallback",
      "ses_stamped",
    ]);
  });

  it("keeps sessions before executions on equal timestamps (stable sort)", async () => {
    await seedExecution("wfe_tie", { statusUpdatedAtSeconds: 100 });
    await seedSession("ses_tie", {
      subject: "tie",
      statusUpdatedAtSeconds: 100,
    });

    const response = await handler.listRecentActivity(request(100));

    // Sessions load first (Go's append order), and the stable sort keeps
    // insertion order on ties.
    expect(response.entries.map((entry) => entry.id)).toEqual([
      "ses_tie",
      "wfe_tie",
    ]);
  });

  it("answers an empty store with an empty page", async () => {
    const response = await handler.listRecentActivity(request(10));
    expect(response.entries).toEqual([]);
  });
});

describe("normalizePageSize (Go's table)", () => {
  it("folds out-of-range values into range", () => {
    expect(normalizePageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(-1)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(1)).toBe(1);
    expect(normalizePageSize(30)).toBe(30);
    expect(normalizePageSize(100)).toBe(MAX_PAGE_SIZE);
    expect(normalizePageSize(101)).toBe(MAX_PAGE_SIZE);
    expect(normalizePageSize(100_000)).toBe(MAX_PAGE_SIZE);
  });
});

describe("resolveSubject", () => {
  it("maps the sentinel and emptiness to the placeholder, passes real titles", () => {
    expect(resolveSubject("")).toBe("Untitled session");
    expect(resolveSubject("Auto-created session")).toBe("Untitled session");
    expect(resolveSubject("Real title")).toBe("Real title");
  });
});

describe("resolvePhase (Go's table)", () => {
  it("maps every phase to its badge token, unknowns to 'unknown'", () => {
    expect(resolvePhase(ExecutionPhase.EXECUTION_PENDING)).toBe("pending");
    expect(resolvePhase(ExecutionPhase.EXECUTION_IN_PROGRESS)).toBe("running");
    expect(resolvePhase(ExecutionPhase.EXECUTION_COMPLETED)).toBe("completed");
    expect(resolvePhase(ExecutionPhase.EXECUTION_FAILED)).toBe("failed");
    expect(resolvePhase(ExecutionPhase.EXECUTION_CANCELLED)).toBe("cancelled");
    expect(resolvePhase(ExecutionPhase.EXECUTION_TERMINATED)).toBe(
      "terminated",
    );
    expect(resolvePhase(ExecutionPhase.EXECUTION_PAUSED)).toBe("paused");
    expect(resolvePhase(ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED)).toBe(
      "unknown",
    );
    expect(resolvePhase(999 as ExecutionPhase)).toBe("unknown");
  });
});

describe("timestampAfter (Go's table)", () => {
  const ts = (seconds: number, nanos = 0) =>
    create(TimestampSchema, { seconds: BigInt(seconds), nanos });

  it("compares seconds first, then nanos, strictly", () => {
    expect(timestampAfter(ts(2), ts(1))).toBe(true);
    expect(timestampAfter(ts(1), ts(2))).toBe(false);
    expect(timestampAfter(ts(1, 5), ts(1, 3))).toBe(true);
    expect(timestampAfter(ts(1, 3), ts(1, 5))).toBe(false);
    // Strictly after: equality is false on both sides (the stable-sort
    // tie contract depends on it).
    expect(timestampAfter(ts(1, 1), ts(1, 1))).toBe(false);
    expect(timestampAfter(undefined, undefined)).toBe(false);
  });
});
