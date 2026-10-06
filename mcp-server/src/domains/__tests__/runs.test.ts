// In-process test for the run-loop tools: run_agent, run_workflow,
// get_agent_run, get_workflow_run, get_workflow_run_events, the two approval
// tools, list_pending_approvals, and cancel_run.
//
// Same harness as reads.test.ts: a real Connect backend serving
// stubbed controllers, the MCP server driven through an in-memory client. The
// stubs capture requests so the tests assert the exact protos the tools send
// (slug→reference resolution and a missing agent's not-found, the turn's
// target, a follow-up refused when it names another agent or organization
// than the session's, runtime-env conversion, approval enum mapping) and
// script run state (running vs terminal, long message histories) to
// exercise the compact projection and the cancel short-circuit. A scripted
// RPC failure per method pins the error copy each tool returns when the
// backend refuses (rpcerr's classification plus the run the tool names).

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
  AgentRunSchema,
  type AgentRun,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/command_pb";
import {
  ApprovalAction,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/query_pb";
import type { SubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  SessionSchema,
  type Session,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import {
  WorkflowRunSchema,
  type WorkflowRun,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { WorkflowRunCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/command_pb";
import { RunPhase as WorkflowRunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import {
  GetEventLogResponseSchema,
  PendingApprovalsListSchema,
  type GetEventLogRequest,
  type ListPendingApprovalsRequest,
  type SubmitWorkflowTaskApprovalInput,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { WorkflowRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/query_pb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const knownAgent = create(AgentSchema, {
  apiVersion: "v1",
  kind: "agent",
  metadata: { name: "Code Reviewer", slug: "code-reviewer", org: "acme", id: "agt_1" },
});

const knownWorkflow = create(WorkflowSchema, {
  apiVersion: "v1",
  kind: "workflow",
  metadata: { name: "Release", slug: "release", org: "acme", id: "wkf_1" },
});

/** An agent run with a scriptable phase and an 8-message history. */
function agentRunFixture(phase: RunPhase): AgentRun {
  return create(AgentRunSchema, {
    apiVersion: "v1",
    kind: "AgentRun",
    metadata: { name: "run", org: "acme", id: "aex_1" },
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

function workflowRunFixture(phase: WorkflowRunPhase): WorkflowRun {
  return create(WorkflowRunSchema, {
    apiVersion: "v1",
    kind: "WorkflowRun",
    metadata: { name: "run", org: "acme", id: "wex_1" },
    spec: { workflowId: "wkf_1" },
    status: { phase },
  });
}

/** A session on code-reviewer, its reference holding the agent's organization id. */
function sessionFixture(agentRef?: { org: string; slug: string }): Session {
  return create(SessionSchema, {
    metadata: { org: "acme", id: "ses_42" },
    spec: agentRef === undefined ? {} : { agentRef: { kind: ApiResourceKind.agent, ...agentRef } },
  });
}

const pendingApprovals = create(PendingApprovalsListSchema, {
  entries: [{ runId: "wex_1", workflowName: "Release", taskName: "sign-off" }],
  totalCount: 1,
});

let backend: Http2Server;
let client: Client;
const openSessions = new Set<ServerHttp2Session>();

// Captured requests / scripted state, reset per test.
let createdAgentRun: AgentRun | undefined;
let createdWorkflowRun: WorkflowRun | undefined;
let agentRunState: AgentRun;
let sessionState: Session;
let workflowRunState: WorkflowRun;
let lastAgentApproval: SubmitApprovalInput | undefined;
let lastWorkflowApproval: SubmitWorkflowTaskApprovalInput | undefined;
let lastPendingApprovalsRequest: ListPendingApprovalsRequest | undefined;
let agentCancelCalls = 0;
let agentLookups = 0;
let workflowCancelCalls = 0;
let lastWorkflowReferenceOrg: string | undefined;
let lastEventLogRequest: GetEventLogRequest | undefined;

/** Backend methods scripted to refuse, keyed "<service>.<method>". */
const failures = new Map<string, ConnectError>();

/** Throw the scripted refusal for `method`, when one is set. */
function refuseIfScripted(method: string): void {
  const failure = failures.get(method);
  if (failure !== undefined) {
    throw failure;
  }
}

const eventLog = create(GetEventLogResponseSchema, {
  events: [{ eventId: "evt_1", taskName: "build", sequenceNumber: 1n }],
  latestSequence: 1n,
});

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
    router.service(AgentRunQueryController, {
      get: () => {
        refuseIfScripted("agentRun.get");
        return agentRunState;
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
    router.service(AgentRunCommandController, {
      create: (req) => {
        refuseIfScripted("agentRun.create");
        createdAgentRun = req;
        return agentRunFixture(RunPhase.RUN_PENDING);
      },
      submitApproval: (req) => {
        refuseIfScripted("agentRun.submitApproval");
        lastAgentApproval = req;
        return agentRunFixture(RunPhase.RUN_IN_PROGRESS);
      },
      cancel: () => {
        agentCancelCalls++;
        refuseIfScripted("agentRun.cancel");
        return agentRunFixture(RunPhase.RUN_CANCELLED);
      },
    });
    router.service(WorkflowQueryController, {
      getByReference: (req) => {
        lastWorkflowReferenceOrg = req.org;
        return knownWorkflow;
      },
    });
    router.service(WorkflowRunQueryController, {
      get: () => {
        refuseIfScripted("workflowRun.get");
        return workflowRunState;
      },
      getEventLog: (req) => {
        refuseIfScripted("workflowRun.getEventLog");
        lastEventLogRequest = req;
        return eventLog;
      },
      listPendingApprovals: (req) => {
        lastPendingApprovalsRequest = req;
        return pendingApprovals;
      },
    });
    router.service(WorkflowRunCommandController, {
      create: (req) => {
        refuseIfScripted("workflowRun.create");
        createdWorkflowRun = req;
        return workflowRunFixture(WorkflowRunPhase.RUN_PENDING);
      },
      submitWorkflowTaskApproval: (req) => {
        refuseIfScripted("workflowRun.submitWorkflowTaskApproval");
        lastWorkflowApproval = req;
        return workflowRunFixture(WorkflowRunPhase.RUN_IN_PROGRESS);
      },
      cancel: () => {
        workflowCancelCalls++;
        refuseIfScripted("workflowRun.cancel");
        return workflowRunFixture(WorkflowRunPhase.RUN_CANCELLED);
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
  createdAgentRun = undefined;
  createdWorkflowRun = undefined;
  agentRunState = agentRunFixture(RunPhase.RUN_IN_PROGRESS);
  sessionState = sessionFixture({ org: "acme", slug: "code-reviewer" });
  workflowRunState = workflowRunFixture(WorkflowRunPhase.RUN_IN_PROGRESS);
  lastAgentApproval = undefined;
  lastWorkflowApproval = undefined;
  lastPendingApprovalsRequest = undefined;
  agentCancelCalls = 0;
  agentLookups = 0;
  workflowCancelCalls = 0;
  lastWorkflowReferenceOrg = undefined;
  lastEventLogRequest = undefined;
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
        "run_workflow",
        "get_agent_run",
        "submit_agent_run_approval",
        "list_pending_approvals",
        "submit_workflow_task_approval",
        "cancel_run",
      ]),
    );
  });

  it("run_agent resolves the slug and starts a new conversation on the agent's reference", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "review this PR",
      runtime_env: { REPO: "stigmer/stigmer" },
    });
    expect(result.isError).toBeFalsy();

    const target = createdAgentRun?.spec?.target;
    expect(target?.case).toBe("sessionSpec");
    // The agent by reference, no version: the session pins the current one.
    expect(target?.case === "sessionSpec" ? target.value.agentRef : undefined).toMatchObject({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "code-reviewer",
      version: "",
    });
    expect(createdAgentRun?.kind).toBe("AgentRun");
    expect(createdAgentRun?.spec?.message).toBe("review this PR");
    expect(createdAgentRun?.metadata?.org).toBe("acme");
    // Runtime env values through MCP are never secrets.
    expect(createdAgentRun?.spec?.runtimeEnv?.REPO?.value).toBe("stigmer/stigmer");
    expect(createdAgentRun?.spec?.runtimeEnv?.REPO?.isSecret).toBe(false);

    // The created run comes back as plain protojson (its status is small).
    const created = parseText(result);
    expect((created.metadata as Record<string, unknown>).id).toBe("aex_1");
  });

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
    expect(createdAgentRun).toBeUndefined();
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
    expect(createdAgentRun?.spec?.target).toEqual({ case: "sessionId", value: "ses_42" });
    expect(agentLookups).toBe(0);
    // The follow-up names no organization: the server files it under the
    // session's, which may differ from the agent's (stigmer/stigmer#1580).
    expect(createdAgentRun?.metadata?.org).toBe("");
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
    expect(createdAgentRun).toBeUndefined();
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
    expect(createdAgentRun).toBeUndefined();
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
    expect(createdAgentRun?.spec?.target).toEqual({ case: "sessionId", value: "ses_42" });
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
    expect(createdAgentRun).toBeUndefined();
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
    expect(createdAgentRun).toBeUndefined();
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
    expect(createdAgentRun).toBeUndefined();
  });

  it("run_agent reports a run the backend refuses to create, naming the agent", async () => {
    failures.set("agentRun.create", new ConnectError("quota exhausted", Code.ResourceExhausted));
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "review this PR",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("unexpected error: quota exhausted");
  });

  it("run_workflow reports a run the backend refuses to create", async () => {
    failures.set("workflowRun.create", new ConnectError("denied", Code.PermissionDenied));
    const result = await callTool("run_workflow", { org: "acme", workflow: "release" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'Permission denied for run of workflow "release" in org "acme". Check your API key permissions.',
    );
  });

  it("run_workflow creates the run with the org env injected", async () => {
    const result = await callTool("run_workflow", { org: "acme", workflow: "release" });
    expect(result.isError).toBeFalsy();

    expect(createdWorkflowRun?.kind).toBe("WorkflowRun");
    expect(createdWorkflowRun?.spec?.workflowId).toBe("wkf_1");
    expect(createdWorkflowRun?.spec?.triggerMessage).toBe("execute");
    // The CLI-parity org injection.
    expect(createdWorkflowRun?.spec?.runtimeEnv?.STIGMER_ORG?.value).toBe("acme");
  });

  it("run_workflow lets a caller-supplied STIGMER_ORG win", async () => {
    await callTool("run_workflow", {
      org: "acme",
      workflow: "release",
      message: "ship it",
      runtime_env: { STIGMER_ORG: "other-org" },
    });
    expect(createdWorkflowRun?.spec?.triggerMessage).toBe("ship it");
    expect(createdWorkflowRun?.spec?.runtimeEnv?.STIGMER_ORG?.value).toBe("other-org");
  });

  it("run_workflow with no org names none and injects no STIGMER_ORG", async () => {
    // A server that holds one organization fills it into the reference;
    // the run's env names no organization rather than an empty one.
    const result = await callTool("run_workflow", { workflow: "release" });
    expect(result.isError).toBeFalsy();
    expect(lastWorkflowReferenceOrg).toBe("");
    expect(createdWorkflowRun?.spec?.workflowId).toBe("wkf_1");
    expect(createdWorkflowRun?.spec?.runtimeEnv?.STIGMER_ORG).toBeUndefined();
  });

  it("get_agent_run defaults to the compact view", async () => {
    const result = await callTool("get_agent_run", { run_id: "aex_1" });
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

  it("get_agent_run honors message_limit", async () => {
    const body = parseText(
      await callTool("get_agent_run", { run_id: "aex_1", message_limit: 2 }),
    );
    const status = ((body.run as Record<string, unknown>).status ?? {}) as Record<
      string,
      unknown
    >;
    expect(status.messages as unknown[]).toHaveLength(2);
  });

  it("get_agent_run refuses an empty run id without calling the backend", async () => {
    failures.set("agentRun.get", new ConnectError("must not be called", Code.Internal));
    const result = await callTool("get_agent_run", { run_id: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("run_id is required");
  });

  it("get_agent_run reports a run it cannot find", async () => {
    failures.set("agentRun.get", new ConnectError("no such run", Code.NotFound));
    const result = await callTool("get_agent_run", { run_id: "aex_9" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'agent run "aex_9" not found. Verify the org and slug are correct.',
    );
  });

  it("get_agent_run view=full returns the backend protojson verbatim", async () => {
    const result = await callTool("get_agent_run", { run_id: "aex_1", view: "full" });
    expect(parseText(result)).toEqual(
      toJson(AgentRunSchema, agentRunState, { useProtoFieldName: true }),
    );
  });

  it("submit_agent_run_approval maps the action and returns the compact view", async () => {
    const result = await callTool("submit_agent_run_approval", {
      run_id: "aex_1",
      tool_call_id: "call_7",
      action: "reject",
      comment: "wrong repository",
    });
    expect(result.isError).toBeFalsy();
    expect(lastAgentApproval?.agentRunId).toBe("aex_1");
    expect(lastAgentApproval?.toolCallId).toBe("call_7");
    expect(lastAgentApproval?.action).toBe(ApprovalAction.REJECT);
    expect(lastAgentApproval?.comment).toBe("wrong repository");
    expect(parseText(result).view).toBe("compact");
  });

  it("submit_agent_run_approval reports an approval the backend refuses", async () => {
    failures.set(
      "agentRun.submitApproval",
      new ConnectError("tool call call_7 is not pending", Code.InvalidArgument),
    );
    const result = await callTool("submit_agent_run_approval", {
      run_id: "aex_1",
      tool_call_id: "call_7",
      action: "approve",
    });
    expect(result.isError).toBe(true);
    // InvalidArgument passes the server's own message through.
    expect(result.content[0]?.text).toBe("tool call call_7 is not pending");
  });

  it("list_pending_approvals forwards the org and returns the inbox", async () => {
    const result = await callTool("list_pending_approvals", { org: "acme" });
    expect(result.isError).toBeFalsy();
    expect(lastPendingApprovalsRequest?.org).toBe("acme");
    expect(parseText(result)).toEqual(
      toJson(PendingApprovalsListSchema, pendingApprovals, { useProtoFieldName: true }),
    );
  });

  it("submit_workflow_task_approval forwards the decision and form data", async () => {
    const result = await callTool("submit_workflow_task_approval", {
      run_id: "wex_1",
      task_name: "sign-off",
      outcome: "approve",
      comment: "lgtm",
      form_data: { severity: "low" },
    });
    expect(result.isError).toBeFalsy();
    expect(lastWorkflowApproval?.runId).toBe("wex_1");
    expect(lastWorkflowApproval?.taskName).toBe("sign-off");
    expect(lastWorkflowApproval?.outcome).toBe("approve");
    expect(lastWorkflowApproval?.comment).toBe("lgtm");
    expect(lastWorkflowApproval?.formData).toMatchObject({ severity: "low" });
    // The reviewer field is server-attributed; interactive clients must not set it.
    expect(lastWorkflowApproval?.reviewer).toBe("");
  });

  it("submit_workflow_task_approval reports a decision the backend refuses, naming the task and run", async () => {
    failures.set(
      "workflowRun.submitWorkflowTaskApproval",
      new ConnectError("no such run", Code.NotFound),
    );
    const result = await callTool("submit_workflow_task_approval", {
      run_id: "wex_9",
      task_name: "sign-off",
      outcome: "approve",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'approval for task "sign-off" in workflow run "wex_9" not found. Verify the org and slug are correct.',
    );
  });

  it("get_workflow_run returns the run as protojson", async () => {
    const result = await callTool("get_workflow_run", { run_id: "wex_1" });
    expect(result.isError).toBeFalsy();
    expect(parseText(result)).toEqual(
      toJson(WorkflowRunSchema, workflowRunState, { useProtoFieldName: true }),
    );
  });

  it("get_workflow_run refuses an empty run id", async () => {
    const result = await callTool("get_workflow_run", { run_id: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("run_id is required");
  });

  it("get_workflow_run reports a run it cannot find", async () => {
    failures.set("workflowRun.get", new ConnectError("no such run", Code.NotFound));
    const result = await callTool("get_workflow_run", { run_id: "wex_9" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'workflow run "wex_9" not found. Verify the org and slug are correct.',
    );
  });

  it("get_workflow_run_events forwards the filter and page size and returns the log", async () => {
    const result = await callTool("get_workflow_run_events", {
      run_id: "wex_1",
      task_name: "build",
      page_size: 50,
    });
    expect(result.isError).toBeFalsy();
    expect(lastEventLogRequest?.runId).toBe("wex_1");
    expect(lastEventLogRequest?.taskName).toBe("build");
    expect(lastEventLogRequest?.pageSize).toBe(50);
    expect(parseText(result)).toEqual(
      toJson(GetEventLogResponseSchema, eventLog, { useProtoFieldName: true }),
    );
  });

  it("get_workflow_run_events leaves the page size to the server when none is given", async () => {
    await callTool("get_workflow_run_events", { run_id: "wex_1" });
    expect(lastEventLogRequest?.taskName).toBe("");
    expect(lastEventLogRequest?.pageSize).toBe(0);
  });

  it("get_workflow_run_events refuses an empty run id", async () => {
    const result = await callTool("get_workflow_run_events", { run_id: "" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("run_id is required");
    expect(lastEventLogRequest).toBeUndefined();
  });

  it("get_workflow_run_events reports a log the backend will not serve", async () => {
    failures.set("workflowRun.getEventLog", new ConnectError("down", Code.Unavailable));
    const result = await callTool("get_workflow_run_events", { run_id: "wex_1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Stigmer server is unavailable. Ensure it is running and reachable.",
    );
  });

  it("cancel_run cancels a running agent run", async () => {
    const body = parseText(await callTool("cancel_run", { run_id: "aex_1" }));
    expect(agentCancelCalls).toBe(1);
    expect(body.already_terminal).toBe(false);
    expect(body.view).toBe("compact");
  });

  it("cancel_run short-circuits a terminal agent run", async () => {
    agentRunState = agentRunFixture(RunPhase.RUN_COMPLETED);
    const body = parseText(await callTool("cancel_run", { run_id: "aex_1" }));
    expect(agentCancelCalls).toBe(0);
    expect(body.already_terminal).toBe(true);
  });

  it("cancel_run routes workflow runs by prefix", async () => {
    const body = parseText(await callTool("cancel_run", { run_id: "wex_1" }));
    expect(workflowCancelCalls).toBe(1);
    expect(body.already_terminal).toBe(false);
  });

  it("cancel_run short-circuits a terminal workflow run", async () => {
    workflowRunState = workflowRunFixture(WorkflowRunPhase.RUN_COMPLETED);
    const body = parseText(await callTool("cancel_run", { run_id: "wex_1" }));
    expect(workflowCancelCalls).toBe(0);
    expect(body.already_terminal).toBe(true);
    expect((body.run as Record<string, unknown>).status).toMatchObject({
      phase: "RUN_COMPLETED",
    });
  });

  it("cancel_run reports an agent run the backend refuses to cancel", async () => {
    failures.set("agentRun.cancel", new ConnectError("run is finalizing", Code.FailedPrecondition));
    const result = await callTool("cancel_run", { run_id: "aex_1" });
    expect(agentCancelCalls).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("unexpected error: run is finalizing");
  });

  it("cancel_run reports a workflow run it cannot find", async () => {
    failures.set("workflowRun.get", new ConnectError("no such run", Code.NotFound));
    const result = await callTool("cancel_run", { run_id: "wex_9" });
    expect(workflowCancelCalls).toBe(0);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'workflow run "wex_9" not found. Verify the org and slug are correct.',
    );
  });

  it("cancel_run reports a workflow run the backend refuses to cancel", async () => {
    failures.set("workflowRun.cancel", new ConnectError("denied", Code.PermissionDenied));
    const result = await callTool("cancel_run", { run_id: "wex_1" });
    expect(workflowCancelCalls).toBe(1);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      'Permission denied for workflow run "wex_1". Check your API key permissions.',
    );
  });

  it("cancel_run rejects an unrecognized ID format", async () => {
    const result = await callTool("cancel_run", { run_id: "ses_123" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unrecognized run ID format");
  });
});
