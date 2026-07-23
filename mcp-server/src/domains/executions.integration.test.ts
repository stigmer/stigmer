// In-process integration test for the execution-loop tools: run_agent,
// run_workflow, get_agent_execution, the two approval tools,
// list_pending_approvals, and cancel_execution.
//
// Same harness as reads.integration.test.ts: a real Connect backend serving
// stubbed controllers, the MCP server driven through an in-memory client. The
// stubs capture requests so the tests assert the exact protos the tools send
// (slug→ID resolution, runtime-env conversion, approval enum mapping) and
// script execution state (running vs terminal, long message histories) to
// exercise the compact projection and the cancel short-circuit.

import { create, toJson } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
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
  AgentExecutionSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ApprovalAction,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import type { SubmitApprovalInput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import {
  WorkflowExecutionSchema,
  type WorkflowExecution,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ExecutionPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  PendingApprovalsListSchema,
  type ListPendingApprovalsRequest,
  type SubmitWorkflowTaskApprovalInput,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { WorkflowExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/query_pb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureLogger } from "../logger";
import { createServer } from "../server";

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

/** An execution with a scriptable phase and an 8-message history. */
function agentExecutionFixture(phase: ExecutionPhase): AgentExecution {
  return create(AgentExecutionSchema, {
    apiVersion: "v1",
    kind: "AgentExecution",
    metadata: { name: "run", org: "acme", id: "aex_1" },
    spec: { agentId: "agt_1", sessionId: "ses_1", message: "review this" },
    status: {
      phase,
      messages: Array.from({ length: 8 }, (_, i) => ({ content: `msg-${i}` })),
      // Bulk fields the compact view must prune.
      subAgentExecutions: [{ name: "researcher", input: "dig into the logs" }],
    },
  });
}

function workflowExecutionFixture(phase: WorkflowExecutionPhase): WorkflowExecution {
  return create(WorkflowExecutionSchema, {
    apiVersion: "v1",
    kind: "WorkflowExecution",
    metadata: { name: "run", org: "acme", id: "wex_1" },
    spec: { workflowId: "wkf_1" },
    status: { phase },
  });
}

const pendingApprovals = create(PendingApprovalsListSchema, {
  entries: [{ executionId: "wex_1", workflowName: "Release", taskName: "sign-off" }],
  totalCount: 1,
});

let backend: Http2Server;
let client: Client;
const openSessions = new Set<ServerHttp2Session>();

// Captured requests / scripted state, reset per test.
let createdAgentExecution: AgentExecution | undefined;
let createdWorkflowExecution: WorkflowExecution | undefined;
let agentExecutionState: AgentExecution;
let workflowExecutionState: WorkflowExecution;
let lastAgentApproval: SubmitApprovalInput | undefined;
let lastWorkflowApproval: SubmitWorkflowTaskApprovalInput | undefined;
let lastPendingApprovalsRequest: ListPendingApprovalsRequest | undefined;
let agentCancelCalls = 0;
let workflowCancelCalls = 0;

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
    router.service(AgentQueryController, { getByReference: () => knownAgent });
    router.service(AgentExecutionQueryController, {
      get: () => agentExecutionState,
    });
    router.service(AgentExecutionCommandController, {
      create: (req) => {
        createdAgentExecution = req;
        return agentExecutionFixture(ExecutionPhase.EXECUTION_PENDING);
      },
      submitApproval: (req) => {
        lastAgentApproval = req;
        return agentExecutionFixture(ExecutionPhase.EXECUTION_IN_PROGRESS);
      },
      cancel: () => {
        agentCancelCalls++;
        return agentExecutionFixture(ExecutionPhase.EXECUTION_CANCELLED);
      },
    });
    router.service(WorkflowQueryController, { getByReference: () => knownWorkflow });
    router.service(WorkflowExecutionQueryController, {
      get: () => workflowExecutionState,
      listPendingApprovals: (req) => {
        lastPendingApprovalsRequest = req;
        return pendingApprovals;
      },
    });
    router.service(WorkflowExecutionCommandController, {
      create: (req) => {
        createdWorkflowExecution = req;
        return workflowExecutionFixture(WorkflowExecutionPhase.EXECUTION_PENDING);
      },
      submitWorkflowTaskApproval: (req) => {
        lastWorkflowApproval = req;
        return workflowExecutionFixture(WorkflowExecutionPhase.EXECUTION_IN_PROGRESS);
      },
      cancel: () => {
        workflowCancelCalls++;
        return workflowExecutionFixture(WorkflowExecutionPhase.EXECUTION_CANCELLED);
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
  client = new Client({ name: "executions-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

beforeEach(() => {
  createdAgentExecution = undefined;
  createdWorkflowExecution = undefined;
  agentExecutionState = agentExecutionFixture(ExecutionPhase.EXECUTION_IN_PROGRESS);
  workflowExecutionState = workflowExecutionFixture(WorkflowExecutionPhase.EXECUTION_IN_PROGRESS);
  lastAgentApproval = undefined;
  lastWorkflowApproval = undefined;
  lastPendingApprovalsRequest = undefined;
  agentCancelCalls = 0;
  workflowCancelCalls = 0;
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("execution tools integration", () => {
  it("advertises the execution-loop tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "run_agent",
        "run_workflow",
        "get_agent_execution",
        "submit_agent_execution_approval",
        "list_pending_approvals",
        "submit_workflow_task_approval",
        "cancel_execution",
      ]),
    );
  });

  it("run_agent resolves the slug and creates the execution", async () => {
    const result = await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "review this PR",
      runtime_env: { REPO: "stigmer/stigmer" },
    });
    expect(result.isError).toBeFalsy();

    expect(createdAgentExecution?.spec?.agentId).toBe("agt_1");
    expect(createdAgentExecution?.spec?.message).toBe("review this PR");
    expect(createdAgentExecution?.spec?.sessionId).toBe("");
    expect(createdAgentExecution?.metadata?.org).toBe("acme");
    // Runtime env values through MCP are never secrets.
    expect(createdAgentExecution?.spec?.runtimeEnv?.REPO?.value).toBe("stigmer/stigmer");
    expect(createdAgentExecution?.spec?.runtimeEnv?.REPO?.isSecret).toBe(false);

    // The created execution comes back as plain protojson (its status is small).
    const created = parseText(result);
    expect((created.metadata as Record<string, unknown>).id).toBe("aex_1");
  });

  it("run_agent threads a session follow-up", async () => {
    await callTool("run_agent", {
      org: "acme",
      agent: "code-reviewer",
      message: "and the tests?",
      session_id: "ses_42",
    });
    expect(createdAgentExecution?.spec?.sessionId).toBe("ses_42");
  });

  it("run_workflow creates the execution with the org env injected", async () => {
    const result = await callTool("run_workflow", { org: "acme", workflow: "release" });
    expect(result.isError).toBeFalsy();

    expect(createdWorkflowExecution?.spec?.workflowId).toBe("wkf_1");
    expect(createdWorkflowExecution?.spec?.triggerMessage).toBe("execute");
    // The CLI-parity org injection.
    expect(createdWorkflowExecution?.spec?.runtimeEnv?.STIGMER_ORG_ID?.value).toBe("acme");
  });

  it("run_workflow lets a caller-supplied STIGMER_ORG_ID win", async () => {
    await callTool("run_workflow", {
      org: "acme",
      workflow: "release",
      message: "ship it",
      runtime_env: { STIGMER_ORG_ID: "other-org" },
    });
    expect(createdWorkflowExecution?.spec?.triggerMessage).toBe("ship it");
    expect(createdWorkflowExecution?.spec?.runtimeEnv?.STIGMER_ORG_ID?.value).toBe("other-org");
  });

  it("get_agent_execution defaults to the compact view", async () => {
    const result = await callTool("get_agent_execution", { execution_id: "aex_1" });
    expect(result.isError).toBeFalsy();

    const body = parseText(result);
    expect(body.view).toBe("compact");
    expect(body.total_messages).toBe(8);

    const execution = body.execution as Record<string, unknown>;
    const status = (execution.status ?? {}) as Record<string, unknown>;
    const messages = status.messages as Array<Record<string, unknown>>;
    // Default tail of 5, ending with the newest message.
    expect(messages).toHaveLength(5);
    expect(messages[4]?.content).toBe("msg-7");
    // Bulk bookkeeping fields are pruned.
    expect(status.sub_agent_executions).toBeUndefined();
  });

  it("get_agent_execution honors message_limit", async () => {
    const body = parseText(
      await callTool("get_agent_execution", { execution_id: "aex_1", message_limit: 2 }),
    );
    const status = ((body.execution as Record<string, unknown>).status ?? {}) as Record<
      string,
      unknown
    >;
    expect(status.messages as unknown[]).toHaveLength(2);
  });

  it("get_agent_execution view=full returns the backend protojson verbatim", async () => {
    const result = await callTool("get_agent_execution", { execution_id: "aex_1", view: "full" });
    expect(parseText(result)).toEqual(
      toJson(AgentExecutionSchema, agentExecutionState, { useProtoFieldName: true }),
    );
  });

  it("submit_agent_execution_approval maps the action and returns the compact view", async () => {
    const result = await callTool("submit_agent_execution_approval", {
      execution_id: "aex_1",
      tool_call_id: "call_7",
      action: "reject",
      comment: "wrong repository",
    });
    expect(result.isError).toBeFalsy();
    expect(lastAgentApproval?.agentExecutionId).toBe("aex_1");
    expect(lastAgentApproval?.toolCallId).toBe("call_7");
    expect(lastAgentApproval?.action).toBe(ApprovalAction.REJECT);
    expect(lastAgentApproval?.comment).toBe("wrong repository");
    expect(parseText(result).view).toBe("compact");
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
      execution_id: "wex_1",
      task_name: "sign-off",
      outcome: "approve",
      comment: "lgtm",
      form_data: { severity: "low" },
    });
    expect(result.isError).toBeFalsy();
    expect(lastWorkflowApproval?.executionId).toBe("wex_1");
    expect(lastWorkflowApproval?.taskName).toBe("sign-off");
    expect(lastWorkflowApproval?.outcome).toBe("approve");
    expect(lastWorkflowApproval?.comment).toBe("lgtm");
    expect(lastWorkflowApproval?.formData).toMatchObject({ severity: "low" });
    // The reviewer field is server-attributed; interactive clients must not set it.
    expect(lastWorkflowApproval?.reviewer).toBe("");
  });

  it("cancel_execution cancels a running agent execution", async () => {
    const body = parseText(await callTool("cancel_execution", { execution_id: "aex_1" }));
    expect(agentCancelCalls).toBe(1);
    expect(body.already_terminal).toBe(false);
    expect(body.view).toBe("compact");
  });

  it("cancel_execution short-circuits a terminal agent execution", async () => {
    agentExecutionState = agentExecutionFixture(ExecutionPhase.EXECUTION_COMPLETED);
    const body = parseText(await callTool("cancel_execution", { execution_id: "aex_1" }));
    expect(agentCancelCalls).toBe(0);
    expect(body.already_terminal).toBe(true);
  });

  it("cancel_execution routes workflow executions by prefix", async () => {
    const body = parseText(await callTool("cancel_execution", { execution_id: "wex_1" }));
    expect(workflowCancelCalls).toBe(1);
    expect(body.already_terminal).toBe(false);
  });

  it("cancel_execution rejects an unrecognized ID format", async () => {
    const result = await callTool("cancel_execution", { execution_id: "ses_123" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("unrecognized execution ID format");
  });
});
