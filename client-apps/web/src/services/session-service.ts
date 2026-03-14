import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { transport } from "./transport";

import {
  SessionQueryController,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import {
  SessionIdSchema,
  ListSessionsRequestSchema,
  ListSessionsByAgentRequestSchema,
  type SessionList,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

// ---------------------------------------------------------------------------
// Client
//
// Same codegenv1 type-inference workaround used in execution-service.ts.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client: any = createClient(SessionQueryController, transport);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { Session, SessionList };

export interface ListSessionsOptions {
  pageSize?: number;
  pageToken?: string;
  tags?: string[];
}

export async function listSessions(
  options?: ListSessionsOptions,
): Promise<SessionList> {
  const request = create(ListSessionsRequestSchema, {
    pageSize: options?.pageSize ?? 20,
    pageToken: options?.pageToken ?? "",
    tags: options?.tags ?? [],
  });
  return client.list(request) as Promise<SessionList>;
}

export async function getSession(id: string): Promise<Session> {
  const request = create(SessionIdSchema, { value: id });
  return client.get(request) as Promise<Session>;
}

export interface ListSessionsByAgentOptions {
  agentId: string;
  pageSize?: number;
  pageToken?: string;
}

export async function listSessionsByAgent(
  options: ListSessionsByAgentOptions,
): Promise<SessionList> {
  const request = create(ListSessionsByAgentRequestSchema, {
    agentId: options.agentId,
    pageSize: options.pageSize ?? 20,
    pageToken: options.pageToken ?? "",
  });
  return client.listByAgent(request) as Promise<SessionList>;
}
