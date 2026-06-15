// Reference resolution for the run path (Go's resolveAgent / resolveWorkflow in
// run_resolve.go). A reference is an ID (agt_…/wfl_…), an explicit org/slug, or
// a bare slug resolved against the context org. The strict ID *classification*
// used by smart dispatch lives in resources/reference.ts; this module just turns
// a reference into a fetched resource.

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { defaultRegistry } from "../../registry/index.js";
import { parseReference } from "../reference.js";

/** Resolve an agent by ID, org/slug, or bare slug. Throws if not found. */
export async function resolveAgentRef(client: Stigmer, ref: string, org: string): Promise<Agent> {
  const parsed = parseReference(ref, org, idPrefix(ApiResourceKind.agent));
  if (parsed.kind === "id") return client.agent.get(parsed.id);
  return client.agent.getByReference({ org: parsed.org, slug: parsed.slug });
}

/** Resolve a workflow by ID, org/slug, or bare slug. Throws if not found. */
export async function resolveWorkflowRef(client: Stigmer, ref: string, org: string): Promise<Workflow> {
  const parsed = parseReference(ref, org, idPrefix(ApiResourceKind.workflow));
  if (parsed.kind === "id") return client.workflow.get(parsed.id);
  return client.workflow.getByReference({ org: parsed.org, slug: parsed.slug });
}

// The id_prefix for a kind, via the shared registry (single source of truth).
function idPrefix(kind: ApiResourceKind): string {
  const alias = kind === ApiResourceKind.agent ? "agent" : "workflow";
  return defaultRegistry().getByAlias(alias)?.idPrefix ?? "";
}
