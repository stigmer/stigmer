// Canonical valid AgentShare fixtures for the conformance suite.
// Domain: conformance support.
//
// An AgentShare is the hosted-chat distribution channel for one agent: the
// /chat/<share id> link, its audience, and an optional rotatable link token
// (server-owned, in status). The canonical share carries the
// agent's own slug — created by omitting BOTH metadata.name and slug, which
// the defaults resolver fills from the referenced agent — so the builder
// makes the name optional on purpose. The builder writes a public audience
// unless told otherwise: an omitted audience means the organization's
// members, and most fixtures exercise the anyone-with-the-link lanes (guest
// mint, vaults, run options), which need public said out loud.
import type { InitShape } from "./init-shape";
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
  // The agent version the share's conversations pin (agent_ref.version): a
  // tag or a content hash; empty is the agent's current version.
  agentRefVersion?: string;
  enabled?: boolean;
  // Omitted here means PUBLIC, written out. Set org for the member-gated
  // audience, or unspecified to leave the field off the wire, which the
  // server stores as org (the proto's default).
  audience?: AgentShareAudience;
  // Vault slugs a guest's runs use (spec.vaults); public audience only.
  vaults?: string[];
}

// A complete, valid AgentShare for the given agent.
export function makeAgentShare(
  org: string,
  agentSlug: string,
  options: AgentShareOptions = {},
): InitShape<typeof AgentShareSchema> {
  return {
    apiVersion: AGENTSHARE_API_VERSION,
    kind: AGENTSHARE_KIND,
    metadata: { org, ...(options.name !== undefined ? { name: options.name } : {}) },
    spec: {
      agentRef: {
        slug: agentSlug,
        kind: ApiResourceKind.agent,
        ...(options.agentRefOrg !== undefined ? { org: options.agentRefOrg } : {}),
        ...(options.agentRefVersion !== undefined ? { version: options.agentRefVersion } : {}),
      },
      enabled: options.enabled ?? true,
      ...(options.audience === AgentShareAudience.unspecified
        ? {}
        : { audience: options.audience ?? AgentShareAudience.public }),
      ...(options.vaults !== undefined
        ? { vaults: options.vaults.map((slug) => ({ slug, kind: ApiResourceKind.vault })) }
        : {}),
    },
  };
}
