import { create } from "@bufbuild/protobuf";
import { createClient, type Transport } from "@connectrpc/connect";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import {
  SessionIdSchema,
  ListSessionsRequestSchema,
  ListSessionsByAgentRequestSchema,
  type SessionList,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ListSessionsOptions {
  pageSize?: number;
  pageToken?: string;
  tags?: string[];
}

export interface ListSessionsByAgentOptions {
  agentId: string;
  pageSize?: number;
  pageToken?: string;
}

export interface SessionQueryService {
  get(id: string): Promise<Session>;
  list(options?: ListSessionsOptions): Promise<SessionList>;
  listByAgent(options: ListSessionsByAgentOptions): Promise<SessionList>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSessionQueryService(
  transport: Transport,
): SessionQueryService {
  const client = createClient(SessionQueryController, transport);

  return {
    async get(id) {
      const request = create(SessionIdSchema, { value: id });
      return client.get(request);
    },

    async list(options) {
      const request = create(ListSessionsRequestSchema, {
        pageSize: options?.pageSize ?? 20,
        pageToken: options?.pageToken ?? "",
        tags: options?.tags ?? [],
      });
      return client.list(request);
    },

    async listByAgent(options) {
      const request = create(ListSessionsByAgentRequestSchema, {
        agentId: options.agentId,
        pageSize: options.pageSize ?? 20,
        pageToken: options.pageToken ?? "",
      });
      return client.listByAgent(request);
    },
  };
}
