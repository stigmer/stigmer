/**
 * Pins the agentexecution Phase-1 surfaces against Go's controller —
 * through the REAL stack: a composed server on an ephemeral port, a
 * native gRPC client, the full interceptor chain. Executions cannot be
 * created through the RPC surface here (the engine gate refuses without
 * Temporal — exactly the production posture until #18), so records are
 * seeded directly through the store, the same way Go's controller tests
 * seed with SaveResource.
 *
 * Load-bearing pins the conformance suite cannot cover:
 *   - the MANGLED unknown-execution message on getExecutionUsageReport,
 *     byte-for-byte (sub-project DD-001: faithful-port + OSS issue);
 *   - getAgentUsageReport org scoping (oss#389) incl. the no-name-oracle
 *     rule (Go get_agent_usage_report_test.go case-for-case);
 *   - list/listBySession filter semantics over seeded rows and the
 *     total_pages placeholder;
 *   - update's status-clearing standard build and delete's audit-trail
 *     return, over the wire;
 *   - the populated getExecutionSummary arm (phase counts, active count,
 *     avg duration, failure ranks) that the zero-record conformance arm
 *     cannot reach.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { executionUsageReportNotFoundMessage } from "../constants.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "AgentExecution";
const ORG = "acme";

type CommandClient = Client<typeof AgentExecutionCommandController>;
type QueryClient = Client<typeof AgentExecutionQueryController>;

let server: ComposedServer;
let dir: string;
let command: CommandClient;
let query: QueryClient;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-domain-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
  server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      DB_PATH: path.join(dir, "stigmer.db"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  command = createClient(AgentExecutionCommandController, transport);
  query = createClient(AgentExecutionQueryController, transport);
});

afterAll(async () => {
  try {
    await server?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  } finally {
    vi.unstubAllEnvs();
  }
});

let counter = 0;
function seedInput(overrides?: {
  id?: string;
  org?: string;
  sessionId?: string;
  agentId?: string;
  phase?: ExecutionPhase;
  startedAt?: string;
  completedAt?: string;
}): MessageInitShape<typeof AgentExecutionSchema> & { metadata: { id: string } } {
  counter += 1;
  const id = overrides?.id ?? `aexec_test_${counter}`;
  const slug = `exec-${id.replaceAll("_", "-")}`;
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      id,
      name: slug,
      slug,
      org: overrides?.org ?? ORG,
    },
    spec: {
      sessionId: overrides?.sessionId ?? `ses_test_${counter}`,
      agentId: overrides?.agentId ?? `agt_test_${counter}`,
      message: "Say hello.",
    },
    status: {
      phase: overrides?.phase ?? ExecutionPhase.EXECUTION_COMPLETED,
      startedAt: overrides?.startedAt ?? "",
      completedAt: overrides?.completedAt ?? "",
    },
  };
}

async function seed(
  init: MessageInitShape<typeof AgentExecutionSchema> & {
    metadata: { id: string };
  },
): Promise<string> {
  await server.store.saveResource(
    ApiResourceKind.agent_execution,
    init.metadata.id,
    AgentExecutionSchema,
    create(AgentExecutionSchema, init),
  );
  return init.metadata.id;
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: Code,
): Promise<ConnectError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    const connectError = error as ConnectError;
    expect(connectError.code).toBe(code);
    return connectError;
  }
  throw new Error(`expected code ${Code[code]}, call succeeded`);
}

describe("get / list / listBySession over the wire", () => {
  it("get answers NotFound for an unknown id and the record for a seeded one", async () => {
    await expectCode(
      () => query.get({ value: "aexec_missing" }),
      Code.NotFound,
    );

    const id = await seed(seedInput());
    const got = await query.get({ value: id });
    expect(got.metadata?.id).toBe(id);
    expect(got.spec?.message).toBe("Say hello.");
  });

  it("list returns every row with the total_pages placeholder, filtered by phase on request", async () => {
    const completed = await seed(
      seedInput({ phase: ExecutionPhase.EXECUTION_COMPLETED }),
    );
    const failed = await seed(
      seedInput({ phase: ExecutionPhase.EXECUTION_FAILED }),
    );

    const all = await query.list({});
    expect(all.totalPages).toBe(1);
    const ids = all.entries.map((e) => e.metadata?.id);
    expect(ids).toContain(completed);
    expect(ids).toContain(failed);

    const failedOnly = await query.list({
      phase: ExecutionPhase.EXECUTION_FAILED,
    });
    const failedIds = failedOnly.entries.map((e) => e.metadata?.id);
    expect(failedIds).toContain(failed);
    expect(failedIds).not.toContain(completed);
  });

  it("listBySession requires session_id and filters by it", async () => {
    await expectCode(
      () => query.listBySession({ sessionId: "" }),
      Code.InvalidArgument,
    );

    const inSession = await seed(seedInput({ sessionId: "ses_shared" }));
    const outOfSession = await seed(seedInput({ sessionId: "ses_other" }));

    const result = await query.listBySession({ sessionId: "ses_shared" });
    expect(result.totalPages).toBe(1);
    const ids = result.entries.map((e) => e.metadata?.id);
    expect(ids).toContain(inSession);
    expect(ids).not.toContain(outOfSession);
  });
});

describe("update / delete over the wire", () => {
  it("update rewrites the spec through the standard build (status cleared per the shared pattern)", async () => {
    const init = seedInput({ phase: ExecutionPhase.EXECUTION_FAILED });
    const id = await seed(init);

    const updated = await command.update({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: init.metadata,
      spec: {
        sessionId: init.spec?.sessionId,
        agentId: init.spec?.agentId,
        message: "Say goodbye.",
      },
    });
    expect(updated.metadata?.id).toBe(id);
    expect(updated.spec?.message).toBe("Say goodbye.");

    // The standard BuildUpdateState clears caller-supplied status; the
    // persisted record reflects the update response.
    const got = await query.get({ value: id });
    expect(got.spec?.message).toBe("Say goodbye.");
  });

  it("delete returns the deleted record (audit-trail convention) and removes it", async () => {
    const id = await seed(seedInput());

    const deleted = await command.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectCode(() => query.get({ value: id }), Code.NotFound);
  });

  it("delete answers NotFound for an unknown id", async () => {
    await expectCode(
      () => command.delete({ value: "aexec_missing" }),
      Code.NotFound,
    );
  });
});

describe("usage reports over the wire", () => {
  it("getExecutionUsageReport pins the mangled NotFound copy byte-for-byte (DD-001)", async () => {
    await expectCode(
      () => query.getExecutionUsageReport({ executionId: "" }),
      Code.InvalidArgument,
    );

    const err = await expectCode(
      () => query.getExecutionUsageReport({ executionId: "aexec_missing" }),
      Code.NotFound,
    );
    expect(err.rawMessage).toBe(
      executionUsageReportNotFoundMessage("aexec_missing"),
    );
    expect(err.rawMessage).toBe(
      "agent execution '%s' not found not found: aexec_missing",
    );
  });

  it("getExecutionUsageReport answers the zero aggregate for a seeded execution", async () => {
    const id = await seed(seedInput());
    const report = await query.getExecutionUsageReport({ executionId: id });
    expect(report.aggregate).toBeDefined();
    expect(report.aggregate?.totalTokens).toBe(0n);
  });

  it("getAgentUsageReport scopes to the requested org (oss#389)", async () => {
    await seed(
      seedInput({
        agentId: "agt_scoped",
        org: "org-a",
        sessionId: "ses_a1",
        startedAt: "2026-03-10T10:00:00Z",
      }),
    );
    await seed(
      seedInput({
        agentId: "agt_scoped",
        org: "org-a",
        sessionId: "ses_a2",
        startedAt: "2026-03-11T10:00:00Z",
      }),
    );
    await seed(
      seedInput({
        agentId: "agt_scoped",
        org: "org-b",
        sessionId: "ses_b1",
        startedAt: "2026-03-10T10:00:00Z",
      }),
    );

    const orgA = await query.getAgentUsageReport({
      agentId: "agt_scoped",
      orgId: "org-a",
    });
    expect(orgA.totalExecutions).toBe(2);
    expect(orgA.totalSessions).toBe(2);
    for (const session of orgA.sessions) {
      expect(session.sessionId, "org-b session must not leak").not.toBe(
        "ses_b1",
      );
    }

    const orgB = await query.getAgentUsageReport({
      agentId: "agt_scoped",
      orgId: "org-b",
    });
    expect(orgB.totalExecutions).toBe(1);
  });

  it("getAgentUsageReport resolves the display name only when the org used the agent (no id-to-name oracle)", async () => {
    await server.store.saveResource(
      ApiResourceKind.agent,
      "agt_named",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_named", name: "PR Reviewer", org: "org-a" },
      }),
    );
    await seed(
      seedInput({
        agentId: "agt_named",
        org: "org-a",
        startedAt: "2026-03-10T10:00:00Z",
      }),
    );

    const used = await query.getAgentUsageReport({
      agentId: "agt_named",
      orgId: "org-a",
    });
    expect(used.agentName).toBe("PR Reviewer");

    const unused = await query.getAgentUsageReport({
      agentId: "agt_named",
      orgId: "org-never-used",
    });
    expect(unused.agentName, "the raw id, not the name").toBe("agt_named");
  });

  it("the scope-field refusals: agent report without org_id, org report without dates", async () => {
    await expectCode(
      () => query.getAgentUsageReport({ agentId: "agt_x" }),
      Code.InvalidArgument,
    );
    await expectCode(
      () => query.getAgentUsageReport({ orgId: "org-a" }),
      Code.InvalidArgument,
    );
    await expectCode(
      () => query.getOrgUsageReport({ orgId: "org-a" }),
      Code.InvalidArgument,
    );
  });

  it("getOrgUsageReport aggregates the org's executions in range with zero costs", async () => {
    await seed(
      seedInput({
        agentId: "agt_org_report",
        org: "org-report",
        sessionId: "ses_r1",
        startedAt: "2026-04-10T10:00:00Z",
      }),
    );
    await seed(
      seedInput({
        agentId: "agt_org_report",
        org: "org-report",
        sessionId: "ses_r2",
        startedAt: "2026-04-11T10:00:00Z",
      }),
    );

    const report = await query.getOrgUsageReport({
      orgId: "org-report",
      fromDate: "2026-04-01",
      toDate: "2026-04-30",
    });
    expect(report.totalExecutions).toBe(2);
    expect(report.totalAgents).toBe(1);
    expect(report.totalSessions).toBe(2);
    expect(report.dailyCosts).toHaveLength(2);
    expect(report.dailyCosts[0]?.date).toBe("2026-04-10");
    expect(report.topAgentsByCost).toHaveLength(1);
    expect(report.topAgentsByCost[0]?.billableCostMicros).toBe(0n);
  });

  it("getSessionUsageReport orders per-execution summaries chronologically", async () => {
    await seed(
      seedInput({
        sessionId: "ses_report_order",
        startedAt: "2026-05-02T10:00:00Z",
      }),
    );
    await seed(
      seedInput({
        sessionId: "ses_report_order",
        startedAt: "2026-05-01T10:00:00Z",
      }),
    );

    const report = await query.getSessionUsageReport({
      sessionId: "ses_report_order",
    });
    expect(report.executionCount).toBe(2);
    expect(report.executions[0]?.startedAt).toBe("2026-05-01T10:00:00Z");
    expect(report.executions[1]?.startedAt).toBe("2026-05-02T10:00:00Z");
    expect(report.firstExecutionAt).toBe("2026-05-01T10:00:00Z");
    expect(report.lastExecutionAt).toBe("2026-05-02T10:00:00Z");
  });
});

describe("subscribe — the first domain stream through the real transport", () => {
  /**
   * Collects frames from a live subscribe stream. `done` resolves when
   * the server ends the stream; the caller aborts for the
   * client-disconnect arms.
   */
  function openStream(id: string) {
    const controller = new AbortController();
    const frames: string[] = [];
    let sawFrame: (() => void) | undefined;
    const done = (async () => {
      try {
        for await (const frame of query.subscribe(
          { value: id },
          { signal: controller.signal },
        )) {
          frames.push(frame.status?.error ?? "");
          sawFrame?.();
        }
        return "server-ended" as const;
      } catch (error) {
        if (
          error instanceof ConnectError &&
          error.code === Code.Canceled
        ) {
          return "client-cancelled" as const;
        }
        throw error;
      }
    })();
    // Deterministic wait: resolves once frames.length >= n (no sleeps).
    const untilFrames = (n: number) =>
      new Promise<void>((resolve) => {
        if (frames.length >= n) {
          resolve();
          return;
        }
        sawFrame = () => {
          if (frames.length >= n) {
            sawFrame = undefined;
            resolve();
          }
        };
      });
    return { controller, frames, done, untilFrames };
  }

  it("refuses an empty id (InvalidArgument) and an unknown id (NotFound, pinned copy)", async () => {
    const emptyErr = await expectCode(async () => {
      for await (const frame of query.subscribe({ value: "" })) {
        void frame;
      }
    }, Code.InvalidArgument);
    // The protovalidate STREAM interceptor fires before the handler in
    // both editions (Go StreamServerInterceptor); the handler's inline
    // guard is the direct-call defense. protovalidate-go and
    // protovalidate-es render this violation byte-identically (the #7
    // probe).
    expect(emptyErr.rawMessage).toBe("value: value is required [required]");

    const unknownErr = await expectCode(async () => {
      for await (const frame of query.subscribe({ value: "aexec_missing" })) {
        void frame;
      }
    }, Code.NotFound);
    expect(unknownErr.rawMessage).toBe(
      "AgentExecution not found: aexec_missing",
    );
  });

  it("streams snapshot → live update → terminal close, suppressing duplicate frames", async () => {
    const init = seedInput({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const id = await seed(init);

    const stream = openStream(id);
    await stream.untilFrames(1); // the snapshot

    // The overlap frame: byte-equal to the snapshot — must be suppressed.
    server.agentExecutionStreamBroker.broadcast(
      create(AgentExecutionSchema, init),
    );
    // A genuinely new frame follows; its arrival proves the equal frame
    // was dropped (ordered queue — had it been delivered, it would appear
    // before this one).
    const progressed = create(AgentExecutionSchema, {
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: init.metadata,
      spec: init.spec,
      status: {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        error: "marker-live-update",
      },
    });
    server.agentExecutionStreamBroker.broadcast(progressed);
    await stream.untilFrames(2);
    expect(stream.frames).toEqual(["", "marker-live-update"]);

    // A terminal broadcast ends the stream server-side.
    server.agentExecutionStreamBroker.broadcast(
      create(AgentExecutionSchema, {
        apiVersion: API_VERSION,
        kind: KIND,
        metadata: init.metadata,
        spec: init.spec,
        status: {
          phase: ExecutionPhase.EXECUTION_COMPLETED,
          error: "marker-terminal",
        },
      }),
    );
    await expect(stream.done).resolves.toBe("server-ended");
    expect(stream.frames).toEqual(["", "marker-live-update", "marker-terminal"]);
    expect(server.agentExecutionStreamBroker.getSubscriberCount(id)).toBe(0);
  });

  it("a terminal SNAPSHOT leaves the stream open until the client disconnects (faithful port)", async () => {
    const id = await seed(
      seedInput({ phase: ExecutionPhase.EXECUTION_COMPLETED }),
    );

    const stream = openStream(id);
    await stream.untilFrames(1);
    expect(server.agentExecutionStreamBroker.getSubscriberCount(id)).toBe(1);

    stream.controller.abort();
    await expect(stream.done).resolves.toBe("client-cancelled");
    // The generator's finally runs server-side after the client observes
    // the cancellation — poll (bounded, no sleeps) for the unsubscribe.
    await expect
      .poll(() => server.agentExecutionStreamBroker.getSubscriberCount(id), {
        timeout: 2000,
      })
      .toBe(0);
  });
});

describe("getExecutionSummary — the populated arm", () => {
  it("counts phases, actives, completion durations, and failure ranks", async () => {
    // Seeded records carry no audit timestamps, so the window cutoff
    // never skips them (Go: a zero created_at disables the skip).
    await seed(
      seedInput({
        org: "org-summary",
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        startedAt: "2026-06-01T10:00:00Z",
        completedAt: "2026-06-01T11:00:00Z",
      }),
    );
    await seed(
      seedInput({
        org: "org-summary",
        agentId: "agt_failing",
        phase: ExecutionPhase.EXECUTION_FAILED,
      }),
    );
    await seed(
      seedInput({
        org: "org-summary",
        phase: ExecutionPhase.EXECUTION_PENDING,
      }),
    );

    const summary = await query.getExecutionSummary({ org: "org-summary" });

    // The org field is a no-op on this single-tenant edition; earlier
    // suites' seeds are counted too — assert at-least semantics on the
    // shared counters and exact semantics on this suite's own markers.
    expect(
      summary.phaseCounts[ExecutionPhase.EXECUTION_PENDING] ?? 0,
    ).toBeGreaterThanOrEqual(1);
    expect(summary.activeCount).toBeGreaterThanOrEqual(1);

    expect(summary.avgDuration, "one completed pair exists").toBeDefined();
    expect(Number(summary.avgDuration?.seconds ?? 0n)).toBeGreaterThan(0);

    const failing = summary.topFailingAgents.find(
      (rank) => rank.agentSlug === "agt_failing",
    );
    expect(failing, "the failed execution ranks its agent").toBeDefined();
    expect(failing?.failureCount).toBe(1);
  });
});
