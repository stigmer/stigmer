/**
 * The spec of the agent version a conversation or a turn runs, read for its
 * run defaults (AgentSpec.run_config) and their engine (AgentSpec.harness):
 * the pinned version's full spec. A pin always names a version: every
 * agent write records its head's hash (pipeline/steps/version-archive.ts).
 *
 * A server-internal read by point reads on the store, made after the chain's
 * run gate has judged the agent. The defaults reach the turn's
 * status.run_config, which anyone who may read the turn sees, a hosted
 * share's guest included, who may not read the agent itself. That is
 * deliberate: a model name, a tier, thinking and the caps are the settings
 * the reader's own turn ran with, and say nothing of the agent's
 * instructions, tools or keys. A version the agent no longer holds
 * answers the version-history NotFound naming it, as the context build's
 * read does; a store fault is Internal.
 *
 * Proven through __tests__/agent-run-defaults.test.ts and the resolution
 * tests that consume it.
 */
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";

import { getVersionEntry } from "../../pipeline/steps/version-history.js";
import type { Store } from "../../store/interface.js";

import { agentVersionBinding } from "./versions.js";

/** The spec of `agentId` at `versionHash`; undefined for no agent. */
export async function readRunAgentSpec(
  store: Store,
  agentId: string,
  versionHash: string,
): Promise<AgentSpec | undefined> {
  if (agentId === "") {
    return undefined;
  }
  const entry = await getVersionEntry(store, agentVersionBinding, {
    resourceId: agentId,
    versionHash,
  });
  return entry.specSnapshot;
}
