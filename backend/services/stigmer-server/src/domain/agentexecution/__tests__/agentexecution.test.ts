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
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, fromBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ApprovalAction,
  ApprovalEventType,
  DiffCompleteness,
  ExecutionPhase,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
  FileReviewEventType,
  MessageType,
  ServiceTier,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { CapturedFileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  SubmitApprovalInputSchema,
  SubmitFileDecisionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { executionUsageReportNotFoundMessage } from "../constants.js";
import type { AgentExecutionStatusTransition } from "../../../extensions/status-hooks.js";
import type {
  ConnectedExecutionEngine,
  ExecutionEngineState,
} from "../engine.js";
import { EngineWorkflowNotFoundError } from "../engine.js";
import { aggregateDigest, fileDigest } from "../filereview/digest.js";
import { submitApproval } from "../submit-approval.js";
import { submitFileDecision } from "../submit-file-decision.js";
import { stubConnectedEngine } from "./engine-stub.js";

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
  vi.stubEnv(
    "STIGMER_RUNNER_TOKEN_KEY",
    Buffer.alloc(32, 8).toString("base64"),
  );
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      // The skill artifact store + staging wipe (#8) must stay inside the
      // test dir — the default resolves to ~/.stigmer/storage.
      STORAGE_PATH: path.join(dir, "storage"),
      // Keep the artifact store inside the test dir — the default
      // resolves to ~/.stigmer, which tests must never touch.
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
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
}): MessageInitShape<typeof AgentExecutionSchema> & {
  metadata: { id: string };
} {
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

describe("create over the wire (engine gate)", () => {
  it("valid create refuses Unavailable at the engine gate, BEFORE any side effect", async () => {
    // Seed an agent the request references, so target resolution and
    // validation pass and the refusal is provably the engine gate.
    await server.store.saveResource(
      ApiResourceKind.agent,
      "agt_create_gate",
      AgentSchema,
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { id: "agt_create_gate", name: "gate-agent", org: ORG },
      }),
    );

    const err = await expectCode(
      () =>
        command.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "gated-exec", org: ORG },
          spec: { agentId: "agt_create_gate", message: "hello" },
        }),
      Code.Unavailable,
    );
    expect(err.rawMessage).toBe(
      "The execution engine is temporarily unavailable. Please try again shortly.",
    );

    // The gate ran before the side-effecting steps: nothing persisted.
    // Both checks filter to THIS request's artifacts rather than
    // asserting global emptiness, so future seeding elsewhere in the
    // file can never make them order-dependent.
    const executions = await server.store.listResources(
      ApiResourceKind.agent_execution,
    );
    for (const data of executions) {
      const row = fromBinary(AgentExecutionSchema, data);
      expect(row.metadata?.name).not.toBe("gated-exec");
    }
    const sessions = await server.store.listResources(ApiResourceKind.session);
    for (const data of sessions) {
      const row = fromBinary(SessionSchema, data);
      expect(row.spec?.agentInstanceId ?? "").not.toContain("agt_create_gate");
      expect(row.spec?.subject).not.toBe("Auto-created session");
    }
  });

  it("validation runs before the gate: a tier without a model answers InvalidArgument", async () => {
    const err = await expectCode(
      () =>
        command.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "bad-tier-exec", org: ORG },
          spec: {
            agentId: "agt_create_gate",
            message: "hello",
            executionConfig: { serviceTier: ServiceTier.FAST },
          },
        }),
      Code.InvalidArgument,
    );
    expect(err.rawMessage).toContain("requires execution_config.model_name");
  });

  it("session_id and session_spec together refuse at proto validation", async () => {
    await expectCode(
      () =>
        command.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "both-exec", org: ORG },
          spec: {
            message: "hello",
            sessionId: "ses_1",
            sessionSpec: { agentInstanceId: "inst_1" },
          },
        }),
      Code.InvalidArgument,
    );
  });

  it("a forged server-owned harness_state_id in session_spec refuses at proto validation", async () => {
    // Go create_session_bootstrap_test.go: harness_state_id is
    // server-owned — a caller seeding thread state must be rejected by
    // the CEL rule, not silently honored.
    await expectCode(
      () =>
        command.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: "forged-exec", org: ORG },
          spec: {
            message: "hello",
            sessionSpec: {
              agentInstanceId: "inst_1",
              harnessStateId: "thread-forged",
            },
          },
        }),
      Code.InvalidArgument,
    );
  });
});

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
        if (error instanceof ConnectError && error.code === Code.Canceled) {
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
    expect(stream.frames).toEqual([
      "",
      "marker-live-update",
      "marker-terminal",
    ]);
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

function gatedSeed(overrides?: {
  id?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    mcpServerSlug?: string;
  }>;
}): MessageInitShape<typeof AgentExecutionSchema> & {
  metadata: { id: string };
} {
  counter += 1;
  const id = overrides?.id ?? `aexec_gated_${counter}`;
  const slug = `exec-${id.replaceAll("_", "-")}`;
  const toolCalls = overrides?.toolCalls ?? [{ id: "tc-1", name: "Write" }];
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { id, name: slug, slug, org: ORG },
    spec: {
      sessionId: `ses_${id}`,
      agentId: `agt_${id}`,
      message: "Say hello.",
    },
    status: {
      phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [
        {
          toolCalls: toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
            requiresApproval: true,
            ...(tc.mcpServerSlug !== undefined
              ? { mcpServerSlug: tc.mcpServerSlug }
              : {}),
          })),
        },
      ],
    },
  };
}

describe("updateStatus over the wire (ADR 011 write path)", () => {
  it("answers NotFound for an unknown execution and InvalidArgument without a status", async () => {
    await expectCode(
      () =>
        command.updateStatus({
          executionId: "aexec_missing",
          status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
        }),
      Code.NotFound,
    );
    await expectCode(
      () => command.updateStatus({ executionId: "aexec_missing" }),
      Code.InvalidArgument,
    );
  });

  it("persists the merge and broadcasts to a live subscriber in one write path", async () => {
    const init = seedInput({ phase: ExecutionPhase.EXECUTION_IN_PROGRESS });
    const id = await seed(init);

    // A live subscriber; the snapshot arrives first.
    const controller = new AbortController();
    const frames: ExecutionPhase[] = [];
    let sawFrame: (() => void) | undefined;
    const consuming = (async () => {
      try {
        for await (const frame of query.subscribe(
          { value: id },
          { signal: controller.signal },
        )) {
          frames.push(
            frame.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
          );
          sawFrame?.();
        }
      } catch (error) {
        if (!(error instanceof ConnectError && error.code === Code.Canceled)) {
          throw error;
        }
      }
    })();
    await new Promise<void>((resolve) => {
      if (frames.length >= 1) {
        resolve();
        return;
      }
      sawFrame = () => {
        sawFrame = undefined;
        resolve();
      };
    });

    // The runner's terminal persist: merged, persisted, broadcast.
    await command.updateStatus({
      executionId: id,
      status: {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        completedAt: "2026-08-24T10:00:00Z",
        messages: [{ content: "done" }],
      },
    });

    const reloaded = await query.get({ value: id });
    expect(reloaded.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(reloaded.status?.messages[0]?.content).toBe("done");

    // The broadcast reached the subscriber and, being terminal, closed the
    // stream server-side.
    await consuming;
    expect(frames).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
  });
});

describe("submitApproval over the wire (submit_approval_contract_test.go arms)", () => {
  it("records the decision, empties the gate, and authors the event pair", async () => {
    const init = gatedSeed();
    const id = await seed(init);

    const result = await command.submitApproval({
      agentExecutionId: id,
      toolCallId: "tc-1",
      action: ApprovalAction.APPROVE,
      comment: "go ahead",
    });

    const tc = result.status?.messages[0]?.toolCalls[0];
    expect(tc?.approvalAction).toBe(ApprovalAction.APPROVE);
    expect(tc?.approvalDecidedAt).not.toBe("");
    expect(result.status?.pendingApprovals).toHaveLength(0);

    // The append-only stream carries exactly one REQUESTED + one APPROVED,
    // the decision with the user's comment.
    const events = result.status?.approvalEventStream?.events ?? [];
    const mine = events.filter((ev) => ev.approvalRequestId === "tc-1");
    expect(mine.map((ev) => ev.eventType).sort()).toEqual(
      [ApprovalEventType.REQUESTED, ApprovalEventType.APPROVED].sort(),
    );
    const decided = mine.find(
      (ev) => ev.eventType === ApprovalEventType.APPROVED,
    );
    expect(
      decided?.payload.case === "decided" ? decided.payload.value.comment : "",
    ).toBe("go ahead");
  });

  it("is idempotent for a repeated identical submit and refuses a conflicting change", async () => {
    const id = await seed(gatedSeed());

    await command.submitApproval({
      agentExecutionId: id,
      toolCallId: "tc-1",
      action: ApprovalAction.SKIP,
    });
    // Same action again: a no-op answering current state.
    const repeat = await command.submitApproval({
      agentExecutionId: id,
      toolCallId: "tc-1",
      action: ApprovalAction.SKIP,
    });
    expect(repeat.status?.messages[0]?.toolCalls[0]?.approvalAction).toBe(
      ApprovalAction.SKIP,
    );
    // A different action on a decided call refuses.
    await expectCode(
      () =>
        command.submitApproval({
          agentExecutionId: id,
          toolCallId: "tc-1",
          action: ApprovalAction.REJECT,
        }),
      Code.FailedPrecondition,
    );
  });

  it("refuses non-approvable phases, unknown tool calls, and unknown executions", async () => {
    const terminal = await seed(
      seedInput({ phase: ExecutionPhase.EXECUTION_COMPLETED }),
    );
    await expectCode(
      () =>
        command.submitApproval({
          agentExecutionId: terminal,
          toolCallId: "tc-1",
          action: ApprovalAction.APPROVE,
        }),
      Code.FailedPrecondition,
    );

    const gated = await seed(gatedSeed());
    await expectCode(
      () =>
        command.submitApproval({
          agentExecutionId: gated,
          toolCallId: "tc-unknown",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
    );

    await expectCode(
      () =>
        command.submitApproval({
          agentExecutionId: "aexec_missing",
          toolCallId: "tc-1",
          action: ApprovalAction.APPROVE,
        }),
      Code.NotFound,
    );
  });

  it("APPROVE_ALL bulk-approves only the clicked tool's lease class", async () => {
    const id = await seed(
      gatedSeed({
        toolCalls: [
          { id: "tc-shell-1", name: "shell" },
          { id: "tc-shell-2", name: "bash" },
          { id: "tc-write", name: "Write" },
        ],
      }),
    );

    const result = await command.submitApproval({
      agentExecutionId: id,
      toolCallId: "tc-shell-1",
      action: ApprovalAction.APPROVE_ALL,
    });

    const calls = result.status?.messages[0]?.toolCalls ?? [];
    const byId = new Map(calls.map((tc) => [tc.id, tc]));
    // The clicked tool carries APPROVE_ALL (the user's escalation point).
    expect(byId.get("tc-shell-1")?.approvalAction).toBe(
      ApprovalAction.APPROVE_ALL,
    );
    // The same-class co-pending call carries a plain APPROVE.
    expect(byId.get("tc-shell-2")?.approvalAction).toBe(ApprovalAction.APPROVE);
    // The different-class call stays gated — pending_approvals still
    // lists it, so the gate stays open.
    expect(byId.get("tc-write")?.approvalAction).toBe(
      ApprovalAction.UNSPECIFIED,
    );
    expect(result.status?.pendingApprovals).toHaveLength(1);
    expect(result.status?.pendingApprovals[0]?.toolCallId).toBe("tc-write");
  });

  it("the approve-all resume round-trip preserves earlier thinking and the first tool call (transcript test)", async () => {
    counter += 1;
    const id = `aexec_resume_${counter}`;
    const slug = `exec-${id.replaceAll("_", "-")}`;
    await seed({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { id, name: slug, slug, org: ORG },
      spec: { message: "Say hello." },
      status: {
        phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        messages: [
          {
            type: MessageType.MESSAGE_THINKING,
            content: "planning the self-DM",
          },
          {
            type: MessageType.MESSAGE_AI,
            toolCalls: [
              {
                id: "tc-getappstate",
                name: "getAppState",
                status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                requiresApproval: true,
                mcpServerSlug: "open-computer-use",
              },
            ],
          },
        ],
      },
    });

    await command.submitApproval({
      agentExecutionId: id,
      toolCallId: "tc-getappstate",
      action: ApprovalAction.APPROVE_ALL,
    });

    // The durable-checkpoint resume sends a regressed transcript: leading
    // thinking + getAppState gone, later leased tools appended.
    await command.updateStatus({
      executionId: id,
      status: {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        messages: [
          {
            type: MessageType.MESSAGE_AI,
            toolCalls: [
              {
                id: "tc-click",
                name: "click",
                status: ToolCallStatus.TOOL_CALL_COMPLETED,
              },
            ],
          },
          {
            type: MessageType.MESSAGE_AI,
            toolCalls: [
              {
                id: "tc-scroll",
                name: "scroll",
                status: ToolCallStatus.TOOL_CALL_COMPLETED,
              },
            ],
          },
          { type: MessageType.MESSAGE_AI, content: "done" },
        ],
      },
    });

    const final = await query.get({ value: id });
    const hasThinking = final.status?.messages.some(
      (m) =>
        m.type === MessageType.MESSAGE_THINKING &&
        m.content === "planning the self-DM",
    );
    expect(
      hasThinking,
      "the leading thinking block survives the resume round-trip",
    ).toBe(true);
    const gated = final.status?.messages
      .flatMap((m) => m.toolCalls)
      .find((tc) => tc.id === "tc-getappstate");
    expect(gated, "the first tool call survives").toBeDefined();
    expect(
      gated?.approvalAction,
      "the recorded APPROVE_ALL decision survives",
    ).toBe(ApprovalAction.APPROVE_ALL);
  });

  it("a racing heartbeat never clobbers the decision, and REQUESTED never duplicates", async () => {
    // The designed overlap window (update_status_concurrency_test.go):
    // both paths persist via the lock-serialized atomic updateResource.
    for (let i = 0; i < 20; i++) {
      const id = await seed(gatedSeed());
      const heartbeat = command.updateStatus({
        executionId: id,
        status: {
          phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
          messages: [
            {
              toolCalls: [
                {
                  id: "tc-1",
                  name: "Write",
                  status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
                  requiresApproval: true,
                },
              ],
            },
          ],
        },
      });
      const approval = command.submitApproval({
        agentExecutionId: id,
        toolCallId: "tc-1",
        action: ApprovalAction.APPROVE,
      });
      await Promise.all([heartbeat, approval]);

      const final = await query.get({ value: id });
      const tc = final.status?.messages
        .flatMap((m) => m.toolCalls)
        .find((c) => c.id === "tc-1");
      expect(tc?.approvalAction, `iteration ${i}: decision lost`).toBe(
        ApprovalAction.APPROVE,
      );
      const events = (final.status?.approvalEventStream?.events ?? []).filter(
        (ev) => ev.approvalRequestId === "tc-1",
      );
      expect(
        events.filter((ev) => ev.eventType === ApprovalEventType.REQUESTED),
        `iteration ${i}: REQUESTED duplicated`,
      ).toHaveLength(1);
      expect(
        events.filter((ev) => ev.eventType === ApprovalEventType.APPROVED),
        `iteration ${i}: decision event lost`,
      ).toHaveLength(1);
    }
  });
});

describe("the engine-connected signal arms (stubbed engine, direct calls)", () => {
  function stubDeps(engine: ConnectedExecutionEngine) {
    return {
      store: server.store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      broker: server.agentExecutionStreamBroker,
      engineState: () => ({ connected: true, engine }) as ExecutionEngineState,
      gateSteps: new Map(),
      statusObservers: [],
    };
  }

  it("signals approvalGateResolved exactly once, only when the unified gate clears", async () => {
    const id = await seed(
      gatedSeed({
        toolCalls: [
          { id: "tc-shell", name: "shell" },
          { id: "tc-write", name: "Write" },
        ],
      }),
    );
    const signalled: string[] = [];
    const deps = stubDeps(
      stubConnectedEngine({
        signalApprovalGateResolved: async (executionId) => {
          signalled.push(executionId);
        },
      }),
    );

    // First decision: a different-class call stays gated → no signal.
    await submitApproval(
      deps,
      create(SubmitApprovalInputSchema, {
        agentExecutionId: id,
        toolCallId: "tc-shell",
        action: ApprovalAction.APPROVE,
      }),
      testCallerIdentity(),
    );
    expect(signalled).toHaveLength(0);

    // Second decision clears the gate → exactly one signal.
    await submitApproval(
      deps,
      create(SubmitApprovalInputSchema, {
        agentExecutionId: id,
        toolCallId: "tc-write",
        action: ApprovalAction.REJECT,
      }),
      testCallerIdentity(),
    );
    expect(signalled).toEqual([id]);
  });

  it("a vanished workflow reconciles the execution to FAILED with settled tool calls (pinned copy)", async () => {
    const id = await seed(
      gatedSeed({ toolCalls: [{ id: "tc-1", name: "Write" }] }),
    );
    const deps = stubDeps(
      stubConnectedEngine({
        signalApprovalGateResolved: async (executionId) => {
          throw new EngineWorkflowNotFoundError(executionId);
        },
      }),
    );

    const err = await expectCode(
      () =>
        submitApproval(
          deps,
          create(SubmitApprovalInputSchema, {
            agentExecutionId: id,
            toolCallId: "tc-1",
            action: ApprovalAction.APPROVE,
          }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(err.rawMessage).toBe(
      `workflow not running for execution ${id} - the backing workflow has terminated unexpectedly and the execution has been marked as failed`,
    );

    const final = await query.get({ value: id });
    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(final.status?.error).toBe(
      "Workflow backing this execution is no longer running. Execution has been marked as failed.",
    );
    // The system message is appended and in-flight calls settle (#207).
    expect(final.status?.messages.at(-1)?.type).toBe(
      MessageType.MESSAGE_SYSTEM,
    );
    const tc = final.status?.messages
      .flatMap((m) => m.toolCalls)
      .find((c) => c.id === "tc-1");
    expect(tc?.status).toBe(ToolCallStatus.TOOL_CALL_INTERRUPTED);
    // The ledger is preserved for the audit trail; the projection is empty
    // (terminal).
    expect(
      (final.status?.approvalEventStream?.events ?? []).length,
    ).toBeGreaterThan(0);
    expect(final.status?.pendingApprovals).toHaveLength(0);
  });

  // O4 (20260827.07, ruling Q3): the reconcile's →FAILED stamp is notify
  // site 4 of 5 — a terminal transition the update-status chokepoint
  // never sees.
  it("the stale-workflow reconcile notifies the composed status observers", async () => {
    const id = await seed(
      gatedSeed({ toolCalls: [{ id: "tc-obs", name: "Write" }] }),
    );
    const observed: AgentExecutionStatusTransition[] = [];
    const deps = {
      ...stubDeps(
        stubConnectedEngine({
          signalApprovalGateResolved: async (executionId) => {
            throw new EngineWorkflowNotFoundError(executionId);
          },
        }),
      ),
      statusObservers: [
        (t: AgentExecutionStatusTransition): void => void observed.push(t),
      ],
    };

    await expectCode(
      () =>
        submitApproval(
          deps,
          create(SubmitApprovalInputSchema, {
            agentExecutionId: id,
            toolCallId: "tc-obs",
            action: ApprovalAction.APPROVE,
          }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(observed).toHaveLength(1);
    expect(observed[0]?.oldPhase).toBe(
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );
    expect(observed[0]?.newPhase).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(observed[0]?.execution.metadata?.id).toBe(id);
  });
});

describe("submitFileDecision over the wire", () => {
  function ledgerSeed(): {
    init: MessageInitShape<typeof AgentExecutionSchema> & {
      metadata: { id: string };
    };
    changeSetId: string;
    change: ReturnType<typeof buildChange>;
    aggregate: string;
  } {
    counter += 1;
    const id = `aexec_review_${counter}`;
    const slug = `exec-${id.replaceAll("_", "-")}`;
    const changeSetId = `cs_${counter}`;
    const change = buildChange();
    const aggregate = aggregateDigest([change]);
    return {
      init: {
        apiVersion: API_VERSION,
        kind: KIND,
        metadata: { id, name: slug, slug, org: ORG },
        spec: { message: "Say hello." },
        status: {
          phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
          fileReviewEventStream: {
            executionId: id,
            events: [
              {
                eventId: `${changeSetId}:${changeSetId}:BASELINE`,
                changeSetId,
                eventType: FileReviewEventType.BASELINE_CAPTURED,
                actor: "runner",
                payload: {
                  case: "baselineCaptured",
                  value: { turnId: "turn-1", harnessId: "harness-1" },
                },
              },
              {
                eventId: `${changeSetId}:${changeSetId}:CANDIDATE`,
                changeSetId,
                eventType: FileReviewEventType.CANDIDATE_CAPTURED,
                actor: "runner",
                payload: {
                  case: "candidateCaptured",
                  value: {
                    changes: [change],
                    aggregateDigest: aggregate,
                    diffCompleteness: DiffCompleteness.COMPLETE,
                  },
                },
              },
            ],
          },
        },
      },
      changeSetId,
      change,
      aggregate,
    };
  }

  function buildChange() {
    const change = create(CapturedFileChangeSchema, {
      id: "fc-1",
      pathBefore: "src/a.ts",
      pathAfter: "src/a.ts",
      kind: FileChangeKind.MODIFY,
      beforeSha256: "a".repeat(64),
      afterSha256: "b".repeat(64),
      diffComplete: true,
    });
    change.fileDigest = fileDigest(change);
    return change;
  }

  it("records a CHANGE_SET keep, projects DECIDED, and is idempotent on resubmit", async () => {
    const { init, changeSetId, aggregate } = ledgerSeed();
    const id = await seed(init);

    const result = await command.submitFileDecision({
      agentExecutionId: id,
      changeSetId,
      scope: FileDecisionScope.CHANGE_SET,
      action: FileDecisionAction.APPROVE,
      expectedDigest: aggregate,
    });
    const cs = result.status?.fileChangeSets.find((c) => c.id === changeSetId);
    expect(cs?.status).toBe(FileChangeSetStatus.DECIDED);
    expect(cs?.decisions).toHaveLength(1);
    expect(cs?.decisions[0]?.origin).toBe(FileDecisionOrigin.USER);

    // Idempotent resubmit: the same deterministic event id — no error, no
    // duplicate decision.
    const repeat = await command.submitFileDecision({
      agentExecutionId: id,
      changeSetId,
      scope: FileDecisionScope.CHANGE_SET,
      action: FileDecisionAction.APPROVE,
      expectedDigest: aggregate,
    });
    const csRepeat = repeat.status?.fileChangeSets.find(
      (c) => c.id === changeSetId,
    );
    expect(csRepeat?.decisions).toHaveLength(1);
  });

  // O4 (20260827.07, ruling Q3): the file-review reconcile twin is notify
  // site 5 of 5.
  it("the workflow-gone reconcile notifies the composed status observers", async () => {
    const { init, changeSetId, aggregate } = ledgerSeed();
    const id = await seed(init);
    const observed: AgentExecutionStatusTransition[] = [];
    const deps = {
      store: server.store,
      logger: silentLogger,
      authorizer: newPermissiveSingleTeamAuthorizer(),
      broker: server.agentExecutionStreamBroker,
      engineState: () =>
        ({
          connected: true,
          engine: stubConnectedEngine({
            signalApprovalGateResolved: async (executionId: string) => {
              throw new EngineWorkflowNotFoundError(executionId);
            },
          }),
        }) as ExecutionEngineState,
      statusObservers: [
        (t: AgentExecutionStatusTransition): void => void observed.push(t),
      ],
    };

    // A CHANGE_SET decision resolves the whole gate, so the signal fires
    // and the vanished workflow triggers the reconcile.
    await expectCode(
      () =>
        submitFileDecision(
          deps,
          create(SubmitFileDecisionInputSchema, {
            agentExecutionId: id,
            changeSetId,
            scope: FileDecisionScope.CHANGE_SET,
            action: FileDecisionAction.APPROVE,
            expectedDigest: aggregate,
          }),
          testCallerIdentity(),
        ),
      Code.FailedPrecondition,
    );
    expect(observed).toHaveLength(1);
    expect(observed[0]?.oldPhase).toBe(
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    );
    expect(observed[0]?.newPhase).toBe(ExecutionPhase.EXECUTION_FAILED);
  });

  it("refuses a stale digest, an unknown change set, and FILE scope without an id", async () => {
    const { init, changeSetId } = ledgerSeed();
    const id = await seed(init);

    const staleErr = await expectCode(
      () =>
        command.submitFileDecision({
          agentExecutionId: id,
          changeSetId,
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
          expectedDigest: "0".repeat(64),
        }),
      Code.InvalidArgument,
    );
    expect(staleErr.rawMessage).toBe(
      `expected_digest mismatch for change set ${changeSetId}: the captured content changed since it was reviewed`,
    );

    await expectCode(
      () =>
        command.submitFileDecision({
          agentExecutionId: id,
          changeSetId: "cs_unknown",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
          expectedDigest: "0".repeat(64),
        }),
      Code.FailedPrecondition,
    );

    await expectCode(
      () =>
        command.submitFileDecision({
          agentExecutionId: id,
          changeSetId,
          scope: FileDecisionScope.FILE,
          action: FileDecisionAction.APPROVE,
          expectedDigest: "0".repeat(64),
        }),
      Code.InvalidArgument,
    );
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
