import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { transport } from "./transport";

import {
  McpServerQueryController,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import {
  ApiResourceIdSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";

// ---------------------------------------------------------------------------
// Client
//
// Same codegenv1 type-inference workaround used in execution-service.ts.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client: any = createClient(McpServerQueryController, transport);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type { McpServer };

export async function getMcpServer(id: string): Promise<McpServer> {
  const request = create(ApiResourceIdSchema, { value: id });
  return client.get(request) as Promise<McpServer>;
}
