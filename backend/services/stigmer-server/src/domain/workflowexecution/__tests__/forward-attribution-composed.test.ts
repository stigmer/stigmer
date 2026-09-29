/**
 * Pins who a workflow-forwarded HITL decision names (stigmer#1385), over a
 * real boot: a composition verifier and no require-authentication, so the
 * posture stays trusted-local while a presented token is a signed-in
 * person. One boot then holds both identities the forward could carry:
 *
 *   - Erin decides through the workflow with her token. The workflow chain
 *     forwards over the in-process transport as the server acting for her,
 *     so the child agent execution records HER as the approver and the
 *     file reviewer — not the in-process default, which is the
 *     trusted-local operator and is what every forward named before this
 *     fix (the workflow API promises the caller identity propagates).
 *   - A tokenless decision on an agent run directly is the laptop's
 *     operator, recorded as its audit actor is (the trusted-local arm).
 *
 * The child's authorization is not re-run as Erin — the forward stays the
 * server's own act — so the seeded child needs no session she owns. The
 * direct-call arms (every action, APPROVE_ALL's co-pending calls, both
 * file-decision scopes) are pinned in
 * domain/agentexecution/__tests__/agentexecution.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type {
  AgentExecution,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  ApprovalAction,
  ExecutionPhase as AgentExecutionPhase,
  FileDecisionAction,
  FileDecisionScope,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  WorkflowExecutionSchema,
  WorkflowPendingApprovalSchema,
  WorkflowPendingFileReviewSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/command_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import { trustedLocalIdentity } from "../../../pipeline/interceptors/auth.js";
import { fileReviewSeed } from "../../agentexecution/__tests__/file-review-seed.js";

const ERIN = "fake|erin";
const ORG = "forward-attribution-org";

describe("a workflow-forwarded decision names the person who made it (composed server)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let counter = 0;

  const asErin = () =>
    createClient(
      WorkflowExecutionCommandController,
      transportFor(port, fakeJwt(ERIN, "erin@example.com")),
    );

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "wfexec-forward-attribution-"));
    // A verifier and nothing else: no require-authentication and no
    // Authorizer, so the posture is trusted-local and tokenless requests
    // still reach the laptop's operator.
    const unit: ServerExtension = {
      name: "fake-verifier-only",
      identityVerifiers: [fakeVerifier],
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}_${counter}`;
  }

  async function saveChild(
    id: string,
    status: MessageInitShape<typeof AgentExecutionStatusSchema>,
  ): Promise<void> {
    const slug = id.replaceAll("_", "-");
    await server.store.saveResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "AgentExecution",
        metadata: { id, name: slug, slug, org: ORG },
        spec: { message: "Say hello." },
        status,
      }),
    );
  }

  async function saveParent(
    status: MessageInitShape<typeof WorkflowExecutionStatusSchema>,
  ): Promise<string> {
    const id = nextId("wfexec_fwd");
    const slug = id.replaceAll("_", "-");
    await server.store.saveResource(
      ApiResourceKind.workflow_execution,
      id,
      WorkflowExecutionSchema,
      create(WorkflowExecutionSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "WorkflowExecution",
        metadata: { id, name: slug, slug, org: ORG },
        spec: { workflowId: `wf_${id}`, workflowInstanceId: `wfi_${id}` },
        status,
      }),
    );
    return id;
  }

  async function loadChild(id: string): Promise<AgentExecution> {
    return server.store.getResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
    );
  }

  it("an approval forwarded through the workflow records the person on the child", async () => {
    const childId = nextId("aexec_fwd_gated");
    await saveChild(childId, {
      phase: AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [
        {
          toolCalls: [
            {
              id: "tc-fwd",
              name: "Write",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              requiresApproval: true,
            },
          ],
        },
      ],
    });
    const parentId = await saveParent({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      pendingApprovals: [
        create(WorkflowPendingApprovalSchema, {
          approval: { toolCallId: "tc-fwd", toolName: "Write" },
          childAgentExecutionId: childId,
        }),
      ],
    });

    await asErin().submitApproval({
      executionId: parentId,
      toolCallId: "tc-fwd",
      action: ApprovalAction.APPROVE,
    });

    const child = await loadChild(childId);
    const tc = child.status?.messages[0]?.toolCalls[0];
    expect(tc?.approvalAction).toBe(ApprovalAction.APPROVE);
    expect(tc?.approvedBy, "the person, not the in-process default").toBe(ERIN);
    const decided = (child.status?.approvalEventStream?.events ?? []).find(
      (ev) =>
        ev.approvalRequestId === "tc-fwd" && ev.payload.case === "decided",
    );
    expect(
      decided?.payload.case === "decided"
        ? decided.payload.value.decidedBy
        : undefined,
    ).toBe(ERIN);
  });

  it("a file decision forwarded through the workflow records the person as the reviewer", async () => {
    const childId = nextId("aexec_fwd_review");
    const changeSetId = nextId("cs_fwd");
    const { status, aggregate } = fileReviewSeed(childId, changeSetId);
    await saveChild(childId, status);
    const parentId = await saveParent({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      pendingFileReviews: [
        create(WorkflowPendingFileReviewSchema, {
          childAgentExecutionId: childId,
          changeSetId: [changeSetId],
        }),
      ],
    });

    await asErin().submitFileDecision({
      executionId: parentId,
      childAgentExecutionId: childId,
      changeSetId,
      scope: FileDecisionScope.CHANGE_SET,
      action: FileDecisionAction.APPROVE,
      expectedDigest: aggregate,
    });

    const child = await loadChild(childId);
    const decisions =
      child.status?.fileChangeSets.find((cs) => cs.id === changeSetId)
        ?.decisions ?? [];
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reviewerId).toBe(ERIN);
  });

  it("a tokenless decision on the agent run is the laptop's operator", async () => {
    const childId = nextId("aexec_local");
    await saveChild(childId, {
      phase: AgentExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      messages: [
        {
          toolCalls: [
            {
              id: "tc-local",
              name: "Write",
              status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
              requiresApproval: true,
            },
          ],
        },
      ],
    });

    const result = await createClient(
      AgentExecutionCommandController,
      transportFor(port),
    ).submitApproval({
      agentExecutionId: childId,
      toolCallId: "tc-local",
      action: ApprovalAction.APPROVE,
    });

    expect(result.status?.messages[0]?.toolCalls[0]?.approvedBy).toBe(
      trustedLocalIdentity().identityId,
    );
  });
});
