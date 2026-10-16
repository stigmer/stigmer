// Conformance suite for the Run domain (Class B).
// Domain: agentic / agentexecution — a single user message run through the agent
// engine (Temporal orchestrator + TS runner + mock LLM), driven via the raw proto
// stubs.
//
// Runs against the local-execution target, so Temporal is always present and
// the workflowCreator is injected: create starts a real Temporal workflow that
// the runner picks up and drives through an LLM loop served by the in-process mock proxy.
// Every run is scripted by enqueuing turns on that mock — a single text turn
// reaches COMPLETED; a `delayMs`-held turn keeps an execution genuinely
// IN_PROGRESS so lifecycle RPCs (terminate/pause/resume, and the session's
// interrupt) act on a running thing.
//
// Contract points encoded as assertions below:
// - No AlreadyExists on create: repeated identical creates yield distinct run_
//   ids (there is no CheckDuplicateStep in the agent-execution pipeline).
// - An empty target (neither session_id nor a session_spec naming an agent)
//   is a VALID request shape: the built-in assistant. The server creates a session with no
//   agent and the runner answers on its one built-in prompt with the tools the
//   session itself carries, so the run reaches COMPLETED like any other — the
//   arm pinned below and in the CRUD suite's session create.
// - Runs are listed by conversation through listBySession (filter by spec.session_id).
//
// One-call session bootstrap (stigmer/stigmer#249): create may carry
// spec.session_spec — the full shape of the session to auto-create (its
// agent_ref, workspace, harness, execution_target) alongside the first
// message. The bootstrap describe block below asserts the forwarding, the pin
// the new session records for its agent, and the replacement of session_spec
// by the created session's id; the validation negative lives in the CRUD-level
// suite (suites/run.conformance.test.ts) so it also gates the cloud
// edition.
//
// A turn's dispatch queue is the server's to derive, never a caller's: the
// retired request field that once named one is read as an unknown field.
//
// A run's file reaches a browser through the link getArtifactDownloadUrl
// mints. Where artifact storage is local, the attachments block below fetches
// that link from the server's file server: inline by default, an attachment
// when a download is asked for, and an altered, unsigned or re-dated link
// answered like a missing key.
//
// Covered in a sibling file (kept separate because it needs the MCP tool
// fixture and approval choreography, and this file is already large):
// - the session's answers / HITL tool approval -> run-approval.conformance.test.ts.
//
// A completed run's usage reports count its tokens: from the server's meter
// where the target routes the runner's model calls through one
// (CapabilityFlags.runModelCallsMetered), else from the run's own runner
// report, marked estimated, the fallback every edition shares. The mock's
// one text turn carries 10 input and 5 output tokens, so the numbers are
// exact. The organization report's window is the run's creation day, both
// bounds inclusive.
//
// Deliberately out of scope (each needs machinery this suite doesn't build, and
// is a conscious deferral, not shipped as a thin partial):
// - recover happy path (needs a genuinely FAILED execution);
// - artifact content, sub-agents.
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { UploadAttachmentRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { ProviderKeySource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent, makeAgentRef } from "../support/agents";
import {
  AGENT_EXECUTION_API_VERSION,
  AGENT_EXECUTION_KIND,
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  sessionIdOf,
} from "../support/runs";
import { messagesOf, turnById } from "../support/turn";
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
// (interrupt/terminate/pause), so the wall-clock cost is tiny.
const HOLD_MS = 30_000;

// Collection-time capability read: whether this target's runner reaches a
// meter decides which of the two usage arms below runs.
const { capabilities } = createTarget();

// The UTC calendar day a run was created on, read from the server's own
// stamp: the day the usage reports window and bucket it by, immune to a
// midnight between create and read.
function createdDayOf(run: Run): string {
  const createdAt = run.status?.audit?.specAudit?.createdAt;
  if (createdAt === undefined) throw new Error(`run ${run.metadata?.id ?? "?"} carries no creation stamp`);
  return timestampDate(createdAt).toISOString().slice(0, 10);
}

// The UTC calendar day `days` after `day` (YYYY-MM-DD).
function dayShift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

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

describe("Run conformance — CRUD & identity", () => {
  it("[rpc:RunCommandController.create] create assigns a run_ id, stamps the agent it runs, and starts PENDING", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("aex");

    const created = await createExecution(org, agent, name);

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^run_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.status?.agentId, "the turn records the agent its conversation pins").toBe(agent.metadata!.id);
    expect(created.status?.agentVersionHash, "and the version it runs").toBe(agent.status!.versionHash);
    // create persists before starting Temporal, so the returned phase is PENDING.
    expect(created.status?.phase).toBe(RunPhase.RUN_PENDING);

    await awaitTerminal(clients, created.metadata!.id);
  });

  // The engine-backed half of the create-id rule (stigmer/stigmer#1489): the
  // Class A row for this create runs only where an engine backs Class A.
  it("[rpc:RunCommandController.create] create never keeps a metadata.id the caller sent", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("aex");
    const chosenId = foreignId("run");

    mock.enqueue(anthropicText("Done."));
    const created = await clients.agentExecutionCommand.create({
      ...makeAgentExecution({ org, name, agentRef: agentRefOf(agent) }),
      metadata: { id: chosenId, name, org },
    });
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));

    const id = created.metadata?.id ?? "";
    expect(id, `create kept the caller's id ${chosenId}; the server must assign its own`).not.toBe(chosenId);
    expect(id, `create answered ${id}, not an id the server minted`).toMatch(/^run_[0-9a-hjkmnp-tv-z]{26}$/);
    const read = await clients.agentExecutionQuery.get({ value: id });
    expect(read.metadata?.id, `a read of ${id} answers the execution it names`).toBe(id);

    await awaitTerminal(clients, id);
  });

  it("[rpc:RunQueryController.get] get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);

    const fetched = await clients.agentExecutionQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    // Status advances as the run progresses, so parity (which ignores status, id,
    // and version) is the right equivalence here.
    assertResourceParity(RunSchema, created, fetched, "create vs get");

    await awaitTerminal(clients, created.metadata!.id);
  });

  it("[rpc:RunCommandController.delete] delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    const id = created.metadata!.id;
    await awaitTerminal(clients, id);

    const deleted = await clients.agentExecutionCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.agentExecutionQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("[rpc:RunQueryController.get] get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.agentExecutionQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("[rpc:RunQueryController.get] get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentExecutionQuery.get({ value: "aex_doesnotexist" }),
      Code.NotFound,
      "get missing id",
    ));
});

describe("Run conformance — distinctness (no duplicate check)", () => {
  it("[rpc:RunCommandController.create] two identical creates yield two distinct executions (no AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const name = uniqueName("aex-dup");

    const first = await createExecution(org, agent, name);

    // Same name again: there is no duplicate check, so
    // this succeeds with a fresh id rather than rejecting with AlreadyExists.
    mock.enqueue(anthropicText("Done."));
    const second = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name, agentRef: agentRefOf(agent) }));
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: second.metadata!.id }));

    expect(second.metadata?.id, "second create gets a distinct id").not.toBe(first.metadata?.id);
    expect(second.metadata?.id).toMatch(/^run_[0-9a-z]+$/);

    await awaitTerminal(clients, first.metadata!.id);
    await awaitTerminal(clients, second.metadata!.id);
  });
});

describe("Run conformance — completion", () => {
  it("a completed run populates started_at and completed_at", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);

    const final = await awaitTerminal(clients, created.metadata!.id);

    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(final.status?.startedAt, "started_at is set when the run begins").toBeTruthy();
    expect(final.status?.completedAt, "completed_at is set on completion").toBeTruthy();
  });
});

describe("Run conformance — queries", () => {
  it("[rpc:RunQueryController.list] list includes created executions", async () => {
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

  it("[rpc:RunQueryController.list] list with a phase filter includes a matching completed execution", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    await awaitTerminal(clients, created.metadata!.id);

    // Whether the server applies the filter or ignores it, a COMPLETED execution
    // must appear in a COMPLETED-filtered list; this asserts inclusion only.
    const listed = await clients.agentExecutionQuery.list({ phase: RunPhase.RUN_COMPLETED });
    expect(listed.entries.map((e) => e.metadata?.id)).toContain(created.metadata?.id);
  });

  it("[rpc:RunQueryController.listBySession] listBySession returns only the executions for the given session", async () => {
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

  it("[rpc:RunQueryController.listBySession] listBySession returns an empty list for an unknown session", async () => {
    const listed = await clients.agentExecutionQuery.listBySession({ sessionId: "ses_doesnotexist" });
    expect(listed.entries).toHaveLength(0);
  });

  it("[rpc:RunQueryController.listBySession] listBySession rejects an empty session_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.agentExecutionQuery.listBySession({ sessionId: "" }),
      Code.InvalidArgument,
      "listBySession empty session_id",
    ));
});

describe("Run conformance — a turn belongs to its session and its session's organization (#1580, #1588)", () => {
  it("[rpc:RunCommandController.create] a turn naming no organization in an existing session is filed under the session's organization (#1580)", async () => {
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

  it("[rpc:RunCommandController.update] refuses moving an execution to another session (FailedPrecondition, #1588)", async () => {
    const { org } = await target.provisionTenancy();
    const moved = await createExecution(org, await provisionAgent(org));
    const elsewhere = await createExecution(org, await provisionAgent(org));
    await awaitTerminal(clients, moved.metadata!.id);
    await awaitTerminal(clients, elsewhere.metadata!.id);
    const firstSessionId = sessionIdOf(moved);

    const current = await clients.agentExecutionQuery.get({ value: moved.metadata!.id });
    current.spec!.target = { case: "sessionId", value: sessionIdOf(elsewhere) };
    const refused = await expectGrpcCode(
      () => clients.agentExecutionCommand.update({ resource: current, updateMask: { paths: ["*"] } }),
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

describe("Run conformance — lifecycle (running execution)", () => {
  it("observes RUN_IN_PROGRESS once the runner picks the execution up", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);

    const running = await awaitPhase(clients, created.metadata!.id, RunPhase.RUN_IN_PROGRESS);
    expect(running.status?.phase).toBe(RunPhase.RUN_IN_PROGRESS);

    // Settle the run before the next test; stopping a running turn is the
    // next test's subject.
    await clients.sessionCommand.interrupt({ sessionId: sessionIdOf(running) });
    await awaitPhase(clients, created.metadata!.id, RunPhase.RUN_CANCELLED);
  });

  it("[rpc:SessionCommandController.interrupt] interrupt stops a running turn: CANCELLED by the person, with completed_at", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    const running = await awaitPhase(clients, id, RunPhase.RUN_IN_PROGRESS);

    const stopped = await clients.sessionCommand.interrupt({ sessionId: sessionIdOf(running) });
    expect(stopped.stoppedRunIds).toEqual([id]);

    const cancelled = await awaitPhase(clients, id, RunPhase.RUN_CANCELLED);
    expect(cancelled.status?.completedAt, "the stop records completed_at").toBeTruthy();
    expect(cancelled.status?.stopCause).toBe("user");
  });

  it("[rpc:RunCommandController.terminate] terminate transitions a running execution to TERMINATED", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, RunPhase.RUN_IN_PROGRESS);

    await clients.agentExecutionCommand.terminate({ id, reason: "conformance" });

    const terminated = await awaitPhase(clients, id, RunPhase.RUN_TERMINATED);
    expect(terminated.status?.phase).toBe(RunPhase.RUN_TERMINATED);
  });

  // A repeated stop is a benign no-op, not an error: a client that retries an
  // interrupt (or a UI whose button was clicked twice) must not see an error
  // for a state it asked for. The interrupt stops only what is unfinished, so
  // the second one stops nothing and the turn stays as the first left it.
  // (From the Go offline suite's lifecycle arms.)
  it("[rpc:SessionCommandController.interrupt] a second interrupt, once the turn is stopped, stops nothing", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    const running = await awaitPhase(clients, id, RunPhase.RUN_IN_PROGRESS);
    const sessionId = sessionIdOf(running);
    await clients.sessionCommand.interrupt({ sessionId });
    await awaitPhase(clients, id, RunPhase.RUN_CANCELLED);

    const again = await clients.sessionCommand.interrupt({ sessionId });
    expect(again.stoppedRunIds, "nothing was left to stop").toEqual([]);
    expect((await clients.agentExecutionQuery.get({ value: id })).status?.phase).toBe(RunPhase.RUN_CANCELLED);
  });

  it("[rpc:RunCommandController.terminate] a second terminate on a TERMINATED execution is a benign no-op", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, RunPhase.RUN_IN_PROGRESS);
    await clients.agentExecutionCommand.terminate({ id, reason: "conformance" });
    await awaitPhase(clients, id, RunPhase.RUN_TERMINATED);

    const again = await clients.agentExecutionCommand.terminate({ id, reason: "conformance, again" });
    expect(again.status?.phase, "the second terminate answers the already-terminated execution").toBe(
      RunPhase.RUN_TERMINATED,
    );
  });

  it("[rpc:RunCommandController.pause] [rpc:RunCommandController.resume] pause then resume moves a running execution PAUSED -> IN_PROGRESS", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createHeldExecution(org, agent);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, RunPhase.RUN_IN_PROGRESS);

    await clients.agentExecutionCommand.pause({ id, reason: "conformance" });
    await awaitPhase(clients, id, RunPhase.RUN_PAUSED);

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
    await awaitPhase(clients, id, RunPhase.RUN_IN_PROGRESS);

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
    // workflow's progress is value-identical to an RPC write, and the
    // cancelled-but-parked activity neither heartbeats nor touches the mock.
    // 2s is ~40x the worst observed activation lag; a lost race still fails
    // loudly downstream, it just cannot silently pass.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // Releasing the held turn ends the run one of two ways, both right. The
    // resumed re-invocation waits behind the session workspace lock the
    // superseded turn holds. When the pause's cancellation reaches the
    // superseded turn first (at its next heartbeat), it stops, and the
    // resumed invocation runs and answers "Working RESUMED...". When the
    // superseded turn's answer is ready first, it completes the run with
    // "Working..."; the resumed invocation then finds the run finished once
    // it has the workspace and runs nothing (runner
    // harness/turn-context.ts `runFinishedWhileWaiting`), as the server takes
    // no more events of a finished run. Either way the run ends COMPLETED,
    // and its log's answer is the invocation that finished it. The resumed
    // invocation writes COMPLETED only after its model call, so the terminal
    // read below also fences the queue: no activity of this run is left to
    // take the next test's enqueued response.
    mock.releaseHolds();
    const settled = await awaitTerminal(clients, id);
    expect(settled.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const answers = messagesOf(await turnById(clients, sessionIdOf(settled), id)).map((message) => message.text);
    expect(["Working...", "Working RESUMED..."], `the run's answer (messages: ${JSON.stringify(answers)})`).toContain(
      answers.at(-1),
    );
    if (answers.at(-1) === "Working...") {
      expect(answers, "a run the superseded turn finished holds nothing of the resumed one").not.toContain(
        "Working RESUMED...",
      );
    }
  });
});

describe("Run conformance — lifecycle preconditions & negatives", () => {
  it("[rpc:SessionCommandController.interrupt] an interrupt after the turn completed stops nothing and leaves it COMPLETED", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    const ended = await awaitTerminal(clients, created.metadata!.id);

    const stopped = await clients.sessionCommand.interrupt({ sessionId: sessionIdOf(ended) });
    expect(stopped.stoppedRunIds, "a finished turn is left as it is").toEqual([]);
    expect((await clients.agentExecutionQuery.get({ value: created.metadata!.id })).status?.phase).toBe(
      RunPhase.RUN_COMPLETED,
    );
  });

  it("[rpc:RunCommandController.terminate] terminate of a completed execution is rejected with FailedPrecondition", async () => {
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

  it("[rpc:RunCommandController.recover] recover of a non-failed execution is rejected with FailedPrecondition", async () => {
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

  it("[rpc:RunCommandController.resume] resume of a non-paused execution is rejected with FailedPrecondition", async () => {
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

  it("[rpc:RunCommandController.pause] pause of a missing execution returns NotFound", () =>
    expectGrpcCode(
      () => clients.agentExecutionCommand.pause({ id: "aex_doesnotexist" }),
      Code.NotFound,
      "pause missing execution",
    ));
});

describe("Run conformance — create negative paths", () => {
  it("[rpc:RunCommandController.create] rejects a wrong api_version (InvalidArgument)", async () => {
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

  it("[rpc:RunCommandController.create] rejects a wrong kind (InvalidArgument)", async () => {
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

  it("[rpc:RunCommandController.create] rejects a create with no metadata (InvalidArgument)", async () => {
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

  it("[rpc:RunCommandController.create] rejects a create with an empty message (InvalidArgument)", async () => {
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

  it("[rpc:RunCommandController.create] rejects a new conversation on an agent its organization does not hold (FailedPrecondition, naming the slug)", async () => {
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

  it("[rpc:RunCommandController.create] runs the built-in assistant to completion when neither session nor agent is named", async () => {
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
    expect(settled.status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });
});

describe("Run conformance — one-call session bootstrap (session_spec)", () => {
  it("[rpc:RunCommandController.create] creates the session from session_spec, pinned to the agent its agent_ref names, and dispatches the first message in one call", async () => {
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
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });
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
// The retired RunSpec field that once let a caller name the
// turn's dispatch queue (activity_task_queue, number 11). Reserved on the
// wire: a request carrying it is read with the field as an unknown one.
const RETIRED_ACTIVITY_TASK_QUEUE_FIELD = 11;

describe("Run conformance — a turn's dispatch queue is the server's to derive", () => {
  it("[rpc:RunCommandController.create] a request naming a dispatch queue in the retired field still runs on the shared runner pool", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);

    mock.enqueue(anthropicText("Done."));
    const request = create(
      RunSchema,
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
    ).toBe(RunPhase.RUN_COMPLETED);
  });
});

describe("Run conformance — attachments (#285)", () => {
  it("[rpc:RunCommandController.uploadAttachment] resolves a storage-key attachment (no local_path) the server wrote to the shared store", async () => {
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
    ).toBe(RunPhase.RUN_COMPLETED);

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
  it("[rpc:RunQueryController.getArtifactDownloadUrl] presigns a spec-referenced attachment key and rejects a foreign one (#372)", async () => {
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
      runId: execution.metadata!.id,
      storageKey: uploaded.storageKey,
    });
    expect(presigned.downloadUrl, "attachment key should presign").toBeTruthy();

    // A foreign attachment key (valid shape, never referenced) is rejected.
    await expectGrpcCode(
      () =>
        clients.agentExecutionQuery.getArtifactDownloadUrl({
          runId: execution.metadata!.id,
          storageKey: "attachments/01JXFOREIGNULIDULIDULIDULX/other.txt",
        }),
      Code.InvalidArgument,
      "presign foreign attachment key",
    );

    // Leave the background run settled so teardown is quiet.
    await awaitTerminal(clients, execution.metadata!.id);
  });

  // The local file server, on the wire: the link getArtifactDownloadUrl
  // mints is fetched as a browser would, with no credentials. Inline by
  // default (no disposition header), an attachment named by the key's file
  // name when the caller asks for a download, and the same link with its
  // signature altered or removed, its expiry moved, or its download name
  // changed, answered 404 exactly as a missing key: the signature covers
  // the key, the expiry and the download name. Only local artifact storage
  // serves this lane (the targets with an on-disk store); cloud's links are
  // presigned object-store URLs, a different contract, so the case reports
  // SKIPPED there.
  it("[rpc:RunQueryController.getArtifactDownloadUrl] the local file server serves a run's file inline at the minted link, as an attachment when a download is asked for, and answers an altered, removed or re-dated signature 404 like a missing key", async (ctx) => {
    if (target.artifactStoreDir === undefined) {
      return ctx.skip("this target keeps run files in an object store, whose presigned links are not this lane");
    }
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org, uniqueName("agent-fileserver"));

    const filename = "file-server-proof.txt";
    const content = new TextEncoder().encode("file-server conformance body\n");
    const uploaded = await clients.agentExecutionCommand.uploadAttachment(
      create(UploadAttachmentRequestSchema, { filename, content, contentType: "text/plain" }),
    );

    mock.enqueue(anthropicText("Received."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-fileserver"),
        agentRef: agentRefOf(agent),
        message: "Here is a file.",
        attachments: [{ filename, storageKey: uploaded.storageKey }],
      }),
    );
    const runId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }));

    const inlineLink = await clients.agentExecutionQuery.getArtifactDownloadUrl({
      runId,
      storageKey: uploaded.storageKey,
    });
    const inline = await fetch(inlineLink.downloadUrl);
    expect(inline.status, "the minted link serves the file").toBe(200);
    expect(inline.headers.get("content-disposition"), "a link minted without a download is served inline").toBeNull();
    expect(new Uint8Array(await inline.arrayBuffer())).toEqual(content);

    const attachmentLink = await clients.agentExecutionQuery.getArtifactDownloadUrl({
      runId,
      storageKey: uploaded.storageKey,
      asAttachment: true,
    });
    const attachment = await fetch(attachmentLink.downloadUrl);
    expect(attachment.status).toBe(200);
    expect(attachment.headers.get("content-disposition"), "a download is saved under the key's file name").toBe(
      `attachment; filename="${filename}"`,
    );
    expect(new Uint8Array(await attachment.arrayBuffer())).toEqual(content);

    const minted = new URL(inlineLink.downloadUrl);
    const missing = await fetch(`${minted.origin}/not-a-stored-key`);
    expect(missing.status).toBe(404);
    const notFound = await missing.text();

    const signature = minted.searchParams.get("sig") ?? "";
    expect(signature, "the minted link carries its signature").not.toBe("");
    const tampered = new URL(minted);
    // The first character, never the last: a base64url signature's last
    // character carries padding bits a decoder may ignore.
    tampered.searchParams.set("sig", `${signature.startsWith("A") ? "B" : "A"}${signature.slice(1)}`);
    const renamed = new URL(attachmentLink.downloadUrl);
    renamed.searchParams.set("download", "renamed.txt");
    const unsigned = new URL(minted);
    unsigned.searchParams.delete("sig");
    const expiry = minted.searchParams.get("exp") ?? "";
    expect(expiry, "the minted link carries its expiry").toMatch(/^\d+$/);
    // Later, not earlier: extending a link's life is the alteration a
    // holder would want, and a past expiry is refused for that alone.
    const extended = new URL(minted);
    extended.searchParams.set("exp", String(Number(expiry) + 3600));
    for (const [what, url] of [
      ["the inline link with its signature altered", tampered],
      ["the download link with another download name", renamed],
      ["the inline link with its signature removed", unsigned],
      ["the inline link with its expiry moved later", extended],
    ] as const) {
      const refused = await fetch(url);
      expect(refused.status, what).toBe(404);
      expect(await refused.text(), `${what} is answered as a missing key`).toBe(notFound);
    }

    // Leave the background run settled so teardown is quiet.
    await awaitTerminal(clients, runId);
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
    ).toBe(RunPhase.RUN_COMPLETED);

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

// --- the read surfaces a real run populates ---------------------------------

describe("Run conformance — populated read surfaces", () => {
  describe.skipIf(capabilities.runModelCallsMetered)("a run whose model calls no meter served", () => {
    it("[billing.rpc.get-run-usage-report.unmetered-run-counts-runner-report] [rpc:RunQueryController.getRunUsageReport] [rpc:RunQueryController.getSessionUsageReport] [rpc:RunQueryController.getAgentUsageReport] a completed run's usage reports carry its runner's tokens, marked estimated", async () => {
      const { org } = await target.provisionTenancy();
      const agent = await provisionAgent(org);
      const created = await createExecution(org, agent);
      const ended = await awaitTerminal(clients, created.metadata!.id);
      expect(ended.status?.phase).toBe(RunPhase.RUN_COMPLETED);

      // The runner's own report of the mock's one turn. Its input count
      // includes the cache buckets; the usage report's does not.
      const runner = ended.status?.streamingUsage;
      expect(runner?.inputTokens, "the mock's turn carries 10 input tokens").toBe(10n);
      expect(runner?.outputTokens, "and 5 output tokens").toBe(5n);
      expect(runner?.totalTokens).toBe(15n);
      const model = runner?.model ?? "";
      expect(model, "the runner names the model it ran").not.toBe("");

      const report = await clients.agentExecutionQuery.getRunUsageReport({ runId: created.metadata!.id });
      const aggregate = report.aggregate;
      expect(aggregate, "the aggregate is always present").toBeDefined();
      expect(aggregate?.inputTokens, "input less the cache buckets").toBe(runner!.inputTokens - runner!.cacheReadTokens - runner!.cacheWriteTokens);
      expect(aggregate?.cacheReadInputTokens).toBe(runner?.cacheReadTokens);
      expect(aggregate?.cacheCreationInputTokens).toBe(runner?.cacheWriteTokens);
      expect(aggregate?.outputTokens).toBe(5n);
      expect(aggregate?.totalTokens, "the runner's own total").toBe(15n);
      expect(aggregate?.llmCallCount, "a runner's report counts no calls").toBe(0);
      expect(aggregate?.primaryModel).toBe(model);
      expect(
        aggregate?.servedBy.map((row) => [row.providerKeySource, row.totalTokens, row.llmCallCount]),
        "no meter saw the calls, so whose key served them is unknown",
      ).toEqual([[ProviderKeySource.UNSPECIFIED, 15n, 0]]);
      expect(report.modelBreakdown.map((row) => [row.model, row.totalTokens, row.callCount])).toEqual([[model, 15n, 0]]);

      // The conversation's report marks the run, and so itself, estimated.
      const session = await clients.agentExecutionQuery.getSessionUsageReport({ sessionId: sessionIdOf(ended) });
      expect(session.isEstimated).toBe(true);
      expect(session.totalUsage?.totalTokens).toBe(15n);
      expect(session.runs.map((run) => [run.runId, run.isEstimated, run.totalTokens])).toEqual([[created.metadata!.id, true, 15n]]);

      const agentReport = await clients.agentExecutionQuery.getAgentUsageReport({ agentId: agent.metadata!.id, org });
      expect(agentReport.totalRuns).toBe(1);
      expect(agentReport.totalUsage?.totalTokens).toBe(15n);
    });
  });

  describe.skipIf(!capabilities.runModelCallsMetered)("a run whose model calls the server metered", () => {
    it("a completed run's usage reports read the meter: calls counted, never estimated", async () => {
      const { org } = await target.provisionTenancy();
      const agent = await provisionAgent(org);
      const created = await createExecution(org, agent);
      const ended = await awaitTerminal(clients, created.metadata!.id);
      expect(ended.status?.phase).toBe(RunPhase.RUN_COMPLETED);

      const report = await clients.agentExecutionQuery.getRunUsageReport({ runId: created.metadata!.id });
      expect(report.aggregate?.llmCallCount, "the meter counts the turn's model call").toBeGreaterThan(0);
      expect(report.aggregate?.totalTokens).toBe(15n);
      expect(
        report.aggregate?.servedBy.map((row) => row.providerKeySource),
        "the meter knows whose key served each call",
      ).not.toContain(ProviderKeySource.UNSPECIFIED);

      const session = await clients.agentExecutionQuery.getSessionUsageReport({ sessionId: sessionIdOf(ended) });
      expect(session.isEstimated).toBe(false);
      expect(session.runs.map((run) => [run.runId, run.isEstimated, run.totalTokens])).toEqual([[created.metadata!.id, false, 15n]]);
    });
  });

  it("[rpc:RunQueryController.getOrgUsageReport] a run is inside the organization report of the day it was created, both bounds inclusive, and outside the days around it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await provisionAgent(org);
    const created = await createExecution(org, agent);
    const ended = await awaitTerminal(clients, created.metadata!.id);
    const day = createdDayOf(ended);

    // "Today" as the console asks for it: both bounds the same UTC day. A
    // run created at any instant of that day is inside it.
    const today = await clients.agentExecutionQuery.getOrgUsageReport({ org, fromDate: day, toDate: day });
    expect(today.totalRuns).toBe(1);
    expect(today.totalAgents).toBe(1);
    expect(today.totalUsage?.totalTokens).toBe(15n);
    expect(today.topAgents.map((row) => [row.agentId, row.runCount, row.totalTokens])).toEqual([[agent.metadata!.id, 1, 15n]]);
    expect(today.dailyUsage.map((row) => [row.date, row.runCount, row.totalTokens])).toEqual([[day, 1, 15n]]);
    expect(today.harnessUsage.map((row) => [row.runCount, row.totalTokens])).toEqual([[1, 15n]]);

    const before = await clients.agentExecutionQuery.getOrgUsageReport({ org, fromDate: dayShift(day, -1), toDate: dayShift(day, -1) });
    expect(before.totalRuns, "a window ending the day before leaves the run out").toBe(0);
    const after = await clients.agentExecutionQuery.getOrgUsageReport({ org, fromDate: dayShift(day, 1), toDate: dayShift(day, 1) });
    expect(after.totalRuns, "a window starting the day after leaves the run out").toBe(0);
  });
});
