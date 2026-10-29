// In-process test for the run-loop tools: run_agent, get_run,
// submit_run_approval, and cancel_run.
//
// Same harness as reads.test.ts: a real Connect backend serving
// stubbed controllers, the MCP server driven through an in-memory client. The
// stubs capture requests so the tests assert the exact protos the tools send
// (slug→reference resolution and a missing agent's not-found, the turn's
// target, a follow-up refused when it names another agent or organization
// than the session's, the vaults a new conversation names, an empty or
// malformed vault entry refused before anything starts, a follow-up refused
// when it names vaults or include_my_vault, the plugins a new conversation
// uses and a follow-up refused when it names them, each answer reaching the
// run's session as the confirmation or grant it names, the interrupt of the
// run's session) and script run state (running vs terminal) and the run's
// event log (paged) to exercise the turn summary, the raw event view, the
// transcript fields dropped from the run, and the cancel short-circuit. A
// scripted RPC failure per method pins the error copy each tool returns when
// the backend refuses (rpcerr's classification plus what the tool names).

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import {
  RunSchema,
  type Run,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  SessionSchema,
  type Session,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type {
  ConfirmToolUseInput,
  GrantPermissionInput,
  InterruptSessionInput,
  ListSessionEventsRequest,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SessionQueryController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/query_pb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const knownAgent = create(AgentSchema, {
  apiVersion: "v1",
  kind: "agent",
  metadata: { name: "Code Reviewer", slug: "code-reviewer", org: "acme", id: "agt_1" },
});

/** A run with a scriptable phase. */
function runFixture(phase: RunPhase): Run {
  return create(RunSchema, {
    apiVersion: "v1",
    kind: "Run",
    metadata: { name: "run", org: "acme", id: "run_1" },
    spec: { target: { case: "sessionId", value: "ses_1" }, message: "review this" },
    status: {
      agentId: "agt_1",
      phase,
      startedAt: "2026-10-13T10:00:00Z",
    },
  });
}

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

let seq = 0n;
const text = (t: string) => [{ type: "text", text: t }];

/** One stored event of run_1, on a thread ("" for the primary). */
function ev(event: EventInit, threadId = ""): SessionEvent {
  seq += 1n;
  return create(SessionEventSchema, { seq, sessionId: "ses_1", runId: "run_1", threadId, event });
}

/**
 * run_1's log: a message, a thinking, a read whose output was offloaded, a
 * sub-agent that answered, the to-do list, a note, a compaction, a shell
 * call that asks, the changed files, an error, a structured output, and
 * the turn waiting; plus an event of a member this build does not know.
 */
function runEvents(): SessionEvent[] {
  const thread = "run_1.task1";
  return [
    ev({ case: "userMessage", value: { id: "run_1.user", content: text("review this") } }),
    ev({ case: "stigmerRunStatus", value: { id: "run_1.status.running", phase: "running" } }),
    ev({ case: "agentMessage", value: { id: "run_1.root.m0", content: text("Reading the diff.") } }),
    ev({ case: "agentThinking", value: { id: "run_1.root.t0" } }),
    ev({ case: "stigmerAgentThinking", value: { id: "run_1.root.t0.text", thinkingId: "run_1.root.t0", text: "Check the tests first." } }),
    ev({ case: "agentToolUse", value: { id: "run_1.c1", name: "read_file", input: { path: "a.go" } } }),
    ev({ case: "agentToolResult", value: { id: "run_1.c1.r", toolUseId: "run_1.c1", content: text("package a…") } }),
    ev({
      case: "stigmerToolResultFullOutput",
      value: { id: "run_1.c1.full", toolUseId: "run_1.c1", storageKey: "artifacts/run_1/toolcalls/c1.txt", sizeBytes: 4096n, mimeType: "text/plain" },
    }),
    ev({ case: "agentToolUse", value: { id: thread, name: "task", input: { description: "research" } } }),
    ev({ case: "sessionThreadCreated", value: { id: `${thread}.created`, agentName: "researcher", sessionThreadId: thread } }),
    ev({ case: "agentThreadMessageSent", value: { id: `${thread}.sent`, toSessionThreadId: thread, content: text("find the flake") } }),
    ev({ case: "agentMessage", value: { id: `${thread}.m0`, content: text("Looking.") } }, thread),
    ev({ case: "agentThreadMessageReceived", value: { id: `${thread}.received`, fromSessionThreadId: thread, content: text("found it") } }),
    ev({ case: "sessionThreadStatusIdle", value: { id: `${thread}.idle`, sessionThreadId: thread, stopReason: { type: "end_turn" } } }),
    ev({ case: "agentToolResult", value: { id: `${thread}.r`, toolUseId: thread, content: text("found it") } }),
    ev({ case: "agentToolUse", value: { id: "run_1.c2", name: "write_todos", input: { todos: [{ content: "fix the test", status: "in_progress" }] } } }),
    ev({ case: "agentToolResult", value: { id: "run_1.c2.r", toolUseId: "run_1.c2", content: text("ok") } }),
    ev({ case: "stigmerHarnessNote", value: { id: "run_1.root.n0", text: "web search is off" } }),
    ev({ case: "agentThreadContextCompacted", value: { id: "run_1.cmp" } }),
    ev({ case: "agentMessage", value: { id: "run_1.root.m1", content: text("Running the tests.") } }),
    ev({ case: "agentToolUse", value: { id: "run_1.c3", name: "shell", input: { command: "go test ./..." }, evaluatedPermission: "ask" } }),
    ev({ case: "stigmerPermissionAsked", value: { id: "run_1.c3.ask", toolUseId: "run_1.c3", message: "Run go test", argsPreview: "go test ./..." } }),
    ev({
      case: "stigmerFileReviewChanges",
      value: {
        id: "run_1.fr0",
        changeSetId: "run_1:0",
        aggregateDigest: "agg",
        files: [{ fileChangeId: "run_1:0:a.go", path: "a.go", change: "modified", digest: "da" }],
      },
    }),
    ev({ case: "sessionError", value: { id: "run_1.err", error: { type: "unknown_error", message: "retrying" } } }),
    ev({ case: "stigmerAgentStructuredOutput", value: { id: "run_1.output", output: { verdict: "pending" } } }),
    ev({ case: "stigmerRunStatus", value: { id: "run_1.status.waiting", phase: "waiting" } }),
    create(SessionEventSchema, { seq: 999n, sessionId: "ses_1", runId: "run_1" }),
  ];
}

/** A Managed Agents event as the answer RPCs return it. */
function answerEvent(event: EventInit): SessionEvent {
  return create(SessionEventSchema, { seq: 1000n, sessionId: "ses_1", runId: "run_1", event });
}

/** A session on code-reviewer, its reference holding the agent's organization id. */
function sessionFixture(agentRef?: { org: string; slug: string }): Session {
  return create(SessionSchema, {
    metadata: { org: "acme", id: "ses_42" },
    spec: agentRef === undefined ? {} : { agentRef: { kind: ApiResourceKind.agent, ...agentRef } },
  });
}

let backend: Http2Server;
let client: Client;
const openSessions = new Set<ServerHttp2Session>();

// Captured requests / scripted state, reset per test.
let createdRun: Run | undefined;
let runState: Run;
let sessionState: Session;
let eventLog: SessionEvent[];
let eventListRequests: ListSessionEventsRequest[];
let confirmations: ConfirmToolUseInput[];
let grants: GrantPermissionInput[];
let grantGivesNoGrant: boolean;
let interrupts: InterruptSessionInput[];
let agentLookups = 0;

/** Backend methods scripted to refuse, keyed "<service>.<method>". */
const failures = new Map<string, ConnectError>();

/** Throw the scripted refusal for `method`, when one is set. */
function refuseIfScripted(method: string): void {
  const failure = failures.get(method);
  if (failure !== undefined) {
    throw failure;
  }
}

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function parseText(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(AgentQueryController, {
      getByReference: (req) => {
        agentLookups++;
        if (req.org === "org-down") {
          throw new ConnectError("agents hidden", Code.PermissionDenied);
        }
        if (req.slug !== knownAgent.metadata?.slug) {
          throw new ConnectError(`agent ${req.slug} not found`, Code.NotFound);
        }
        return knownAgent;
      },
    });
    router.service(RunQueryController, {
      get: () => {
        refuseIfScripted("run.get");
        return runState;
      },
    });
    router.service(SessionQueryController, {
      get: (req) => {
        if (req.value === "ses_gone") {
          throw new ConnectError("session ses_gone not found", Code.NotFound);
        }
        return sessionState;
      },
      listEvents: (req) => {
        refuseIfScripted("session.listEvents");
        eventListRequests.push(req);
        // Two pages: the first half, then the rest.
        const half = Math.ceil(eventLog.length / 2);
        return req.pageToken === ""
          ? { events: eventLog.slice(0, half), nextPageToken: "page-2" }
          : { events: eventLog.slice(half), nextPageToken: "" };
      },
    });
    router.service(SessionCommandController, {
      confirmToolUse: (req) => {
        refuseIfScripted("session.confirmToolUse");
        confirmations.push(req);
        return answerEvent({
          case: "userToolConfirmation",
          value: { id: "conf_1", toolUseId: req.toolUseId, result: req.result, denyMessage: req.denyMessage },
        });
      },
      grantPermission: (req) => {
        grants.push(req);
        return {
          grant: grantGivesNoGrant
            ? undefined
            : answerEvent({ case: "stigmerPermissionGrant", value: { id: "grant_1", toolUseId: req.toolUseId, scope: "turn" } }),
          confirmations: [
            answerEvent({ case: "userToolConfirmation", value: { id: "conf_a", toolUseId: req.toolUseId, result: "allow" } }),
            answerEvent({ case: "userToolConfirmation", value: { id: "conf_b", toolUseId: "run_1.c4", result: "allow" } }),
          ],
        };
      },
      interrupt: (req) => {
        refuseIfScripted("session.interrupt");
        interrupts.push(req);
        return { stoppedRunIds: ["run_1", "run_2"] };
      },
    });
    router.service(RunCommandController, {
      create: (req) => {
        refuseIfScripted("run.create");
        createdRun = req;
        return runFixture(RunPhase.RUN_PENDING);
      },
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;

  const mcp = createServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "runs-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

beforeEach(() => {
  createdRun = undefined;
  runState = runFixture(RunPhase.RUN_IN_PROGRESS);
  sessionState = sessionFixture({ org: "acme", slug: "code-reviewer" });
  eventLog = runEvents();
  eventListRequests = [];
  confirmations = [];
  grants = [];
  grantGivesNoGrant = false;
  interrupts = [];
  agentLookups = 0;
  failures.clear();
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("run tools integration", () => {
  it("advertises the run-loop tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "run_agent",
        "get_run",
        "submit_run_approval",
        "cancel_run",
      ]),
    );
  });

  it("run_agent resolves the slug and starts a new conversation on the agent's reference", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "review this PR",
    });
    expect(result.isError).toBeFalsy();

    const target = createdRun?.spec?.target;
    expect(target?.case).toBe("sessionSpec");
    // The agent by reference, no version: the session pins the current one.
    expect(target?.case === "sessionSpec" ? target.value.agentRef : undefined).toMatchObject({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "code-reviewer",
      version: "",
    });
    expect(createdRun?.kind).toBe("Run");
    expect(createdRun?.spec?.message).toBe("review this PR");
    expect(createdRun?.metadata?.org).toBe("acme");
    // The caller is a person on their own token: their My vault is included
    // unless they say otherwise, and no shared vault is named.
    expect(target?.case === "sessionSpec" ? target.value.includeMyVault : undefined).toBe(true);
    expect(target?.case === "sessionSpec" ? target.value.vaults : undefined).toEqual([]);
    expect(target?.case === "sessionSpec" ? target.value.plugins : undefined).toEqual([]);

    // The created run comes back as plain protojson (its status is small).
    const created = parseText(result);
    expect((created.metadata as Record<string, unknown>).id).toBe("run_1");
  });

  it("run_agent names a new conversation's vaults in order, a slug in org and an org/slug as given", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "triage the queue",
      vaults: ["support-tools", "platform/shared-keys"],
      include_my_vault: false,
    });
    expect(result.isError).toBeFalsy();
    const target = createdRun?.spec?.target;
    const spec = target?.case === "sessionSpec" ? target.value : undefined;
    expect(spec?.includeMyVault).toBe(false);
    expect(spec?.vaults.map((ref) => [ref.kind, ref.org, ref.slug])).toEqual([
      [ApiResourceKind.vault, "acme", "support-tools"],
      [ApiResourceKind.vault, "platform", "shared-keys"],
    ]);
  });

  it("run_agent names a new conversation's plugins in order, a slug in org and an org/slug as given", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "triage the queue",
      plugins: ["linear", "platform/github"],
    });
    expect(result.isError).toBeFalsy();
    const target = createdRun?.spec?.target;
    const spec = target?.case === "sessionSpec" ? target.value : undefined;
    expect(spec?.plugins.map((ref) => [ref.kind, ref.org, ref.slug])).toEqual([
      [ApiResourceKind.plugin, "acme", "linear"],
      [ApiResourceKind.plugin, "platform", "github"],
    ]);
  });

  it("run_agent refuses a plugin entry that names no plugin and starts nothing", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "triage the queue",
      plugins: ["acme/"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'plugins: "acme/" is not a plugin name; name each plugin by slug or org/slug.',
    );
    expect(agentLookups).toBe(0);
    expect(createdRun).toBeUndefined();
  });

  it("run_agent refuses plugins on a follow-up and starts nothing", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "again",
      session_id: "ses_42",
      plugins: ["linear"],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("keeps the plugins it was started with");
    expect(createdRun).toBeUndefined();
  });

  it.each(["", "   "])("run_agent refuses an empty vault entry (%j) and starts nothing", async (entry) => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "triage the queue",
      vaults: ["support-tools", entry],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "vaults: an entry is empty; name each vault by slug or org/slug.",
    );
    expect(agentLookups).toBe(0);
    expect(createdRun).toBeUndefined();
  });

  it.each(["acme/", "/support-tools", "acme/support/tools"])(
    "run_agent refuses the vault entry %j, which names no vault, and starts nothing",
    async (entry) => {
      const result = await callTool("run_agent", {
        org: "acme",
        agent: "code-reviewer",
        message: "triage the queue",
        vaults: [entry],
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(
        `vaults: "${entry}" is not a vault name; name each vault by slug or org/slug.`,
      );
      expect(agentLookups).toBe(0);
      expect(createdRun).toBeUndefined();
    },
  );

  it("run_agent reports an unknown agent as not found and starts nothing", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "no-such-agent",
      message: "hello",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'agent "no-such-agent" in org "acme" not found',
    );
    expect(createdRun).toBeUndefined();
  });

  it("run_agent threads a session follow-up", async () => {
    await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "and the tests?",
      session_id: "ses_42",
    });
    // The session id alone: the session runs the agent it started on, so the
    // turn does not name it, and an org equal to the session's reference
    // needs no lookup.
    expect(createdRun?.spec?.target).toEqual({ case: "sessionId", value: "ses_42" });
    expect(agentLookups).toBe(0);
    // The follow-up names no organization: the server files it under the
    // session's, which may differ from the agent's (stigmer/stigmer#1580).
    expect(createdRun?.metadata?.org).toBe("");
  });

  it.each([
    ["vaults", { vaults: ["support-tools"] }],
    ["include_my_vault alone", { include_my_vault: false }],
  ])("run_agent refuses %s on a follow-up and starts nothing", async (_case, choice) => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "again",
      session_id: "ses_42",
      ...choice,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("keeps the vaults it was started with");
    expect(createdRun).toBeUndefined();
  });

  it("run_agent refuses a follow-up naming another agent than the session's", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "release-bot",
      message: "and the tests?",
      session_id: "ses_42",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'session "ses_42" runs agent "code-reviewer" in org "acme", not agent "release-bot" in org "acme"',
    );
    expect(createdRun).toBeUndefined();
  });

  it("run_agent refuses a follow-up naming an agent in a session on the built-in assistant", async () => {
    sessionState = sessionFixture();
    const result = await callTool("run_agent", {
      org: "",
      agent: "code-reviewer",
      message: "and the tests?",
      session_id: "ses_42",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'session "ses_42" runs the built-in assistant, not agent "code-reviewer"',
    );
    expect(createdRun).toBeUndefined();
  });

  it("run_agent resolves an org given as a slug against the id the session's reference holds", async () => {
    sessionState = sessionFixture({ org: "acme", slug: "code-reviewer" });
    const result = await callTool("run_agent", {
      org: "acme-corp",
      agent: "code-reviewer",
      message: "and the tests?",
      session_id: "ses_42",
    });

    // "acme-corp" is not the reference's text; the stub resolves the named
    // agent to organization "acme", the one the reference holds.
    expect(result.isError).toBeFalsy();
    expect(agentLookups).toBe(1);
    expect(createdRun?.spec?.target).toEqual({ case: "sessionId", value: "ses_42" });
  });

  it("run_agent refuses a follow-up whose org names another organization's agent", async () => {
    sessionState = sessionFixture({ org: "org_other", slug: "code-reviewer" });
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "and the tests?",
      session_id: "ses_42",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      'session "ses_42" runs agent "code-reviewer" in org "org_other", not agent "code-reviewer" in org "acme"',
    );
    expect(createdRun).toBeUndefined();
  });

  it("run_agent reports a session it cannot read and starts nothing", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "and the tests?",
      session_id: "ses_gone",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('session "ses_gone"');
    expect(createdRun).toBeUndefined();
  });

  it("run_agent reports an agent it cannot read while checking a follow-up's org, and starts nothing", async () => {
    sessionState = sessionFixture({ org: "acme", slug: "code-reviewer" });
    const result = await callTool("run_agent", {
      org: "org-down",
      agent: "code-reviewer",
      message: "and the tests?",
      session_id: "ses_42",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('agent "code-reviewer" in org "org-down"');
    expect(createdRun).toBeUndefined();
  });

  it("run_agent reports a run the backend refuses to create, naming the agent", async () => {
    failures.set("run.create", new ConnectError("quota exhausted", Code.ResourceExhausted));
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "review this PR",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("unexpected error: quota exhausted");
  });

  it("get_run reads the run's events, every page, and summarizes the turn in the compact view", async () => {
    const result = await callTool("get_run", { run_id: "run_1" });
    expect(result.isError).toBeFalsy();

    // The run's own events from its session, walking every page.
    expect(eventListRequests.map((r) => [r.sessionId, r.runId, r.pageToken])).toEqual([
      ["ses_1", "run_1", ""],
      ["ses_1", "run_1", "page-2"],
    ]);

    const body = parseText(result);
    expect(body.view).toBe("compact");
    // The run is its lifecycle record.
    const status = ((body.run as Record<string, unknown>).status ?? {}) as Record<string, unknown>;
    expect(status.phase).toBe("RUN_IN_PROGRESS");
    expect(status.started_at).toBe("2026-10-13T10:00:00Z");

    const turn = body.turn as Record<string, unknown>;
    expect(turn).toMatchObject({
      phase: "waiting",
      ended: false,
      stop_cause: "",
      error: "",
      answer: "Running the tests.",
      asks: [
        {
          tool_use_id: "run_1.c3",
          name: "shell",
          mcp_server_name: "",
          input: { command: "go test ./..." },
          message: "Run go test",
          args_preview: "go test ./...",
        },
      ],
      todos: [{ content: "fix the test", status: "in_progress" }],
      structured_output: { verdict: "pending" },
      file_review: [{ change_set_id: "run_1:0", undecided: true, files: [{ path: "a.go", change: "modified", state: "undecided" }] }],
      errors: [{ type: "unknown_error", message: "retrying" }],
      total_items: 9,
    });
    // Default tail of 5, ending with the newest item.
    const items = turn.items as Array<Record<string, unknown>>;
    expect(items.map((item) => item.type)).toEqual(["tool_use", "note", "compacted", "message", "tool_use"]);
    expect(items[4]).toMatchObject({ tool_use_id: "run_1.c3", state: "waiting", result: "" });
  });

  it("get_run honors item_limit, and shows each kind of item", async () => {
    const body = parseText(await callTool("get_run", { run_id: "run_1", item_limit: 20 }));
    const items = (body.turn as Record<string, unknown>).items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(9);
    expect(items.slice(0, 4)).toEqual([
      { type: "message", text: "Reading the diff." },
      { type: "thinking", text: "Check the tests first." },
      {
        type: "tool_use",
        tool_use_id: "run_1.c1",
        name: "read_file",
        mcp_server_name: "",
        state: "completed",
        input: { path: "a.go" },
        result: "package a…",
        // The result is the head; the whole output is the run's artifact.
        full_output: { storage_key: "artifacts/run_1/toolcalls/c1.txt", size_bytes: "4096", mime_type: "text/plain" },
      },
      {
        type: "tool_use",
        tool_use_id: "run_1.task1",
        name: "task",
        mcp_server_name: "",
        state: "completed",
        input: { description: "research" },
        result: "found it",
        sub_agent: { agent_name: "researcher", state: "completed", reply: "found it", total_items: 1 },
      },
    ]);
    expect(items.slice(5, 7)).toEqual([{ type: "note", text: "web search is off" }, { type: "compacted" }]);

    const two = parseText(await callTool("get_run", { run_id: "run_1", item_limit: 2 }));
    expect(((two.turn as Record<string, unknown>).items as unknown[]).length).toBe(2);
  });

  it("get_run returns a null turn before the run's first event", async () => {
    eventLog = [];
    const body = parseText(await callTool("get_run", { run_id: "run_1" }));
    expect(body.turn).toBeNull();
  });

  it("get_run view=full returns every event of the run as Managed Agents JSON", async () => {
    const body = parseText(await callTool("get_run", { run_id: "run_1", view: "full" }));
    expect(body.view).toBe("full");
    expect(((body.run as Record<string, unknown>).status as Record<string, unknown>).messages).toBeUndefined();
    const events = body.events as Array<Record<string, unknown>>;
    // The event holding no member this build knows is left out.
    expect(events).toHaveLength(runEvents().length - 1);
    expect(events[0]).toMatchObject({ type: "user.message", id: "run_1.user", content: [{ type: "text", text: "review this" }] });
    expect(events.map((e) => e.type)).toContain("stigmer.permission.asked");
  });

  it("get_run refuses an empty run id without calling the backend", async () => {
    failures.set("run.get", new ConnectError("must not be called", Code.Internal));
    const result = await callTool("get_run", { run_id: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("run_id is required");
  });

  it("get_run reports a run it cannot find", async () => {
    failures.set("run.get", new ConnectError("no such run", Code.NotFound));
    const result = await callTool("get_run", { run_id: "run_9" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'run "run_9" not found. Verify the org and slug are correct.',
    );
  });

  it("get_run reports events it cannot read, naming the run", async () => {
    failures.set("session.listEvents", new ConnectError("no", Code.PermissionDenied));
    const result = await callTool("get_run", { run_id: "run_1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'Permission denied for the events of run "run_1". Check your API key permissions.',
    );
  });

  it("get_run refuses a run that names no session", async () => {
    runState = create(RunSchema, { metadata: { id: "run_1" }, status: { phase: RunPhase.RUN_PENDING } });
    const result = await callTool("get_run", { run_id: "run_1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('run "run_1" names no session');
    expect(eventListRequests).toEqual([]);
  });

  it.each([
    ["allow", undefined, ""],
    ["deny", "wrong repository", "wrong repository"],
  ])("submit_run_approval %s confirms the tool use on the run's session", async (decision, reason, denyMessage) => {
    const result = await callTool("submit_run_approval", {
      run_id: "run_1",
      tool_use_id: "run_1.c3",
      decision,
      ...(reason === undefined ? {} : { reason }),
    });
    expect(result.isError).toBeFalsy();
    expect(confirmations.map((c) => [c.sessionId, c.toolUseId, c.result, c.denyMessage])).toEqual([
      ["ses_1", "run_1.c3", decision, denyMessage],
    ]);
    expect(grants).toEqual([]);
    const body = parseText(result);
    expect(body).toMatchObject({ decision, tool_use_id: "run_1.c3" });
    expect(body.confirmations).toEqual([
      { type: "user.tool_confirmation", id: "conf_1", tool_use_id: "run_1.c3", result: decision, ...(denyMessage === "" ? {} : { deny_message: denyMessage }) },
    ]);
  });

  it("submit_run_approval allow_all grants the call's class, returning the grant and every confirmation", async () => {
    const body = parseText(
      await callTool("submit_run_approval", { run_id: "run_1", tool_use_id: "run_1.c3", decision: "allow_all" }),
    );
    expect(grants.map((g) => [g.sessionId, g.toolUseId])).toEqual([["ses_1", "run_1.c3"]]);
    expect(confirmations).toEqual([]);
    expect(body.grant).toMatchObject({ type: "stigmer.permission.grant", id: "grant_1", tool_use_id: "run_1.c3" });
    expect((body.confirmations as Array<Record<string, unknown>>).map((c) => c.tool_use_id)).toEqual(["run_1.c3", "run_1.c4"]);
  });

  it("submit_run_approval allow_all on a call with no class returns no grant", async () => {
    grantGivesNoGrant = true;
    const body = parseText(
      await callTool("submit_run_approval", { run_id: "run_1", tool_use_id: "run_1.c3", decision: "allow_all" }),
    );
    expect(body.grant).toBeNull();
  });

  it("submit_run_approval refuses a reason with anything but deny, and answers nothing", async () => {
    const result = await callTool("submit_run_approval", {
      run_id: "run_1",
      tool_use_id: "run_1.c3",
      decision: "allow",
      reason: "looks fine",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("reason is only accepted with deny");
    expect(confirmations).toEqual([]);
  });

  it("submit_run_approval reports an answer the backend refuses", async () => {
    failures.set(
      "session.confirmToolUse",
      new ConnectError("tool use run_1.c3 no longer waits", Code.FailedPrecondition),
    );
    const result = await callTool("submit_run_approval", {
      run_id: "run_1",
      tool_use_id: "run_1.c3",
      decision: "allow",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("unexpected error: tool use run_1.c3 no longer waits");
  });

  it("submit_run_approval reports a run it cannot find, and answers nothing", async () => {
    failures.set("run.get", new ConnectError("no such run", Code.NotFound));
    const result = await callTool("submit_run_approval", {
      run_id: "run_9",
      tool_use_id: "run_1.c3",
      decision: "allow",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('run "run_9" not found. Verify the org and slug are correct.');
    expect(confirmations).toEqual([]);
  });

  it("cancel_run interrupts the run's session and names the runs it stopped", async () => {
    const body = parseText(await callTool("cancel_run", { run_id: "run_1" }));
    expect(interrupts.map((i) => i.sessionId)).toEqual(["ses_1"]);
    expect(body).toEqual({ already_terminal: false, session_id: "ses_1", stopped_run_ids: ["run_1", "run_2"] });
  });

  it("cancel_run short-circuits a terminal run, stopping nothing", async () => {
    runState = runFixture(RunPhase.RUN_COMPLETED);
    const body = parseText(await callTool("cancel_run", { run_id: "run_1" }));
    expect(interrupts).toEqual([]);
    expect(body.already_terminal).toBe(true);
    const status = (body.run as Record<string, unknown>).status as Record<string, unknown>;
    expect(status.phase).toBe("RUN_COMPLETED");
  });

  it("cancel_run reports an interrupt the backend refuses", async () => {
    failures.set("session.interrupt", new ConnectError("engine not connected", Code.FailedPrecondition));
    const result = await callTool("cancel_run", { run_id: "run_1" });
    expect(interrupts).toEqual([]);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("unexpected error: engine not connected");
  });

  it("cancel_run reports a run it cannot find", async () => {
    failures.set("run.get", new ConnectError("no such run", Code.NotFound));
    const result = await callTool("cancel_run", { run_id: "run_9" });
    expect(interrupts).toEqual([]);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'run "run_9" not found. Verify the org and slug are correct.',
    );
  });
});
