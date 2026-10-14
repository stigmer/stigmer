// How commands name an agent: one rule for `eval run --agent` and `agent
// quality`, so an agent named one way by one names it the same way by the
// other.
//
// An id (`agt_…`, or a retired prefix) is read as it is, from whichever
// organization holds it; `org/slug` is read in that organization; a bare
// slug is read in the active organization. A slug needs an organization,
// so on a server that holds several and with none set, the command says
// how to set one (`setItWith`, its own lines) instead of relaying the
// server's validation error.

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { requireOrganization } from "../../client/single-org.js";
import { idPrefixesFor, parseReference } from "../reference.js";

/** Reads the agent `ref` names (an id, `org/slug` or a slug in `org`); a refused read rejects with the server's error. */
export async function resolveAgent(
  client: Stigmer,
  ref: string,
  org: string,
  setItWith: readonly string[],
): Promise<Agent> {
  const parsed = parseReference(ref, org, idPrefixesFor(ApiResourceKind.agent));
  if (parsed.kind === "id") {
    return client.agent.get(parsed.id);
  }
  await requireOrganization(client, parsed.org, setItWith);
  return client.agent.getByReference({ org: parsed.org, slug: parsed.slug });
}
