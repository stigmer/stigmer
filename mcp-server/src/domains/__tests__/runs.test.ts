// In-process test for the run-loop tools: run_agent, get_run,
// submit_run_approval, and cancel_run.
//
// Same harness as reads.test.ts: a real Connect backend serving
// stubbed controllers, the MCP server driven through an in-memory client. The
// stubs capture requests so the tests assert the exact protos the tools send
// (slug→reference resolution and a missing agent's not-found, the turn's
// target, a follow-up refused when it names another agent or organization
// than the session's, the vaults a new conversation names and an empty vault
// entry refused before anything starts, approval enum mapping) and
// script run state (running vs terminal, long message histories) to
// exercise the compact projection and the cancel short-circuit. A scripted
// RPC failure per method pins the error copy each tool returns when the
// backend refuses (rpcerr's classification plus the run the tool names).
// The former `secrets` and `runtime_env` arguments are pinned as refused,
// naming vaults, so a caller still sending one never starts a run without
// the keys it meant to pass.

import { create, toJson } from "@bufbuild/protobuf";
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
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import {
  RunSchema,
  type Run,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunCommandController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/command_pb";
import {
  ApprovalAction,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import type { SubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  SessionSchema,
  type Session,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const knownAgent = create(AgentSchema, {
  apiVersion: "v1",
  kind: "agent",
  metadata: { name: "Code Reviewer", slug: "code-reviewer", org: "acme", id: "agt_1" },
});

/** A run with a scriptable phase and an 8-message history. */
function runFixture(phase: RunPhase): Run {
  return create(RunSchema, {
    apiVersion: "v1",
    kind: "Run",
    metadata: { name: "run", org: "acme", id: "run_1" },
    spec: { target: { case: "sessionId", value: "ses_1" }, message: "review this" },
    status: {
      agentId: "agt_1",
      phase,
      messages: Array.from({ length: 8 }, (_, i) => ({ content: `msg-${i}` })),
      // Bulk fields the compact view must prune.
      subAgentRuns: [{ name: "researcher", input: "dig into the logs" }],
    },
  });
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
let lastAgentApproval: SubmitApprovalInput | undefined;
let agentCancelCalls = 0;
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
    });
    router.service(RunCommandController, {
      create: (req) => {
        refuseIfScripted("run.create");
        createdRun = req;
        return runFixture(RunPhase.RUN_PENDING);
      },
      submitApproval: (req) => {
        refuseIfScripted("run.submitApproval");
        lastAgentApproval = req;
        return runFixture(RunPhase.RUN_IN_PROGRESS);
      },
      cancel: () => {
        agentCancelCalls++;
        refuseIfScripted("run.cancel");
        return runFixture(RunPhase.RUN_CANCELLED);
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
  lastAgentApproval = undefined;
  agentCancelCalls = 0;
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

  it.each(["secrets", "runtime_env"])(
    "run_agent refuses the former %s argument, naming vaults, and starts nothing",
    async (argument) => {
      const result = await callTool("run_agent", {
        org: "acme",
        agent: "code-reviewer",
        message: "review this PR",
        [argument]: { REPO: "stigmer/stigmer" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(`no longer takes ${argument}`);
      expect(result.content[0]?.text).toContain("`stigmer vault set-secret <NAME> --mine`");
      expect(result.content[0]?.text).toContain("`vaults`");
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

  it("run_agent refuses vaults on a follow-up and starts nothing", async () => {
    createdRun = undefined;
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "again",
      session_id: "ses_42",
      vaults: ["support-tools"],
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

  it("get_run defaults to the compact view", async () => {
    const result = await callTool("get_run", { run_id: "run_1" });
    expect(result.isError).toBeFalsy();

    const body = parseText(result);
    expect(body.view).toBe("compact");
    expect(body.total_messages).toBe(8);

    const run = body.run as Record<string, unknown>;
    const status = (run.status ?? {}) as Record<string, unknown>;
    const messages = status.messages as Array<Record<string, unknown>>;
    // Default tail of 5, ending with the newest message.
    expect(messages).toHaveLength(5);
    expect(messages[4]?.content).toBe("msg-7");
    // Bulk bookkeeping fields are pruned.
    expect(status.sub_agent_runs).toBeUndefined();
  });

  it("get_run honors message_limit", async () => {
    const body = parseText(
      await callTool("get_run", { run_id: "run_1", message_limit: 2 }),
    );
    const status = ((body.run as Record<string, unknown>).status ?? {}) as Record<
      string,
      unknown
    >;
    expect(status.messages as unknown[]).toHaveLength(2);
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

  it("get_run view=full returns the backend protojson verbatim", async () => {
    const result = await callTool("get_run", { run_id: "run_1", view: "full" });
    expect(parseText(result)).toEqual(
      toJson(RunSchema, runState, { useProtoFieldName: true }),
    );
  });

  it("submit_run_approval maps the action and returns the compact view", async () => {
    const result = await callTool("submit_run_approval", {
      run_id: "run_1",
      tool_call_id: "call_7",
      action: "reject",
      comment: "wrong repository",
    });
    expect(result.isError).toBeFalsy();
    expect(lastAgentApproval?.runId).toBe("run_1");
    expect(lastAgentApproval?.toolCallId).toBe("call_7");
    expect(lastAgentApproval?.action).toBe(ApprovalAction.REJECT);
    expect(lastAgentApproval?.comment).toBe("wrong repository");
    expect(parseText(result).view).toBe("compact");
  });

  it("submit_run_approval reports an approval the backend refuses", async () => {
    failures.set(
      "run.submitApproval",
      new ConnectError("tool call call_7 is not pending", Code.InvalidArgument),
    );
    const result = await callTool("submit_run_approval", {
      run_id: "run_1",
      tool_call_id: "call_7",
      action: "approve",
    });
    expect(result.isError).toBe(true);
    // InvalidArgument passes the server's own message through.
    expect(result.content[0]?.text).toBe("tool call call_7 is not pending");
  });

  it("cancel_run cancels a running run", async () => {
    const body = parseText(await callTool("cancel_run", { run_id: "run_1" }));
    expect(agentCancelCalls).toBe(1);
    expect(body.already_terminal).toBe(false);
    expect(body.view).toBe("compact");
  });

  it("cancel_run short-circuits a terminal run", async () => {
    runState = runFixture(RunPhase.RUN_COMPLETED);
    const body = parseText(await callTool("cancel_run", { run_id: "run_1" }));
    expect(agentCancelCalls).toBe(0);
    expect(body.already_terminal).toBe(true);
  });

  it("cancel_run reports a run the backend refuses to cancel", async () => {
    failures.set("run.cancel", new ConnectError("run is finalizing", Code.FailedPrecondition));
    const result = await callTool("cancel_run", { run_id: "run_1" });
    expect(agentCancelCalls).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("unexpected error: run is finalizing");
  });

  it("cancel_run reports a run it cannot find", async () => {
    failures.set("run.get", new ConnectError("no such run", Code.NotFound));
    const result = await callTool("cancel_run", { run_id: "run_9" });
    expect(agentCancelCalls).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'run "run_9" not found. Verify the org and slug are correct.',
    );
  });
});
