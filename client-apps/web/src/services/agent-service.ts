import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { transport } from "./transport";

import {
  AgentQueryController,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import {
  AgentIdSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  ApiResourceReferenceSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import {
  ApiResourceKind,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

// ---------------------------------------------------------------------------
// Client
//
// Same codegenv1 type-inference workaround used in execution-service.ts.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client: any = createClient(AgentQueryController, transport);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { Agent };

export async function getAgent(id: string): Promise<Agent> {
  const request = create(AgentIdSchema, { value: id });
  return client.get(request) as Promise<Agent>;
}

export async function getAgentByReference(
  org: string,
  slug: string,
): Promise<Agent> {
  const ref = create(ApiResourceReferenceSchema, {
    org,
    kind: ApiResourceKind.agent,
    slug,
  });
  return client.getByReference(ref) as Promise<Agent>;
}
