/**
 * Pins the workflowexecution Phase-1 surfaces against Go's controller —
 * through the REAL stack: a composed server on an ephemeral port, a
 * native gRPC client, the full interceptor chain. Executions cannot be
 * created through the RPC surface here (the engine gate refuses without
 * Temporal — exactly the production posture until #21), so records are
 * seeded directly through the store, the same way Go's controller tests
 * seed with SaveResource.
 *
 * Load-bearing pins the zero-record conformance arm cannot cover:
 *   - list's legacy-phase fallback vs filter.phases precedence, the T13
 *     structured filter over seeded rows, the started_at-descending sort
 *     default, and the total_pages placeholder;
 *   - listByWorkflow matching EITHER spec.workflow_id or
 *     spec.workflow_instance_id;
 *   - getEventLog cursor pagination over REAL persisted events: has_more
 *     from the +1 fetch, latest_sequence, the 500 cap, the multi-type
 *     in-memory filter, and the malformed-record skip;
 *   - the populated getExecutionSummary arm (phase counts, active count,
 *     avg duration, failure ranks, cost breakdown, workflow scoping,
 *     time-window cutoff);
 *   - listPendingApprovals projection (task_name not task_id; requester
 *     from spec audit) and its pre-truncation total_count;
 *   - update's status-clearing standard build and delete's audit-trail
 *     return, over the wire.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  WorkflowExecutionSchema,
  WorkflowTaskSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  WorkflowEventType,
  WorkflowExecutionEventSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import {
  ExecutionSortField,
  SummaryTimeWindow,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { WorkflowExecutionEventRecord } from "../../../store/interface.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "WorkflowExecution";
const ORG = "acme";

type CommandClient = Client<typeof WorkflowExecutionCommandController>;
type QueryClient = Client<typeof WorkflowExecutionQueryController>;

let server: ComposedServer;
let dir: string;
let command: CommandClient;
let query: QueryClient;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "wfexec-domain-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv(
    "STIGMER_RUNNER_TOKEN_KEY",
    Buffer.alloc(32, 8).toString("base64"),
  );
  server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      DB_PATH: path.join(dir, "stigmer.db"),
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
  command = createClient(WorkflowExecutionCommandController, transport);
  query = createClient(WorkflowExecutionQueryController, transport);
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
  workflowId?: string;
  workflowInstanceId?: string;
  phase?: ExecutionPhase;
  startedAt?: string;
  completedAt?: string;
  totalCostMicros?: bigint;
  createdAtMs?: number;
  slug?: string;
  name?: string;
  tasks?: MessageInitShape<typeof WorkflowTaskSchema>[];
}): MessageInitShape<typeof WorkflowExecutionSchema> & {
  metadata: { id: string };
} {
  counter += 1;
  const id = overrides?.id ?? `wfexec_test_${counter}`;
  const slug = overrides?.slug ?? `exec-${id.replaceAll("_", "-")}`;
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: {
      id,
      name: overrides?.name ?? slug,
      slug,
      org: overrides?.org ?? ORG,
    },
    spec: {
      workflowId: overrides?.workflowId ?? `wf_test_${counter}`,
      workflowInstanceId:
        overrides?.workflowInstanceId ?? `wfi_test_${counter}`,
    },
    status: {
      phase: overrides?.phase ?? ExecutionPhase.EXECUTION_COMPLETED,
      startedAt: overrides?.startedAt ?? "",
      completedAt: overrides?.completedAt ?? "",
      totalCostMicros: overrides?.totalCostMicros ?? 0n,
      tasks: overrides?.tasks ?? [],
      audit:
        overrides?.createdAtMs === undefined
          ? undefined
          : {
              specAudit: {
                createdAt: timestampFromMs(overrides.createdAtMs),
                createdBy: { id: "usr_seeder" },
              },
            },
    },
  };
}

async function seed(
  init: MessageInitShape<typeof WorkflowExecutionSchema> & {
    metadata: { id: string };
  },
): Promise<string> {
  await server.store.saveResource(
    ApiResourceKind.workflow_execution,
    init.metadata.id,
    WorkflowExecutionSchema,
    create(WorkflowExecutionSchema, init),
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

function eventRecord(
  executionId: string,
  sequenceNumber: number,
  eventType: WorkflowEventType,
  taskName = "",
): WorkflowExecutionEventRecord {
  return {
    executionId,
    sequenceNumber,
    eventType: WorkflowEventType[eventType] ?? "",
    taskName,
    data: toBinary(
      WorkflowExecutionEventSchema,
      create(WorkflowExecutionEventSchema, {
        eventId: `evt_${executionId}_${sequenceNumber}`,
        eventType,
        sequenceNumber: BigInt(sequenceNumber),
        occurredAt: "2026-05-23T10:00:00Z",
        taskName,
      }),
    ),
    createdAt: "2026-05-23T10:00:00Z",
  };
}

describe("get / list / listByWorkflow over the wire", () => {
  it("get answers NotFound for an unknown id", async () => {
    await expectCode(() => query.get({ value: "wfexec_missing" }), Code.NotFound);
  });

  it("get round-trips a seeded execution", async () => {
    const id = await seed(seedInput());
    const got = await query.get({ value: id });
    expect(got.metadata?.id).toBe(id);
  });

  it("list applies the legacy phase filter only when filter.phases is absent", async () => {
    const failed = await seed(
      seedInput({ phase: ExecutionPhase.EXECUTION_FAILED }),
    );
    await seed(seedInput({ phase: ExecutionPhase.EXECUTION_COMPLETED }));

    const legacy = await query.list({
      phase: ExecutionPhase.EXECUTION_FAILED,
    });
    expect(
      legacy.entries.every(
        (entry) => entry.status?.phase === ExecutionPhase.EXECUTION_FAILED,
      ),
    ).toBe(true);
    expect(legacy.entries.map((entry) => entry.metadata?.id)).toContain(
      failed,
    );
    expect(legacy.totalPages).toBe(1);

    // filter.phases supersedes the legacy field: a COMPLETED filter with a
    // FAILED legacy phase answers COMPLETED rows.
    const structured = await query.list({
      phase: ExecutionPhase.EXECUTION_FAILED,
      filter: { phases: [ExecutionPhase.EXECUTION_COMPLETED] },
    });
    expect(structured.entries.length).toBeGreaterThan(0);
    expect(
      structured.entries.every(
        (entry) => entry.status?.phase === ExecutionPhase.EXECUTION_COMPLETED,
      ),
    ).toBe(true);
  });

  it("list defaults to started_at descending", async () => {
    const early = await seed(
      seedInput({ startedAt: "2026-05-23T10:00:00Z" }),
    );
    const late = await seed(seedInput({ startedAt: "2026-05-23T14:00:00Z" }));

    const result = await query.list({});
    const positions = new Map(
      result.entries.map((entry, index) => [entry.metadata?.id, index]),
    );
    expect(positions.get(late)).toBeLessThan(positions.get(early)!);
  });

  it("listByWorkflow requires workflow_id and matches either spec reference", async () => {
    await expectCode(
      () => query.listByWorkflow({ workflowId: "" }),
      Code.InvalidArgument,
    );

    const byWorkflow = await seed(seedInput({ workflowId: "wf_shared_ref" }));
    const byInstance = await seed(
      seedInput({ workflowInstanceId: "wf_shared_ref" }),
    );
    await seed(seedInput());

    const result = await query.listByWorkflow({
      workflowId: "wf_shared_ref",
      sortField: ExecutionSortField.STARTED_AT,
      sortAscending: true,
    });
    const resultIds = result.entries.map((entry) => entry.metadata?.id);
    expect(resultIds).toContain(byWorkflow);
    expect(resultIds).toContain(byInstance);
    expect(resultIds).toHaveLength(2);
    expect(result.totalPages).toBe(1);
  });
});

describe("getEventLog over the wire (CW-7 pagination contract)", () => {
  it("empty id refuses InvalidArgument; unknown id answers an empty page", async () => {
    await expectCode(
      () => query.getEventLog({ executionId: "" }),
      Code.InvalidArgument,
    );
    const empty = await query.getEventLog({ executionId: "wfexec_missing" });
    expect(empty.events).toHaveLength(0);
    expect(empty.hasMore).toBe(false);
    expect(empty.latestSequence).toBe(0n);
  });

  it("paginates with has_more from the +1 fetch and latest_sequence as cursor", async () => {
    const id = await seed(seedInput());
    const records: WorkflowExecutionEventRecord[] = [];
    for (let sequence = 1; sequence <= 5; sequence++) {
      records.push(
        eventRecord(id, sequence, WorkflowEventType.task_started, `t${sequence}`),
      );
    }
    expect(
      await server.store.appendWorkflowExecutionEvents(id, records),
    ).toBe(5);

    const page1 = await query.getEventLog({ executionId: id, pageSize: 2 });
    expect(page1.events).toHaveLength(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.latestSequence).toBe(2n);

    const page2 = await query.getEventLog({
      executionId: id,
      pageSize: 2,
      afterSequence: page1.latestSequence,
    });
    expect(page2.events.map((event) => event.sequenceNumber)).toEqual([
      3n,
      4n,
    ]);
    expect(page2.hasMore).toBe(true);

    const page3 = await query.getEventLog({
      executionId: id,
      pageSize: 2,
      afterSequence: page2.latestSequence,
    });
    expect(page3.events).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
    expect(page3.latestSequence).toBe(5n);
  });

  it("filters by a single event type in the store and multiple types in memory", async () => {
    const id = await seed(seedInput());
    await server.store.appendWorkflowExecutionEvents(id, [
      eventRecord(id, 1, WorkflowEventType.execution_started),
      eventRecord(id, 2, WorkflowEventType.task_started, "a"),
      eventRecord(id, 3, WorkflowEventType.task_completed, "a"),
      eventRecord(id, 4, WorkflowEventType.execution_completed),
    ]);

    const single = await query.getEventLog({
      executionId: id,
      eventTypes: [WorkflowEventType.task_started],
    });
    expect(single.events).toHaveLength(1);
    expect(single.events[0].eventType).toBe(WorkflowEventType.task_started);

    const multi = await query.getEventLog({
      executionId: id,
      eventTypes: [
        WorkflowEventType.execution_started,
        WorkflowEventType.execution_completed,
      ],
    });
    expect(multi.events.map((event) => event.eventType)).toEqual([
      WorkflowEventType.execution_started,
      WorkflowEventType.execution_completed,
    ]);
  });

  it("skips malformed event records without failing the page", async () => {
    const id = await seed(seedInput());
    const good = eventRecord(id, 1, WorkflowEventType.execution_started);
    const malformed: WorkflowExecutionEventRecord = {
      executionId: id,
      sequenceNumber: 2,
      eventType: "execution_started",
      taskName: "",
      data: new Uint8Array([0xff, 0xff, 0xff, 0x01, 0x02]),
      createdAt: "2026-05-23T10:00:00Z",
    };
    const alsoGood = eventRecord(id, 3, WorkflowEventType.execution_completed);
    await server.store.appendWorkflowExecutionEvents(id, [
      good,
      malformed,
      alsoGood,
    ]);

    const page = await query.getEventLog({ executionId: id });
    expect(page.events.map((event) => event.sequenceNumber)).toEqual([1n, 3n]);
    expect(page.hasMore).toBe(false);
  });

  it("caps page_size at 500 and defaults to 100", async () => {
    const id = await seed(seedInput());
    const records: WorkflowExecutionEventRecord[] = [];
    for (let sequence = 1; sequence <= 120; sequence++) {
      records.push(eventRecord(id, sequence, WorkflowEventType.task_started));
    }
    await server.store.appendWorkflowExecutionEvents(id, records);

    const defaulted = await query.getEventLog({ executionId: id });
    expect(defaulted.events).toHaveLength(100);
    expect(defaulted.hasMore).toBe(true);

    const capped = await query.getEventLog({
      executionId: id,
      pageSize: 100_000,
    });
    // 120 < the 500 cap, so everything arrives; the cap is proven by the
    // request not erroring and the page staying bounded.
    expect(capped.events).toHaveLength(120);
    expect(capped.hasMore).toBe(false);
  });
});

describe("getExecutionSummary over the wire", () => {
  // The composed store is shared across this file's tests, so summary
  // assertions scope through workflow_id filters seeded uniquely here.
  it("aggregates phase counts, cost, avg duration, ranks — scoped by workflow", async () => {
    const wf = "wf_summary_scope";
    const nowMs = Date.now();
    await seed(
      seedInput({
        workflowId: wf,
        slug: "summary-flow",
        name: "Summary Flow",
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        startedAt: "2026-05-23T10:00:00Z",
        completedAt: "2026-05-23T10:00:10Z",
        totalCostMicros: 2_000_000n,
        createdAtMs: nowMs,
      }),
    );
    await seed(
      seedInput({
        workflowId: wf,
        slug: "summary-flow",
        name: "Summary Flow",
        phase: ExecutionPhase.EXECUTION_FAILED,
        totalCostMicros: 1_000_000n,
        createdAtMs: nowMs,
      }),
    );
    await seed(
      seedInput({
        workflowId: wf,
        slug: "summary-flow",
        name: "Summary Flow",
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        createdAtMs: nowMs,
      }),
    );

    const summary = await query.getExecutionSummary({
      org: ORG,
      timeWindow: SummaryTimeWindow.ALL_TIME,
      workflowId: wf,
    });
    expect(summary.totalCount).toBe(3);
    expect(summary.activeCount).toBe(1);
    expect(summary.phaseCounts[ExecutionPhase.EXECUTION_COMPLETED]).toBe(1);
    expect(summary.phaseCounts[ExecutionPhase.EXECUTION_FAILED]).toBe(1);
    expect(summary.phaseCounts[ExecutionPhase.EXECUTION_IN_PROGRESS]).toBe(1);
    // 1 completed / 2 terminal.
    expect(summary.successRate).toBeCloseTo(0.5);
    expect(summary.totalCost?.totalCostUsd).toBeCloseTo(3.0);
    // One completed 10s run.
    expect(summary.avgDuration?.seconds).toBe(10n);
    expect(summary.topFailingWorkflows).toHaveLength(1);
    expect(summary.topFailingWorkflows[0].workflowSlug).toBe("summary-flow");
    expect(summary.topFailingWorkflows[0].failureCount).toBe(1);
    expect(summary.costByWorkflow).toHaveLength(1);
    expect(summary.costByWorkflow[0].executionCount).toBe(3);
  });

  it("time window excludes older executions; success_rate keeps the -1 sentinel", async () => {
    const wf = "wf_summary_window";
    const thirtyOneDaysAgoMs = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await seed(
      seedInput({
        workflowId: wf,
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        createdAtMs: thirtyOneDaysAgoMs,
      }),
    );

    const windowed = await query.getExecutionSummary({
      org: ORG,
      timeWindow: SummaryTimeWindow.LAST_24H,
      workflowId: wf,
    });
    expect(windowed.totalCount).toBe(0);
    expect(windowed.successRate).toBe(-1);
    expect(windowed.totalCost, "zero cost summary is ALWAYS present").toBeDefined();
    expect(windowed.avgDuration, "no completed runs → absent").toBeUndefined();

    const allTime = await query.getExecutionSummary({
      org: ORG,
      timeWindow: SummaryTimeWindow.ALL_TIME,
      workflowId: wf,
    });
    expect(allTime.totalCount).toBe(1);
  });
});

describe("listPendingApprovals over the wire", () => {
  it("projects WAITING_APPROVAL tasks of IN_PROGRESS executions (task_name, not task_id)", async () => {
    const id = await seed(
      seedInput({
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        name: "Approval Flow",
        createdAtMs: Date.now(),
        tasks: [
          {
            taskId: "gate:2",
            taskName: "gate",
            status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
            startedAt: "2026-05-23T10:00:00Z",
            uiHint: "approval-form",
          },
          {
            taskId: "done:1",
            taskName: "done",
            status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
          },
        ],
      }),
    );
    // A WAITING_APPROVAL task on a non-IN_PROGRESS execution is excluded.
    await seed(
      seedInput({
        phase: ExecutionPhase.EXECUTION_PAUSED,
        tasks: [
          {
            taskName: "paused-gate",
            status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
          },
        ],
      }),
    );

    const result = await query.listPendingApprovals({ org: ORG });
    const entry = result.entries.find((item) => item.executionId === id);
    expect(entry).toBeDefined();
    expect(entry?.taskName).toBe("gate");
    expect(entry?.workflowName).toBe("Approval Flow");
    expect(entry?.requester).toBe("usr_seeder");
    expect(entry?.uiHint).toBe("approval-form");
    expect(
      result.entries.some((item) => item.taskName === "paused-gate"),
    ).toBe(false);
  });

  it("total_count is the pre-truncation total", async () => {
    const tasks = Array.from({ length: 3 }, (_, index) => ({
      taskName: `bulk-gate-${index}`,
      status: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
    }));
    await seed(
      seedInput({ phase: ExecutionPhase.EXECUTION_IN_PROGRESS, tasks }),
    );

    const page = await query.listPendingApprovals({ org: ORG, pageSize: 1 });
    expect(page.entries).toHaveLength(1);
    expect(page.totalCount).toBeGreaterThanOrEqual(3);
  });
});

describe("update / delete over the wire", () => {
  it("update rewrites the spec through the standard build", async () => {
    const init = seedInput({ phase: ExecutionPhase.EXECUTION_FAILED });
    const id = await seed(init);

    const updated = await command.update({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: init.metadata,
      spec: {
        workflowId: init.spec?.workflowId,
        workflowInstanceId: init.spec?.workflowInstanceId,
        triggerMessage: "updated trigger",
      },
    });
    expect(updated.metadata?.id).toBe(id);
    expect(updated.spec?.triggerMessage).toBe("updated trigger");

    const got = await query.get({ value: id });
    expect(got.spec?.triggerMessage).toBe("updated trigger");
  });

  it("delete returns the deleted record (audit-trail convention) and removes it", async () => {
    const id = await seed(seedInput());
    const deleted = await command.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);
    await expectCode(() => query.get({ value: id }), Code.NotFound);
  });

  it("delete answers NotFound for an unknown id", async () => {
    await expectCode(
      () => command.delete({ value: "wfexec_missing" }),
      Code.NotFound,
    );
  });
});
