// Canonical valid AgentShare fixtures for the conformance suite.
// Domain: conformance support.
//
// An AgentShare is the hosted-chat distribution channel for one agent: the
// /chat/<org>/<slug> URL identity, its audience, and an optional rotatable
// link token (server-owned, in status). The canonical share carries the
// agent's own slug — created by omitting BOTH metadata.name and slug, which
// the defaults resolver fills from the referenced agent — so the builder
// makes the name optional on purpose.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export const AGENTSHARE_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENTSHARE_KIND = "AgentShare";

export interface AgentShareOptions {
  // Omit for the canonical share (slug + name default from the agent);
  // set for a deliberately distinct link.
  name?: string;
  // Explicit agent_ref org, for cross-org shares; empty means same-org.
  agentRefOrg?: string;
  enabled?: boolean;
  // Unspecified deliberately means PUBLIC (the proto's documented default) —
  // set org for the member-gated audience.
  audience?: AgentShareAudience;
}

// A complete, valid AgentShare for the given agent.
export function makeAgentShare(
  org: string,
  agentSlug: string,
  options: AgentShareOptions = {},
): MessageInitShape<typeof AgentShareSchema> {
  return {
    apiVersion: AGENTSHARE_API_VERSION,
    kind: AGENTSHARE_KIND,
    metadata: { org, ...(options.name !== undefined ? { name: options.name } : {}) },
    spec: {
      agentRef: {
        slug: agentSlug,
        kind: ApiResourceKind.agent,
        ...(options.agentRefOrg !== undefined ? { org: options.agentRefOrg } : {}),
      },
      enabled: options.enabled ?? true,
      ...(options.audience !== undefined ? { audience: options.audience } : {}),
    },
  };
}
