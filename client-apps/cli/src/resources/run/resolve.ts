// Reference resolution for the run path (Go's resolveAgent in run_resolve.go).
// A reference is an ID (agt_…), an explicit org/slug, or
// a bare slug resolved against the context org. The strict ID *classification*
// used by smart dispatch lives in resources/reference.ts; this module just turns
// a reference into a fetched resource.

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { defaultRegistry } from "../../registry/index.js";
import { parseReference } from "../reference.js";

/** Resolve an agent by ID, org/slug, or bare slug. Throws if not found. */
export async function resolveAgentRef(client: Stigmer, ref: string, org: string): Promise<Agent> {
  const parsed = parseReference(ref, org, defaultRegistry().getByKind(ApiResourceKind.agent)?.idPrefix ?? "");
  if (parsed.kind === "id") return client.agent.get(parsed.id);
  return client.agent.getByReference({ org: parsed.org, slug: parsed.slug });
}
