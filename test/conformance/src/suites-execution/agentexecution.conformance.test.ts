// Conformance suite for the AgentExecution domain (Class B).
// Domain: agentic / agentexecution — a single user message run through the agent
// engine (Temporal orchestrator + TS runner + mock LLM), driven via the raw proto
// stubs. The second execution domain after WorkflowExecution.
//
// Runs against the local-go-execution target, so Temporal is always present and
// the workflowCreator is injected: create starts a real workflow that the runner
// picks up and drives through an LLM loop served by the in-process mock proxy.
// Every run is scripted by enqueuing turns on that mock — a single text turn
// reaches COMPLETED; a `delayMs`-held turn keeps an execution genuinely
// IN_PROGRESS so lifecycle RPCs (cancel/terminate/pause/resume) act on a running
// thing (the AgentExecution analogue of WorkflowExecution's `wait` timer).
//
// Contract divergences from WorkflowExecution, encoded as assertions below:
// - No AlreadyExists on create: repeated identical creates yield distinct aex_
//   ids (there is no CheckDuplicateStep in the agent-execution pipeline).
// - "Neither session_id nor agent_id" is NOT an InvalidArgument: resolveDefaultAgentStep
//   runs before validateSessionOrAgentStep and tries to resolve the platform
//   default agent, which the single-tenant OSS target does not seed — so the
//   reachable contract is NotFound (with a clear "no default agent" message).
//   validateSessionOrAgent's InvalidArgument is unreachable by black-box input here.
// - The query analogue of listByWorkflow is listBySession (filter by spec.session_id).
//
// Deliberately out of scope (each needs machinery this slice doesn't build, and
// is recorded as a conscious deferral in DD-009, not shipped as a thin partial):
// - submitApproval happy path (needs tool-call + approval choreography);
// - recover happy path (needs a genuinely FAILED execution);
// - usage reports, artifact download/content, subscribe streaming, sub-agents.
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import {
  AGENT_EXECUTION_API_VERSION,
  AGENT_EXECUTION_KIND,
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
} from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

// Long enough to keep a held execution IN_PROGRESS across the poll-and-act window
// (tests act within ~1s), well under the runner activity's 2-minute heartbeat and
// 24-hour start-to-close. A held turn aborts the instant the client disconnects
// (cancel/terminate/pause), so the wall-clock cost is tiny.
const HOLD_MS = 30_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// A valid Agent; returns its id. The agent's default instance + a session are
// auto-created on first execution.
async function provisionAgent(org: string, name = uniqueName("agent")): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent.metadata!.id;
}

// Create an execution against `agentId`, queuing one text turn so the run reaches
// COMPLETED on its own. Callers awaitTerminal to settle before the test ends.
async function createExecution(org: string, agentId: string, name = uniqueName("aex")) {
  mock.enqueue(anthropicText("Done."));
  const execution = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name, agentId }));
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution;
}

// Create an execution whose first (and only queued) turn is held open, so it sits
// in IN_PROGRESS until a lifecycle RPC acts on it.
async function createHeldExecution(org: string, agentId: string, name = uniqueName("aex")) {
  mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
  const execution = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name, agentId }));
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution;
}

describe("AgentExecution conformance — CRUD & identity", () => {
  it("create assigns an aex_ id, echoes the agent ref, and starts PENDING", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const name = uniqueName("aex");

    const created = await createExecution(org, agentId, name);

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^aex_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.agentId).toBe(agentId);
    // create persists before starting Temporal, so the returned phase is PENDING.
    expect(created.status?.phase).toBe(ExecutionPhase.EXECUTION_PENDING);

    await awaitTerminal(clients, created.metadata!.id);
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createExecution(org, agentId);

    const fetched = await clients.agentExecutionQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    // Status advances as the run progresses, so parity (which ignores status, id,
    // and version) is the right equivalence here.
    assertResourceParity(AgentExecutionSchema, created, fetched, "create vs get");

    await awaitTerminal(clients, created.metadata!.id);
  });

  it("delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createExecution(org, agentId);
    const id = created.metadata!.id;
    await awaitTerminal(clients, id);

    const deleted = await clients.agentExecutionCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.agentExecutionQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.agentExecutionQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentExecutionQuery.get({ value: "aex_doesnotexist" }),
      Code.NotFound,
      "get missing id",
    ));
});

describe("AgentExecution conformance — distinctness (no duplicate check)", () => {
  it("two identical creates yield two distinct executions (no AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const name = uniqueName("aex-dup");

    const first = await createExecution(org, agentId, name);

    // Same name again: unlike WorkflowExecution there is no duplicate check, so
    // this succeeds with a fresh id rather than rejecting with AlreadyExists.
    mock.enqueue(anthropicText("Done."));
    const second = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name, agentId }));
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: second.metadata!.id }));

    expect(second.metadata?.id, "second create gets a distinct id").not.toBe(first.metadata?.id);
    expect(second.metadata?.id).toMatch(/^aex_[0-9a-z]+$/);

    await awaitTerminal(clients, first.metadata!.id);
    await awaitTerminal(clients, second.metadata!.id);
  });
});

describe("AgentExecution conformance — completion", () => {
  it("a completed run populates started_at and completed_at", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createExecution(org, agentId);

    const final = await awaitTerminal(clients, created.metadata!.id);

    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(final.status?.startedAt, "started_at is set when the run begins").toBeTruthy();
    expect(final.status?.completedAt, "completed_at is set on completion").toBeTruthy();
  });
});

describe("AgentExecution conformance — queries", () => {
  it("list includes created executions", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const a = await createExecution(org, agentId);
    const b = await createExecution(org, agentId);
    await awaitTerminal(clients, a.metadata!.id);
    await awaitTerminal(clients, b.metadata!.id);

    const listed = await clients.agentExecutionQuery.list({});
    const ids = listed.entries.map((e) => e.metadata?.id);

    expect(ids).toContain(a.metadata?.id);
    expect(ids).toContain(b.metadata?.id);
  });

  it("list with a phase filter includes a matching completed execution", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createExecution(org, agentId);
    await awaitTerminal(clients, created.metadata!.id);

    // Whether the server applies the filter or ignores it, a COMPLETED execution
    // must appear in a COMPLETED-filtered list; this asserts inclusion only.
    const listed = await clients.agentExecutionQuery.list({ phase: ExecutionPhase.EXECUTION_COMPLETED });
    expect(listed.entries.map((e) => e.metadata?.id)).toContain(created.metadata?.id);
  });

  it("listBySession returns only the executions for the given session", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);

    // First execution auto-creates a session; reuse its id for a second one.
    const one = await createExecution(org, agentId);
    const sessionId = one.spec?.sessionId;
    expect(sessionId, "create auto-creates and records a session id").toBeTruthy();

    mock.enqueue(anthropicText("Done."));
    const two = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex"), sessionId }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: two.metadata!.id }));

    // A third execution in a different session (a different agent).
    const otherAgentId = await provisionAgent(org);
    const other = await createExecution(org, otherAgentId);

    await awaitTerminal(clients, one.metadata!.id);
    await awaitTerminal(clients, two.metadata!.id);
    await awaitTerminal(clients, other.metadata!.id);

    const listed = await clients.agentExecutionQuery.listBySession({ sessionId: sessionId! });
    const ids = listed.entries.map((e) => e.metadata?.id);

    expect(ids).toContain(one.metadata?.id);
    expect(ids).toContain(two.metadata?.id);
    expect(ids).not.toContain(other.metadata?.id);
  });

  it("listBySession returns an empty list for an unknown session", async () => {
    const listed = await clients.agentExecutionQuery.listBySession({ sessionId: "ses_doesnotexist" });
    expect(listed.entries).toHaveLength(0);
  });

  it("listBySession rejects an empty session_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.agentExecutionQuery.listBySession({ sessionId: "" }),
      Code.InvalidArgument,
      "listBySession empty session_id",
    ));
});

describe("AgentExecution conformance — lifecycle (running execution)", () => {
  it("observes EXECUTION_IN_PROGRESS once the runner picks the execution up", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createHeldExecution(org, agentId);

    const running = await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(running.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);

    // Settle the run before the next test; cancel of a running execution is the
    // next test's subject.
    await clients.agentExecutionCommand.cancel({ id: created.metadata!.id });
    await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_CANCELLED);
  });

  it("cancel transitions a running execution to CANCELLED with completed_at", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createHeldExecution(org, agentId);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.agentExecutionCommand.cancel({ id, reason: "conformance" });

    const cancelled = await awaitPhase(clients, id, ExecutionPhase.EXECUTION_CANCELLED);
    expect(cancelled.status?.completedAt, "cancel records completed_at").toBeTruthy();
  });

  it("terminate transitions a running execution to TERMINATED", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createHeldExecution(org, agentId);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.agentExecutionCommand.terminate({ id, reason: "conformance" });

    const terminated = await awaitPhase(clients, id, ExecutionPhase.EXECUTION_TERMINATED);
    expect(terminated.status?.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
  });

  it("pause then resume moves a running execution PAUSED -> IN_PROGRESS", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createHeldExecution(org, agentId);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.agentExecutionCommand.pause({ id, reason: "conformance" });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_PAUSED);

    // Resume re-invokes the activity, which issues a fresh LLM call; queue another
    // held turn so the resumed run is observably IN_PROGRESS again.
    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    await clients.agentExecutionCommand.resume({ id });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    // Settle the run before the next test.
    await clients.agentExecutionCommand.cancel({ id });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_CANCELLED);
  });
});

describe("AgentExecution conformance — lifecycle preconditions & negatives", () => {
  it("cancel of a completed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createExecution(org, agentId);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.agentExecutionCommand.cancel({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "cancel a completed execution",
    );
  });

  it("terminate of a completed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createExecution(org, agentId);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.agentExecutionCommand.terminate({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "terminate a completed execution",
    );
  });

  it("recover of a non-failed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createExecution(org, agentId);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.agentExecutionCommand.recover({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "recover a completed execution",
    );
  });

  it("resume of a non-paused execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    const created = await createExecution(org, agentId);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.agentExecutionCommand.resume({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "resume a completed execution",
    );
  });

  it("cancel rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.agentExecutionCommand.cancel({ id: "" }), Code.InvalidArgument, "cancel empty id"));

  it("cancel of a missing execution returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentExecutionCommand.cancel({ id: "aex_doesnotexist" }),
      Code.NotFound,
      "cancel missing execution",
    ));

  it("pause of a missing execution returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentExecutionCommand.pause({ id: "aex_doesnotexist" }),
      Code.NotFound,
      "pause missing execution",
    ));
});

describe("AgentExecution conformance — create negative paths", () => {
  it("rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: AGENT_EXECUTION_KIND,
          metadata: { name: uniqueName("aex"), org },
          spec: { agentId, message: "hi" },
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: AGENT_EXECUTION_API_VERSION,
          kind: "NotAnAgentExecution",
          metadata: { name: uniqueName("aex"), org },
          spec: { agentId, message: "hi" },
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("rejects a create with no metadata (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: AGENT_EXECUTION_API_VERSION,
          kind: AGENT_EXECUTION_KIND,
          spec: { agentId, message: "hi" },
        }),
      Code.InvalidArgument,
      "create without metadata",
    );
  });

  it("rejects a create with an empty message (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);
    // spec.message declares min_len=1, enforced by ValidateProtoStep.
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: AGENT_EXECUTION_API_VERSION,
          kind: AGENT_EXECUTION_KIND,
          metadata: { name: uniqueName("aex"), org },
          spec: { agentId, message: "" },
        }),
      Code.InvalidArgument,
      "create with an empty message",
    );
  });

  it("rejects a create against an unknown agent (NotFound)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({ org, name: uniqueName("aex"), agentId: "agt_doesnotexist" }),
        ),
      Code.NotFound,
      "create against an unknown agent",
    );
  });

  it("rejects a create with neither session nor agent (NotFound — no platform default agent)", async () => {
    const { org } = await target.provisionTenancy();
    // resolveDefaultAgentStep runs first and tries to resolve the platform default
    // agent (label stigmer.ai/default-agent), which the single-tenant OSS target
    // does not seed — so the reachable contract is NotFound, not the InvalidArgument
    // that validateSessionOrAgentStep would raise (it is unreachable here).
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: AGENT_EXECUTION_API_VERSION,
          kind: AGENT_EXECUTION_KIND,
          metadata: { name: uniqueName("aex"), org },
          spec: { message: "hi" },
        }),
      Code.NotFound,
      "create with neither session nor agent",
    );
  });
});
