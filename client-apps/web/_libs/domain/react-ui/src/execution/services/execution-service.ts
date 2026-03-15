import { create } from "@bufbuild/protobuf";
import { createClient, type Transport } from "@connectrpc/connect";

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
// Public types
// ---------------------------------------------------------------------------

export interface CreateExecutionInput {
  agentId?: string;
  sessionId?: string;
  message: string;
  org: string;
}

export interface ListExecutionsBySessionOptions {
  pageSize?: number;
  pageToken?: string;
}

export interface ExecutionService {
  createExecution(input: CreateExecutionInput): Promise<AgentExecution>;
  subscribeToExecution(executionId: string, signal?: AbortSignal): AsyncIterable<AgentExecution>;
  submitApproval(executionId: string, toolCallId: string, action: ApprovalAction, comment?: string): Promise<AgentExecution>;
  cancelExecution(executionId: string, reason?: string): Promise<AgentExecution>;
  listExecutionsBySession(sessionId: string, options?: ListExecutionsBySessionOptions): Promise<AgentExecutionList>;
}

// ---------------------------------------------------------------------------
// Factory
//
// protobuf-es codegenv1 descriptors cause generic inference loss with strict TS,
// so Connect-RPC clients type all inputs/outputs as Message<string>. The typed
// wrapper methods below restore the correct domain types at each call site —
// the underlying runtime behavior is identical.
// ---------------------------------------------------------------------------

export function createExecutionService(transport: Transport): ExecutionService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commandClient: any = createClient(AgentExecutionCommandController, transport);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryClient: any = createClient(AgentExecutionQueryController, transport);

  return {
    async createExecution(input: CreateExecutionInput): Promise<AgentExecution> {
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
    },

    subscribeToExecution(executionId: string, signal?: AbortSignal): AsyncIterable<AgentExecution> {
      const request = create(AgentExecutionIdSchema, { value: executionId });
      return queryClient.subscribe(request, { signal }) as AsyncIterable<AgentExecution>;
    },

    async submitApproval(
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
    },

    async cancelExecution(executionId: string, reason?: string): Promise<AgentExecution> {
      const input = create(CancelAgentExecutionInputSchema, {
        id: executionId,
        reason: reason ?? "",
      });
      return commandClient.cancel(input) as Promise<AgentExecution>;
    },

    async listExecutionsBySession(
      sessionId: string,
      options?: ListExecutionsBySessionOptions,
    ): Promise<AgentExecutionList> {
      const request = create(ListAgentExecutionsBySessionRequestSchema, {
        sessionId,
        pageSize: options?.pageSize ?? 50,
        pageToken: options?.pageToken ?? "",
      });
      return queryClient.listBySession(request) as Promise<AgentExecutionList>;
    },
  };
}
