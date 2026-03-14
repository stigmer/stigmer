import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { transport } from "./transport";

import {
  AgentExecutionCommandController,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import {
  AgentExecutionQueryController,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";
import {
  AgentExecutionIdSchema,
  SubmitApprovalInputSchema,
  CancelAgentExecutionInputSchema,
  ListAgentExecutionsBySessionRequestSchema,
  type AgentExecutionList,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import {
  AgentExecutionSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  ApiResourceMetadataSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

// ---------------------------------------------------------------------------
// Client instances
//
// protobuf-es codegenv1 descriptors cause generic inference loss with strict TS,
// so Connect-RPC clients type all inputs/outputs as Message<string>. We use
// typed wrapper functions below to restore the correct domain types at each
// call site — the underlying runtime behavior is identical.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const commandClient: any = createClient(AgentExecutionCommandController, transport);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const queryClient: any = createClient(AgentExecutionQueryController, transport);

export interface CreateExecutionInput {
  agentId?: string;
  sessionId?: string;
  message: string;
  org: string;
}

export async function createExecution(
  input: CreateExecutionInput,
): Promise<AgentExecution> {
  const execution = create(AgentExecutionSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "AgentExecution",
    metadata: create(ApiResourceMetadataSchema, {
      org: input.org,
    }),
    spec: create(AgentExecutionSpecSchema, {
      agentId: input.agentId ?? "",
      sessionId: input.sessionId ?? "",
      message: input.message,
    }),
  });
  return commandClient.create(execution) as Promise<AgentExecution>;
}

export function subscribeToExecution(
  executionId: string,
  signal?: AbortSignal,
): AsyncIterable<AgentExecution> {
  const request = create(AgentExecutionIdSchema, { value: executionId });
  return queryClient.subscribe(request, { signal }) as AsyncIterable<AgentExecution>;
}

export async function submitApproval(
  executionId: string,
  toolCallId: string,
  action: ApprovalAction,
  comment?: string,
): Promise<AgentExecution> {
  const input = create(SubmitApprovalInputSchema, {
    agentExecutionId: executionId,
    toolCallId,
    action,
    comment: comment ?? "",
  });
  return commandClient.submitApproval(input) as Promise<AgentExecution>;
}

export async function cancelExecution(
  executionId: string,
  reason?: string,
): Promise<AgentExecution> {
  const input = create(CancelAgentExecutionInputSchema, {
    id: executionId,
    reason: reason ?? "",
  });
  return commandClient.cancel(input) as Promise<AgentExecution>;
}

// ---------------------------------------------------------------------------
// Session-scoped queries
// ---------------------------------------------------------------------------

export interface ListExecutionsBySessionOptions {
  pageSize?: number;
  pageToken?: string;
}

export async function listExecutionsBySession(
  sessionId: string,
  options?: ListExecutionsBySessionOptions,
): Promise<AgentExecutionList> {
  const request = create(ListAgentExecutionsBySessionRequestSchema, {
    sessionId,
    pageSize: options?.pageSize ?? 50,
    pageToken: options?.pageToken ?? "",
  });
  return queryClient.listBySession(request) as Promise<AgentExecutionList>;
}
