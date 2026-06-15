// Binds each registry kind to its proto schema and the SDK call that fetches a
// single resource (by ID or by org/slug reference). This is the seam between the
// proto-kind registry and the high-level SDK sub-clients for the `get` verb;
// the schema travels with the message so rendering stays kind-agnostic.

import type { DescMessage, Message } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import type { ParsedReference } from "./reference.js";

export interface ResourceResult {
  readonly schema: DescMessage;
  readonly message: Message;
}

type Getter = (client: Stigmer, ref: ParsedReference) => Promise<ResourceResult>;

const GET_BINDINGS: ReadonlyMap<ApiResourceKind, Getter> = new Map([
  [ApiResourceKind.agent, refGetter(ApiResourceKind.agent, AgentSchema, (c) => c.agent)],
  [ApiResourceKind.workflow, refGetter(ApiResourceKind.workflow, WorkflowSchema, (c) => c.workflow)],
  [ApiResourceKind.mcp_server, refGetter(ApiResourceKind.mcp_server, McpServerSchema, (c) => c.mcpServer)],
  [ApiResourceKind.project, refGetter(ApiResourceKind.project, ProjectSchema, (c) => c.project)],
  [ApiResourceKind.skill, refGetter(ApiResourceKind.skill, SkillSchema, (c) => c.skill)],
  [ApiResourceKind.api_key, idOnlyGetter(ApiKeySchema, (c) => c.apiKey, "API keys")],
]);

export function getterFor(kind: ApiResourceKind): Getter | undefined {
  return GET_BINDINGS.get(kind);
}

// A resource fetchable by ID or by org/slug reference.
interface RefClient {
  get(id: string): Promise<Message>;
  getByReference(ref: { org: string; slug: string; kind: number }): Promise<Message>;
}

function refGetter(kind: ApiResourceKind, schema: DescMessage, pick: (c: Stigmer) => RefClient): Getter {
  return async (client, ref) => {
    const sub = pick(client);
    const message =
      ref.kind === "id" ? await sub.get(ref.id) : await sub.getByReference({ org: ref.org, slug: ref.slug, kind });
    return { schema, message };
  };
}

// A resource fetchable only by ID (e.g. API keys are not slug-addressable).
function idOnlyGetter(schema: DescMessage, pick: (c: Stigmer) => { get(id: string): Promise<Message> }, label: string): Getter {
  return async (client, ref) => {
    if (ref.kind !== "id") {
      throw new UsageError(`${label} can only be fetched by ID`);
    }
    return { schema, message: await pick(client).get(ref.id) };
  };
}
