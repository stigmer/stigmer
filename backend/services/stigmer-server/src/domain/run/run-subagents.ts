/**
 * The subagents a run's agent lists, each at the version the agent pinned
 * when it was saved (AgentSpec.subagents, domain/agent/subagents.ts). One
 * reader for every planner that needs them: the run's values (each
 * subagent's own keys and MCP servers, and its plugins' servers and
 * hooks), the run's
 * plugins, and the refusal of a local program on a hosted conversation.
 *
 * A pinned version that no longer resolves (the agent deleted, or its
 * version gone) refuses the create naming it, as a pinned agent that is
 * gone does: the turn would fail on it. Recovery re-plans from the stamped
 * parent version, whose pins name the same subagents, so no run field
 * records them.
 *
 * Tests: __tests__/run-subagents.test.ts.
 */
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { Code, ConnectError } from "@connectrpc/connect";

import { failedPreconditionError, internalError } from "../../pipeline/errors.js";
import { loadReferenced } from "../../pipeline/steps/references.js";
import { loadVersion } from "../../pipeline/steps/version-history.js";
import type { Store } from "../../store/interface.js";
import { agentVersionBinding } from "../agent/versions.js";

/** One subagent of a run, at its pinned version. */
export interface RunSubagent {
  /** The listed agent's id. */
  readonly id: string;
  /** Its name in the turn: the listed agent's current slug. */
  readonly name: string;
  /** The version the parent pinned (a version hash), which its own MCP servers are read at. */
  readonly versionHash: string;
  /** The organization it belongs to. */
  readonly org: string;
  /** Its spec at the pinned version. */
  readonly spec: AgentSpec;
}

/** The refusal for a subagent whose pinned version no longer resolves. */
export function subagentGoneMessage(slug: string, version: string): string {
  return `this conversation's agent lists subagent '${slug}' at version ${version.slice(0, 12)}, which no longer exists; save the agent again to list a version it has, or remove '${slug}' from its subagents`;
}

/**
 * The refusal for two listed subagents that answer to one name now. A turn
 * names each subagent by its current slug, and its declared values and its
 * hand-offs are keyed by that name, so two of one name would share both.
 * The agent's save refuses such a list (ValidateSubagentNames); a rename
 * since, in another organization, can still bring two together.
 */
export function subagentNamesClashMessage(name: string): string {
  return `this conversation's agent lists two subagents now named '${name}', and a turn names each subagent by its slug; rename one of them, or save the agent with one of them removed`;
}

/**
 * Each subagent the agent spec lists, at its pinned version; none for no
 * agent. Two that answer to one name now are refused
 * (subagentNamesClashMessage).
 */
export async function runSubagents(
  store: Store,
  agentSpec: AgentSpec | undefined,
  executionOrg: string,
): Promise<RunSubagent[]> {
  const subagents: RunSubagent[] = [];
  for (const ref of agentSpec?.subagents ?? []) {
    if (ref.id === "" && ref.slug === "") {
      continue;
    }
    const org = ref.org || executionOrg;
    let head;
    try {
      head = await loadReferenced(store, ApiResourceKind.agent, AgentSchema, { org, id: ref.id });
    } catch (error) {
      throw internalError(error, "failed to read a subagent");
    }
    if (head === undefined) {
      // A listed agent since deleted: its id names nothing, and an agent
      // remade under its name is another agent, never this one.
      throw failedPreconditionError(
        subagentGoneMessage(ref.slug !== "" ? ref.slug : ref.id, ref.version),
      );
    }
    const id = head.metadata?.id ?? "";
    const name = head.metadata?.slug ?? "";
    let spec: AgentSpec | undefined;
    try {
      spec = (await loadVersion(store, agentVersionBinding, id, ref.version)).resource.spec;
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        throw failedPreconditionError(subagentGoneMessage(name, ref.version));
      }
      throw error;
    }
    if (spec !== undefined) {
      if (subagents.some((held) => held.name === name)) {
        throw failedPreconditionError(subagentNamesClashMessage(name));
      }
      subagents.push({ id, name, org, versionHash: ref.version, spec });
    }
  }
  return subagents;
}
