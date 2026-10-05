// Conformance suite for the AgentExecution domain (Class B).
// Domain: agentic / agentexecution — a single user message run through the agent
// engine (Temporal orchestrator + TS runner + mock LLM), driven via the raw proto
// stubs. The second execution domain after WorkflowExecution.
//
// Runs against the local-execution target, so Temporal is always present and
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
// - An empty target (neither session_id nor a session_spec naming an agent)
//   is a VALID request shape: the built-in assistant. The server creates a session with no
//   agent and the runner answers on its one built-in prompt with the tools the
//   session itself carries, so the run reaches COMPLETED like any other — the
//   arm pinned below and in the CRUD suite's session create.
// - The query analogue of listByWorkflow is listBySession (filter by spec.session_id).
//
// A run's ExecutionContext lives as long as the run: the run-end activity
// deletes it through the context's own delete chain (stigmer#1647), so once
// the run settles its context answers NotFound, in every edition.
//
// One-call session bootstrap (stigmer/stigmer#249): create may carry
// spec.session_spec — the full shape of the session to auto-create (its
// agent_ref, workspace, harness, execution_target) alongside the first
// message. The bootstrap describe block below asserts the forwarding, the pin
// the new session records for its agent, and the replacement of session_spec
// by the created session's id; the validation negative lives in the CRUD-level
// suite (suites/agentexecution.conformance.test.ts) so it also gates the cloud
// edition.
//
// A turn's link to the workflow run that started it (spec.parent) is a fact
// the server vouches for, and the turn's dispatch queue follows from it,
// never from a caller: the workflow run's own queue under execution routing,
// the shared runner pool under global routing (the local-execution target's).
// The refusal of an unvouched link under an enforcing posture, and of a link
// that disagrees with the workflow-execution lineage label, need no engine
// and live in the CRUD-level suite; here the admitted link runs.
//
// Covered in a sibling file (kept separate because it needs the MCP tool
// fixture and approval choreography, and this file is already large):
// - submitApproval / HITL tool approval -> agentexecution-approval.conformance.test.ts.
//
// Deliberately out of scope (each needs machinery this suite doesn't build, and
// is a conscious deferral, not shipped as a thin partial):
// - recover happy path (needs a genuinely FAILED execution);
// - usage reports, artifact download/content, subscribe streaming, sub-agents.
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { UploadAttachmentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent, makeAgentRef } from "../support/agents";
import { collectStream } from "../support/collect-stream";
import {
  AGENT_EXECUTION_API_VERSION,
  AGENT_EXECUTION_KIND,
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  pollExecution,
  requireLlmProxy,
  sessionIdOf,
} from "../support/agentexecutions";
import { pollUntil } from "../support/execution-poll";
import { foreignId, uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

// Collection-time capability read (the schedule-firing/forwarder pattern):
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
  // Unblock any still-held turn first so a lifecycle test's runner activity (a
  // paused/cancelled turn the runner can't preempt mid-call) finishes and frees
  // its session lock, instead of lingering into the next test and claiming its
  // queued turns. reset() also drains, but releasing before fixture teardown
  // gives the freed activity time to wind down.
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// A valid Agent. A turn on it starts a new conversation (session_spec.agent_ref);
// the server creates the session and pins the agent's current version.
async function provisionAgent(org: string, name = uniqueName("agent")): Promise<Agent> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

// The raw spec target of a new conversation on `agent`, for the arms that build
// the create request by hand.
function newConversationOn(agent: Agent) {
  return { case: "sessionSpec" as const, value: { agentRef: makeAgentRef(agentRefOf(agent)) } };
}

// Create an execution on `agent`, queuing one text turn so the run reaches
// COMPLETED on its own. Callers awaitTerminal to settle before the test ends.
async function createExecution(org: string, agent: Agent, name = uniqueName("aex")) {
  mock.enqueue(anthropicText("Done."));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name, agentRef: agentRefOf(agent) }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution;
}

// Create an execution whose first (and only queued) turn is held open, so it sits
// in IN_PROGRESS until a lifecycle RPC acts on it.
async function createHeldExecution(org: string, agent: Agent, name = uniqueName("aex")) {
  mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name, agentRef: agentRefOf(agent) }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution;
}

describe("AgentExecution conformance — CRUD & identity", () => {
  it("[rpc:AgentExecutionCommandController.create] create assigns an aex_ id, stamps the agent it runs, and starts PENDING", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("aex");

    const created = await createExecution(org, agent, name);

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^aex_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.status?.agentId, "the turn records the agent its conversation pins").toBe(agent.metadata!.id);
    expect(created.status?.agentVersionHash, "and the version it runs").toBe(agent.status!.versionHash);
    // create persists before starting Temporal, so the returned phase is PENDING.
    expect(created.status?.phase).toBe(ExecutionPhase.EXECUTION_PENDING);

    await awaitTerminal(clients, created.metadata!.id);
  });

  // The engine-backed half of the create-id rule (stigmer/stigmer#1489): the
  // Class A row for this create runs only where an engine backs Class A.
  it("[rpc:AgentExecutionCommandController.create] create never keeps a metadata.id the caller sent", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("aex");
    const chosenId = foreignId("aex");

    mock.enqueue(anthropicText("Done."));
    const created = await clients.agentExecutionCommand.create({
      ...makeAgentExecution({ org, name, agentRef: agentRefOf(agent) }),
      metadata: { id: chosenId, name, org },
    });
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));

    const id = created.metadata?.id ?? "";
    expect(id, `create kept the caller's id ${chosenId}; the server must assign its own`).not.toBe(chosenId);
    expect(id, `create answered ${id}, not an id the server minted`).toMatch(/^aex_[0-9a-hjkmnp-tv-z]{26}$/);
    const read = await clients.agentExecutionQuery.get({ value: id });
    expect(read.metadata?.id, `a read of ${id} answers the execution it names`).toBe(id);

    await awaitTerminal(clients, id);
  });

  it("[rpc:AgentExecutionQueryController.get] get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);

    const fetched = await clients.agentExecutionQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    // Status advances as the run progresses, so parity (which ignores status, id,
    // and version) is the right equivalence here.
    assertResourceParity(AgentExecutionSchema, created, fetched, "create vs get");

    await awaitTerminal(clients, created.metadata!.id);
  });

  it("[rpc:AgentExecutionCommandController.delete] delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    const id = created.metadata!.id;
    await awaitTerminal(clients, id);

    const deleted = await clients.agentExecutionCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.agentExecutionQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("[rpc:AgentExecutionQueryController.get] get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.agentExecutionQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("[rpc:AgentExecutionQueryController.get] get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentExecutionQuery.get({ value: "aex_doesnotexist" }),
      Code.NotFound,
      "get missing id",
    ));
});

describe("AgentExecution conformance — distinctness (no duplicate check)", () => {
  it("[rpc:AgentExecutionCommandController.create] two identical creates yield two distinct executions (no AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("aex-dup");

    const first = await createExecution(org, agent, name);

    // Same name again: unlike WorkflowExecution there is no duplicate check, so
    // this succeeds with a fresh id rather than rejecting with AlreadyExists.
    mock.enqueue(anthropicText("Done."));
    const second = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name, agentRef: agentRefOf(agent) }));
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
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);

    const final = await awaitTerminal(clients, created.metadata!.id);

    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(final.status?.startedAt, "started_at is set when the run begins").toBeTruthy();
    expect(final.status?.completedAt, "completed_at is set on completion").toBeTruthy();
  });

  it("[rpc:ExecutionContextQueryController.getByExecutionId] a run's ExecutionContext is deleted once the run ends", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const executionId = created.metadata!.id;
    const live = await clients.executionContextQuery.getByExecutionId({ executionId });
    expect(live.spec?.executionId, "the run's context exists while the run is held").toBe(executionId);

    mock.releaseHolds();
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    const readContext = async (): Promise<"present" | "gone"> => {
      try {
        await clients.executionContextQuery.getByExecutionId({ executionId });
        return "present";
      } catch (error) {
        if (ConnectError.from(error).code === Code.NotFound) {
          return "gone";
        }
        throw error;
      }
    };
    await pollUntil(
      readContext,
      (state) => state === "gone",
      (_, timeoutMs) =>
        `execution ${executionId}'s ExecutionContext was still readable ${timeoutMs}ms after the run reached ${ExecutionPhase[final.status!.phase]}`,
      { timeoutMs: 30_000 },
    );
  });
});

describe("AgentExecution conformance — queries", () => {
  it("[rpc:AgentExecutionQueryController.list] list includes created executions", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const a = await createExecution(org, agent);
    const b = await createExecution(org, agent);
    await awaitTerminal(clients, a.metadata!.id);
    await awaitTerminal(clients, b.metadata!.id);

    const listed = await clients.agentExecutionQuery.list({});
    const ids = listed.entries.map((e) => e.metadata?.id);

    expect(ids).toContain(a.metadata?.id);
    expect(ids).toContain(b.metadata?.id);
  });

  it("[rpc:AgentExecutionQueryController.list] list with a phase filter includes a matching completed execution", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    // Whether the server applies the filter or ignores it, a COMPLETED execution
    // must appear in a COMPLETED-filtered list; this asserts inclusion only.
    const listed = await clients.agentExecutionQuery.list({ phase: ExecutionPhase.EXECUTION_COMPLETED });
    expect(listed.entries.map((e) => e.metadata?.id)).toContain(created.metadata?.id);
  });

  it("[rpc:AgentExecutionQueryController.listBySession] listBySession returns only the executions for the given session", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);

    // First execution auto-creates a session; reuse its id for a second one.
    const one = await createExecution(org, agent);
    const sessionId = sessionIdOf(one);
    expect(sessionId, "create auto-creates and records a session id").toBeTruthy();

    mock.enqueue(anthropicText("Done."));
    const two = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex"), sessionId }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: two.metadata!.id }));

    // A third execution in a different session (a different agent).
    const otherAgent = await provisionAgent(org);
    const other = await createExecution(org, otherAgent);

    await awaitTerminal(clients, one.metadata!.id);
    await awaitTerminal(clients, two.metadata!.id);
    await awaitTerminal(clients, other.metadata!.id);

    const listed = await clients.agentExecutionQuery.listBySession({ sessionId: sessionId });
    const ids = listed.entries.map((e) => e.metadata?.id);

    expect(ids).toContain(one.metadata?.id);
    expect(ids).toContain(two.metadata?.id);
    expect(ids).not.toContain(other.metadata?.id);
  });

  it("[rpc:AgentExecutionQueryController.listBySession] listBySession returns an empty list for an unknown session", async () => {
    const listed = await clients.agentExecutionQuery.listBySession({ sessionId: "ses_doesnotexist" });
    expect(listed.entries).toHaveLength(0);
  });

  it("[rpc:AgentExecutionQueryController.listBySession] listBySession rejects an empty session_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.agentExecutionQuery.listBySession({ sessionId: "" }),
      Code.InvalidArgument,
      "listBySession empty session_id",
    ));
});

describe("AgentExecution conformance — a turn belongs to its session and its session's organization (#1580, #1588)", () => {
  it("[rpc:AgentExecutionCommandController.create] a turn naming no organization in an existing session is filed under the session's organization (#1580)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const first = await createExecution(org, agent);
    const sessionId = sessionIdOf(first);
    expect(sessionId, "create auto-creates and records a session id").toBeTruthy();

    mock.enqueue(anthropicText("Done."));
    const second = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org: "", name: uniqueName("aex-no-org"), sessionId }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: second.metadata!.id }));

    expect(second.metadata?.org).toBe(org);
    await awaitTerminal(clients, first.metadata!.id);
    await awaitTerminal(clients, second.metadata!.id);
    const listed = await clients.agentExecutionQuery.listBySession({ sessionId: sessionId });
    expect(listed.entries.map((e) => e.metadata?.id)).toContain(second.metadata?.id);
  });

  it("[rpc:AgentExecutionCommandController.update] refuses moving an execution to another session (FailedPrecondition, #1588)", async () => {
    const { org } = await target.provisionTenancy();
    const moved = await createExecution(org, await provisionAgent(org));
    const elsewhere = await createExecution(org, await provisionAgent(org));
    await awaitTerminal(clients, moved.metadata!.id);
    await awaitTerminal(clients, elsewhere.metadata!.id);
    const firstSessionId = sessionIdOf(moved);

    const current = await clients.agentExecutionQuery.get({ value: moved.metadata!.id });
    current.spec!.target = { case: "sessionId", value: sessionIdOf(elsewhere) };
    const refused = await expectGrpcCode(
      () => clients.agentExecutionCommand.update(current),
      Code.FailedPrecondition,
      "update to another session",
    );
    expect(refused.rawMessage).toBe(
      `session_id cannot be changed — an execution belongs to the session it was created in ('${firstSessionId}')`,
    );

    const after = await clients.agentExecutionQuery.get({ value: moved.metadata!.id });
    expect(sessionIdOf(after)).toBe(firstSessionId);
  });
});

describe("AgentExecution conformance — lifecycle (running execution)", () => {
  it("observes EXECUTION_IN_PROGRESS once the runner picks the execution up", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);

    const running = await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(running.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);

    // Settle the run before the next test; cancel of a running execution is the
    // next test's subject.
    await clients.agentExecutionCommand.cancel({ id: created.metadata!.id });
    await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_CANCELLED);
  });

  it("[rpc:AgentExecutionCommandController.cancel] cancel transitions a running execution to CANCELLED with completed_at", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.agentExecutionCommand.cancel({ id, reason: "conformance" });

    const cancelled = await awaitPhase(clients, id, ExecutionPhase.EXECUTION_CANCELLED);
    expect(cancelled.status?.completedAt, "cancel records completed_at").toBeTruthy();
  });

  it("[rpc:AgentExecutionCommandController.terminate] terminate transitions a running execution to TERMINATED", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.agentExecutionCommand.terminate({ id, reason: "conformance" });

    const terminated = await awaitPhase(clients, id, ExecutionPhase.EXECUTION_TERMINATED);
    expect(terminated.status?.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
  });

  // A repeated stop on an execution the same stop already ended is a benign
  // no-op, not a FailedPrecondition: a client that retries a cancel (or a UI
  // whose button was clicked twice) must not see an error for a state it
  // asked for. Distinct from a cancel on a COMPLETED run, which the negatives
  // below reject — the precondition is "not terminal by another outcome".
  // (From the Go offline suite's lifecycle arms.)
  it("[rpc:AgentExecutionCommandController.cancel] a second cancel on a CANCELLED execution is a benign no-op", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);
    await clients.agentExecutionCommand.cancel({ id, reason: "conformance" });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_CANCELLED);

    const again = await clients.agentExecutionCommand.cancel({ id, reason: "conformance, again" });
    expect(again.status?.phase, "the second cancel answers the already-cancelled execution").toBe(
      ExecutionPhase.EXECUTION_CANCELLED,
    );
  });

  it("[rpc:AgentExecutionCommandController.terminate] a second terminate on a TERMINATED execution is a benign no-op", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);
    await clients.agentExecutionCommand.terminate({ id, reason: "conformance" });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_TERMINATED);

    const again = await clients.agentExecutionCommand.terminate({ id, reason: "conformance, again" });
    expect(again.status?.phase, "the second terminate answers the already-terminated execution").toBe(
      ExecutionPhase.EXECUTION_TERMINATED,
    );
  });

  it("[rpc:AgentExecutionCommandController.pause] [rpc:AgentExecutionCommandController.resume] pause then resume moves a running execution PAUSED -> IN_PROGRESS", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.agentExecutionCommand.pause({ id, reason: "conformance" });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_PAUSED);

    // Resume WHILE the first turn is still held. The paused activity is
    // NOT promptly cancelled (cancellation reaches the runner lazily,
    // between coarse graph events), so once its held turn is released it
    // completes and persists a terminal COMPLETED that races everything
    // after it (stigmer#869 family; verified identical on the Go target).
    // While the turn is still HELD, that rogue writer cannot write, and
    // the resumed re-invocation is queued behind the session workspace
    // lock — so the resume RPC's IN_PROGRESS persist is a STABLE
    // observation, not a race. The resumed-era responses are enqueued
    // with differentiated text and THEFT TOLERANCE: when activity
    // cancellation happens to reach the superseded turn mid-stream, the
    // provider client retries the aborted call (retry budget 2) and each
    // retry consumes one queued response (observed on BOTH targets,
    // ~1-in-6); enough copies cover the worst-case theft so the resumed
    // turn is never starved. The afterEach reset clears unconsumed
    // leftovers.
    for (let copy = 0; copy < 4; copy++) {
      mock.enqueue(anthropicText("Working RESUMED..."));
    }
    await clients.agentExecutionCommand.resume({ id });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    // Settle fence: give the WORKER time to consume the buffered pause +
    // resume signals before the held turn can complete. The PAUSED and
    // IN_PROGRESS observations above are the RPCs' own persists — they say
    // nothing about the workflow's signal processing, and a pause signal
    // that is still unprocessed when the original turn's completion
    // reaches the workflow is DROPPED in favor of the completion
    // (`err != nil && pauseRequested` — deliberate byte-parity with Go;
    // the run then finishes with the original text and never re-invokes,
    // which is exactly the ~1-in-5 full-suite flake this fences, observed
    // as the result and the pause landing in ONE activation ~50ms apart).
    // A time fence is the only option: every clean observable of the
    // workflow's progress is value-identical to an RPC write and therefore
    // suppressed by subscribe's consecutive-duplicate guard (Go
    // sameFrame), and the cancelled-but-parked activity neither
    // heartbeats nor touches the mock. 2s is ~40x the worst observed
    // activation lag; a lost race still fails loudly downstream, it just
    // cannot silently pass.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // Releasing the held turn lets BOTH turns finish: the superseded one
    // persists its stale terminal COMPLETED ("Working...") and the
    // resumed one persists its own ("Working RESUMED...") — in EITHER
    // order (stigmer#869: neither edition guards stale writes yet). Proof
    // that the resumed re-invocation ran must therefore not depend on the
    // order: the subscribe stream catches the resumed persist when the
    // rogue write lands LAST (a poll of the stored state would miss it —
    // observed ~1-in-3 on this machine), and the stored-state poll
    // catches it when the rogue write lands FIRST. The release fires
    // inside the stream's first predicate call (the registration
    // snapshot), guaranteeing the subscription sees every later persist.
    const hasResumedText = (e: AgentExecution): boolean =>
      e.status?.messages.some((m) => m.content === "Working RESUMED...") ?? false;
    let released = false;
    const stream = await collectStream(
      (signal) => clients.agentExecutionQuery.subscribe({ value: id }, { signal }),
      {
        until: (messages) => {
          if (!released) {
            released = true;
            mock.releaseHolds();
          }
          return hasResumedText(messages.at(-1)!);
        },
        timeoutMs: 60_000,
      },
    );

    if (!stream.messages.some(hasResumedText)) {
      // The stream closed on the rogue's terminal update instead — then
      // the resumed persist lands LAST and the stored state proves it.
      // This poll also FENCES the resumed turn's queue consumption inside
      // this test (ending earlier would let the still-running resumed
      // activity steal the NEXT test's enqueued response); in the stream
      // arm above, the resumed text in status.messages already proves the
      // queue was consumed.
      await pollExecution(clients, id, hasResumedText, {
        label: "the resumed turn's persisted state",
      });
    }
    const settled = await awaitTerminal(clients, id);
    expect(settled.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});

describe("AgentExecution conformance — lifecycle preconditions & negatives", () => {
  it("[rpc:AgentExecutionCommandController.cancel] cancel of a completed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.agentExecutionCommand.cancel({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "cancel a completed execution",
    );
  });

  it("[rpc:AgentExecutionCommandController.terminate] terminate of a completed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.agentExecutionCommand.terminate({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "terminate a completed execution",
    );
  });

  it("[rpc:AgentExecutionCommandController.recover] recover of a non-failed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.agentExecutionCommand.recover({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "recover a completed execution",
    );
  });

  it("[rpc:AgentExecutionCommandController.resume] resume of a non-paused execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.agentExecutionCommand.resume({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "resume a completed execution",
    );
  });

  it("[rpc:AgentExecutionCommandController.cancel] cancel rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.agentExecutionCommand.cancel({ id: "" }), Code.InvalidArgument, "cancel empty id"));

  it("[rpc:AgentExecutionCommandController.cancel] cancel of a missing execution returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentExecutionCommand.cancel({ id: "aex_doesnotexist" }),
      Code.NotFound,
      "cancel missing execution",
    ));

  it("[rpc:AgentExecutionCommandController.pause] pause of a missing execution returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentExecutionCommand.pause({ id: "aex_doesnotexist" }),
      Code.NotFound,
      "pause missing execution",
    ));
});

describe("AgentExecution conformance — create negative paths", () => {
  it("[rpc:AgentExecutionCommandController.create] rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: AGENT_EXECUTION_KIND,
          metadata: { name: uniqueName("aex"), org },
          spec: { target: newConversationOn(agent), message: "hi" },
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: AGENT_EXECUTION_API_VERSION,
          kind: "NotAnAgentExecution",
          metadata: { name: uniqueName("aex"), org },
          spec: { target: newConversationOn(agent), message: "hi" },
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] rejects a create with no metadata (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: AGENT_EXECUTION_API_VERSION,
          kind: AGENT_EXECUTION_KIND,
          spec: { target: newConversationOn(agent), message: "hi" },
        }),
      Code.InvalidArgument,
      "create without metadata",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] rejects a create with an empty message (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    // spec.message declares min_len=1, enforced by ValidateProtoStep.
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create({
          apiVersion: AGENT_EXECUTION_API_VERSION,
          kind: AGENT_EXECUTION_KIND,
          metadata: { name: uniqueName("aex"), org },
          spec: { target: newConversationOn(agent), message: "" },
        }),
      Code.InvalidArgument,
      "create with an empty message",
    );
  });

  it("[rpc:AgentExecutionCommandController.create] rejects a new conversation on an agent its organization does not hold (FailedPrecondition, naming the slug)", async () => {
    const { org } = await target.provisionTenancy();
    const missing = uniqueName("agent-missing");
    // The reference rule's answer for a same-organization slug that names
    // nothing: the request is well formed, the agent is absent.
    const refused = await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.create(
          makeAgentExecution({ org, name: uniqueName("aex"), agentRef: { org, slug: missing } }),
        ),
      Code.FailedPrecondition,
      "create against an unknown agent",
    );
    expect(refused.rawMessage).toContain(missing);
  });

  it("[rpc:AgentExecutionCommandController.create] runs the built-in assistant to completion when neither session nor agent is named", async () => {
    const { org } = await target.provisionTenancy();
    // The empty target: no session, and no session_spec naming an agent.
    // The server creates a session with NO agent and the runner answers on
    // the built-in prompt; the mock's one text turn is that answer.
    mock.enqueue(anthropicText("Hello from the assistant."));
    const created = await clients.agentExecutionCommand.create({
      apiVersion: AGENT_EXECUTION_API_VERSION,
      kind: AGENT_EXECUTION_KIND,
      metadata: { name: uniqueName("aex-assistant"), org },
      spec: { message: "hi" },
    });
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
    expect(created.status?.agentId ?? "", "no agent is stamped").toBe("");
    const sessionId = sessionIdOf(created);
    expect(sessionId, "a session is created for the assistant").toBeTruthy();
    fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }));

    const session = await clients.sessionQuery.get({ value: sessionId });
    expect(session.spec?.agentRef, "the session names no agent").toBeUndefined();
    expect(session.status?.agentId ?? "", "and pins none").toBe("");

    const settled = await awaitTerminal(clients, created.metadata!.id);
    expect(settled.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});

describe("AgentExecution conformance — one-call session bootstrap (session_spec)", () => {
  it("[rpc:AgentExecutionCommandController.create] creates the session from session_spec, pinned to the agent its agent_ref names, and dispatches the first message in one call", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);

    // A real local directory so the runner can provision the workspace.
    const workspaceDir = mkdtempSync(join(tmpdir(), "stigmer-bootstrap-"));
    writeFileSync(join(workspaceDir, "README.md"), "# bootstrap\n");

    mock.enqueue(anthropicText("Done."));
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-bootstrap"),
        agentRef: agentRefOf(agent),
        sessionSpec: {
          subject: "Bootstrap conformance",
          workspaceEntries: [
            { name: "project", source: { source: { case: "localPath", value: { path: workspaceDir } } } },
          ],
          harness: Harness.NATIVE,
        },
      }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
    const sessionId = sessionIdOf(created);
    expect(sessionId, "create should record the bootstrapped session's id").toBeTruthy();
    fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }));

    // Single source of truth: the Session resource owns the config, so the
    // execution names the created session in place of the embedded spec, and
    // records the agent and version that session pinned.
    expect(created.spec?.target.case, "session_spec is replaced on the returned execution").toBe("sessionId");
    expect(created.status?.agentId).toBe(agent.metadata!.id);
    expect(created.status?.agentVersionHash).toBe(agent.status!.versionHash);

    const persisted = await clients.agentExecutionQuery.get({ value: created.metadata!.id });
    expect(persisted.spec?.target.case, "session_spec is replaced on the persisted execution").toBe("sessionId");

    // The created session carries the full bootstrap shape and the pin.
    const session = await clients.sessionQuery.get({ value: sessionId });
    expect(session.spec?.agentRef?.slug).toBe(agent.metadata!.slug);
    expect(session.status?.agentId, "the session pins the agent its reference resolved to").toBe(agent.metadata!.id);
    expect(session.status?.agentVersionHash, "at the agent's current version").toBe(agent.status!.versionHash);
    expect(session.spec?.subject, "a caller-provided subject survives (no sentinel override)").toBe(
      "Bootstrap conformance",
    );
    expect(session.spec?.harness).toBe(Harness.NATIVE);
    expect(session.spec?.workspaceEntries).toHaveLength(1);
    expect(session.spec?.workspaceEntries?.[0]?.name).toBe("project");
    expect(session.spec?.workspaceEntries?.[0]?.source?.source).toEqual({
      case: "localPath",
      value: expect.objectContaining({ path: workspaceDir }),
    });

    // The first message runs to completion in the bootstrapped session.
    const final = await awaitTerminal(clients, created.metadata!.id);
    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  // The validation negative (the harness_state_id server-owned-field guard)
  // lives in the CRUD-level suite (suites/agentexecution.conformance.test.ts):
  // it needs no engine, and only src/suites/** runs against the cloud edition,
  // which is what gates cloud on the shared validation contract. Do not re-add
  // it here.
});

// The cross-process artifact contract (stigmer/stigmer#285). Nothing else in the
// suite exercises it: the server writes an uploaded attachment to its store,
// and the runner — a separate process — must read it back from the SAME store.
// Before the fix the two disagreed on the path and this failed; the harness
// points local targets at one shared directory (server-process.ts /
// runner-process.ts) and cloud-execution's runner presigns against the real
// service's MinIO-backed artifact routes (stigmer#803), so every case here
// runs unconditionally on every execution target (the retired
// sharedRunnerArtifactStore gate — see target.ts).
// The retired AgentExecutionSpec field that once let a caller name the
// turn's dispatch queue (activity_task_queue, number 11). Reserved on the
// wire: a request carrying it is read with the field as an unknown one.
const RETIRED_ACTIVITY_TASK_QUEUE_FIELD = 11;

describe("AgentExecution conformance — a turn's dispatch queue is the server's to derive", () => {
  it("[rpc:AgentExecutionCommandController.create] a turn linked to a workflow run is admitted under trusted-local and, under global routing, runs on the shared runner pool", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const workflowExecutionId = foreignId("wex");

    mock.enqueue(anthropicText("Done."));
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-parent"),
        agentRef: agentRefOf(agent),
        parent: { workflowExecutionId },
      }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
    expect(created.spec?.parent?.workflowExecutionId, "the trusted-local caller's link is kept").toBe(
      workflowExecutionId,
    );

    // A queue derived from the link (wfexec:<id>) has no poller here; only the
    // shared pool's runner can complete the turn.
    const final = await awaitTerminal(clients, created.metadata!.id);
    expect(
      final.status?.phase,
      `the linked turn should complete on the shared pool; error: ${final.status?.error || "(none)"}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("[rpc:AgentExecutionCommandController.create] a request naming a dispatch queue in the retired field still runs on the shared runner pool", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);

    mock.enqueue(anthropicText("Done."));
    const request = create(
      AgentExecutionSchema,
      makeAgentExecution({ org, name: uniqueName("aex-queue"), agentRef: agentRefOf(agent) }),
    );
    // The retired field's bytes as a caller could still send them: a string
    // naming a queue no runner polls.
    request.spec!.$unknown = [
      {
        no: RETIRED_ACTIVITY_TASK_QUEUE_FIELD,
        wireType: WireType.LengthDelimited,
        data: new BinaryWriter().string(`wfexec:${foreignId("wex")}`).finish(),
      },
    ];
    const created = await clients.agentExecutionCommand.create(request);
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));

    const final = await awaitTerminal(clients, created.metadata!.id);
    expect(
      final.status?.phase,
      `a caller-named queue must never route the turn; error: ${final.status?.error || "(none)"}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});

describe("AgentExecution conformance — attachments (#285)", () => {
  it("[rpc:AgentExecutionCommandController.uploadAttachment] resolves a storage-key attachment (no local_path) the server wrote to the shared store", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org, uniqueName("agent-attach"));

    // Upload through the server; it lands in the server's local artifact store.
    const filename = "readme-285.txt";
    const content = Buffer.from(`shared-store proof ${Date.now()}`);
    const uploaded = await clients.agentExecutionCommand.uploadAttachment(
      create(UploadAttachmentRequestSchema, {
        filename,
        content,
        contentType: "text/plain",
      }),
    );
    expect(uploaded.storageKey).toMatch(/^attachments\/.+\/readme-285\.txt$/);

    // A storage-key attachment with NO local_path — the branch that forces the
    // runner to read from artifact storage rather than the CLI's local fast path.
    mock.enqueue(anthropicText("Got your file."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-attach"),
        agentRef: agentRefOf(agent),
        message: "Here is a file.",
        attachments: [{ filename, storageKey: uploaded.storageKey }],
      }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));

    // Attachment injection is fail-hard, so reaching COMPLETED is itself proof
    // that the runner resolved the storage-key attachment from the shared store.
    const final = await awaitTerminal(clients, execution.metadata!.id);
    expect(
      final.status?.phase,
      `expected COMPLETED; error: ${final.status?.error || "(none)"}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // And the materialized bytes match end to end. The runner writes
    // attachments to the session platform dir under ITS home — the
    // harness-owned directory the target spawned it with, never this process's
    // — and it never deletes the session tree, so we read it there.
    const sessionId = sessionIdOf(final);
    expect(sessionId, "execution should carry a session id").toBeTruthy();
    if (target.runnerHomeDir === undefined) {
      throw new Error(`target ${target.name} spawns no runner; the attachment arm needs its home directory`);
    }
    const materialized = join(
      target.runnerHomeDir(),
      ".stigmer",
      "sessions",
      sessionId,
      "platform",
      "inputs",
      filename,
    );
    const got = await readFile(materialized);
    expect(Buffer.compare(got, content)).toBe(0);
  });

  // The thread-rendering seam (stigmer/stigmer#372): a submitted attachment's
  // storage key must presign via getArtifactDownloadUrl so the message thread
  // can show the turn's files after the composer's local handles are gone.
  // Attachment keys carry no execution id, so ownership is the execution's
  // spec.attachments referencing the key verbatim — and ONLY that: a key the
  // spec never referenced is rejected even when syntactically valid.
  it("[rpc:AgentExecutionQueryController.getArtifactDownloadUrl] presigns a spec-referenced attachment key and rejects a foreign one (#372)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org, uniqueName("agent-presign"));

    const filename = "evidence-372.txt";
    const uploaded = await clients.agentExecutionCommand.uploadAttachment(
      create(UploadAttachmentRequestSchema, {
        filename,
        content: Buffer.from("presign proof"),
        contentType: "text/plain",
      }),
    );

    mock.enqueue(anthropicText("Received."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-presign"),
        agentRef: agentRefOf(agent),
        message: "Here is a file.",
        attachments: [{ filename, storageKey: uploaded.storageKey }],
      }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));

    // The spec-referenced key presigns — no need to wait for the run.
    const presigned = await clients.agentExecutionQuery.getArtifactDownloadUrl({
      executionId: execution.metadata!.id,
      storageKey: uploaded.storageKey,
    });
    expect(presigned.downloadUrl, "attachment key should presign").toBeTruthy();

    // A foreign attachment key (valid shape, never referenced) is rejected.
    await expectGrpcCode(
      () =>
        clients.agentExecutionQuery.getArtifactDownloadUrl({
          executionId: execution.metadata!.id,
          storageKey: "attachments/01JXFOREIGNULIDULIDULIDULX/other.txt",
        }),
      Code.InvalidArgument,
      "presign foreign attachment key",
    );

    // Leave the background run settled so teardown is quiet.
    await awaitTerminal(clients, execution.metadata!.id);
  });

  // The vision contract, proven at the provider boundary: an image
  // attachment must reach the model as an inline image block, not just as a
  // file on disk. This is the offline substitute for a live vision probe — the
  // captured request is byte-for-byte what Anthropic would have received
  // (@langchain/anthropic converts the runner's image_url data-URL block into
  // the native base64 source block on the wire).
  it("delivers an image attachment to the provider as an inline base64 image block (vision)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org, uniqueName("agent-vision"));

    // A real (sniffable) PNG: correct magic bytes, arbitrary payload.
    const filename = "photo-vision.png";
    const pngBytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(120, 0xab),
    ]);
    const uploaded = await clients.agentExecutionCommand.uploadAttachment(
      create(UploadAttachmentRequestSchema, {
        filename,
        content: pngBytes,
        contentType: "image/png",
      }),
    );

    mock.enqueue(anthropicText("I can see the image."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-vision"),
        agentRef: agentRefOf(agent),
        message: "What is in this image?",
        attachments: [{ filename, storageKey: uploaded.storageKey }],
      }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));

    const final = await awaitTerminal(clients, execution.metadata!.id);
    expect(
      final.status?.phase,
      `expected COMPLETED; error: ${final.status?.error || "(none)"}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // The provider-bound payload: find the user message carrying block content.
    interface AnthropicWireBlock {
      type: string;
      text?: string;
      source?: { type?: string; media_type?: string; data?: string };
    }
    interface AnthropicWireMessage {
      role: string;
      content: string | AnthropicWireBlock[];
    }
    const llmBodies = mock
      .requests()
      .map((r) => r.body as { messages?: AnthropicWireMessage[] } | undefined);
    const userBlockMessages = llmBodies
      .flatMap((b) => b?.messages ?? [])
      .filter((m) => m.role === "user" && Array.isArray(m.content));
    expect(
      userBlockMessages.length,
      "the LLM request should carry a block-content user message",
    ).toBeGreaterThan(0);

    const blocks = userBlockMessages[0]!.content as AnthropicWireBlock[];
    // The ordinal filename label precedes the image (pixel-to-filename
    // association), and the image arrives as Anthropic's native base64 block
    // carrying the EXACT uploaded bytes with the sniffed media type. The text
    // block after it is the turn's message: this turn's Input Files section
    // (the file, its vision disclosure) set off by a rule from what the user
    // typed, because a turn's payload rides its own message and never the
    // system prompt (the request-shape suite pins why).
    expect(blocks).toEqual([
      { type: "text", text: `Image 1: ${filename}` },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: pngBytes.toString("base64"),
        },
      },
      expect.objectContaining({
        type: "text",
        text: expect.stringMatching(
          new RegExp(`^## Input Files\\n[\\s\\S]*\`\\.stigmer/inputs/${filename.replace(".", "\\.")}\`[\\s\\S]*\\n\\n---\\n\\nWhat is in this image\\?$`),
        ),
      }),
    ]);
  });
});

// --- the subscribe lane and the read surfaces a real run populates ---------
//
// Streams are consumed through collectStream, the bounded reader that keeps
// the idle-forever quirk (pinned below) from hanging the suite.

describe("AgentExecution conformance — subscribe & populated read surfaces", () => {
  it("[rpc:AgentExecutionQueryController.subscribe] subscribe on a LIVE run streams the snapshot, its updates, and closes on the terminal one", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);

    // Subscribed while the run is in flight: the lane's contract is
    // snapshot-first, then full-snapshot updates, then a clean server close
    // when an UPDATE reaches a terminal phase.
    const stream = await collectStream((signal) =>
      clients.agentExecutionQuery.subscribe({ value: created.metadata!.id }, { signal }),
    );
    expect(stream.outcome, "the server closes on the terminal update").toBe("closed");
    expect(stream.messages.length, "at least the snapshot plus the terminal update").toBeGreaterThanOrEqual(2);
    expect(stream.messages[0]?.metadata?.id).toBe(created.metadata?.id);
    expect(stream.messages.at(-1)?.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("[rpc:AgentExecutionQueryController.subscribe] subscribe sends the snapshot but never closes on an already-terminal run (the pinned idle-forever quirk)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    // The terminal-close check fires only on broker UPDATES, never on the
    // initial snapshot — a subscription to a finished run receives the
    // snapshot and then idles forever. Pinned deliberately: the server keeps
    // it consciously, or fixes it in both editions.
    const stream = await collectStream(
      (signal) => clients.agentExecutionQuery.subscribe({ value: created.metadata!.id }, { signal }),
      { timeoutMs: 3_000 },
    );
    // The store serializes the runner's terminal write and the workflow's
    // fallback persist, so no trailing broker update ever follows the snapshot
    // to trip the close check — exactly one message, and the reader aborts.
    expect(stream.outcome, "no server close — the bounded reader had to abort").toBe("timeout");
    expect(stream.messages).toHaveLength(1);
    expect(stream.messages[0]?.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("[rpc:AgentExecutionQueryController.getExecutionUsageReport] a completed run's usage report answers the zero-valued aggregate (this edition records no usage)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    // The strongest form of the zero-shapes contract: the execution EXISTS
    // (the NotFound arm is Class A), yet the aggregate is still a
    // structurally complete zero report — OSS deliberately aggregates no
    // usage data at all.
    const report = await clients.agentExecutionQuery.getExecutionUsageReport({
      executionId: created.metadata!.id,
    });
    expect(report.aggregate, "the aggregate is always present").toBeDefined();
    expect(report.aggregate?.totalTokens).toBe(0n);
    expect(report.aggregate?.inputTokens).toBe(0n);
    expect(report.aggregate?.outputTokens).toBe(0n);
    expect(report.modelBreakdown).toHaveLength(0);
  });

  it("[rpc:AgentExecutionCommandController.submitFileDecision] submitFileDecision refuses a run with no actionable file change sets (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    // A text-only completed run has an empty file-review stream AND a
    // terminal phase — both fold into the same precondition refusal (there
    // is deliberately no separate wrong-phase arm). The deeper arms need
    // file-edit choreography; the digest-mismatch arm lives in
    // agentexecution-file-review.conformance.test.ts. Message prefix only:
    // the copy embeds the phase enum's rendering, which is the Go
    // formatter's, not a contract.
    const err = await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitFileDecision({
          agentExecutionId: created.metadata!.id,
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
        }),
      Code.FailedPrecondition,
      "submitFileDecision on a run that produced no file changes",
    );
    expect(err.rawMessage).toContain(
      `execution ${created.metadata!.id} has no actionable file change sets`,
    );
  });
});
