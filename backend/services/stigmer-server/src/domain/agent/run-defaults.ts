/**
 * The spec of the agent version a conversation or a turn runs, read for its
 * run defaults (AgentSpec.run_config) and their engine (AgentSpec.harness):
 * the pinned version's full spec, or the agent as it is now when the pin
 * names no version (an agent last written before agents were versioned).
 *
 * A server-internal read by point reads on the store, made after the chain's
 * run gate has judged the agent: the defaults travel only into the server's
 * own resolution, never to the caller. A version the agent no longer holds
 * answers the version-history NotFound naming it, as the context build's
 * read does; a store fault is Internal.
 *
 * Proven through __tests__/agent-run-defaults.test.ts and the resolution
 * tests that consume it.
 */
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { internalError, notFoundError } from "../../pipeline/errors.js";
import { getVersionEntry } from "../../pipeline/steps/version-history.js";
import { ResourceNotFoundError, type Store } from "../../store/interface.js";

import { agentVersionBinding } from "./versions.js";

/** The spec of `agentId` at `versionHash` (the head when the hash is empty); undefined for no agent. */
export async function readRunAgentSpec(
  store: Store,
  agentId: string,
  versionHash: string,
): Promise<AgentSpec | undefined> {
  if (agentId === "") {
    return undefined;
  }
  if (versionHash === "") {
    try {
      return (await store.getResource(ApiResourceKind.agent, agentId, AgentSchema)).spec;
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        throw notFoundError("agent", agentId);
      }
      throw internalError(error, "failed to load agent");
    }
  }
  const entry = await getVersionEntry(store, agentVersionBinding, {
    resourceId: agentId,
    versionHash,
  });
  return entry.specSnapshot;
}
