"use client";

/**
 * Whether a run of an agent dials any MCP server, its subagents' included:
 * the question a surface whose runs have no person (a channel, a chat
 * link) asks before it warns that no vault is named. An agent with no
 * tools of its own can hand work to a subagent that has them, and a run
 * dials that subagent's servers and plugins too (`runServers.ts`).
 *
 * Nearly every agent is answered from its own spec with no request: one
 * with tools of its own uses tools, and one listing no subagent does not.
 * The rest read each subagent at its pin (`runUsesTools`), so the answer
 * is `null` until that lands; a subagent the viewer cannot read is left
 * out, as the run planning's console twin leaves it out, and the read
 * never fails. A pinned version never changes, so the reading is keyed by
 * the pins alone (never the spec object, which a rerender may rebuild)
 * and cached across mounts under that key: the channel card's answer is
 * there when its dialogs open.
 *
 * Internal: the readiness hooks are the public face.
 *
 * Pinned by `__tests__/useRunUsesTools.test.tsx`.
 */

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import { agentUsesTools, runUsesTools, subagentPins } from "./runServers.js";

/**
 * Whether a run of `agent` uses tools: `true` or `false`, or `null` while
 * the subagents it lists are read.
 */
export function useRunUsesTools(agent: Agent): boolean | null {
  const stigmer = useStigmer();
  const spec = agent.spec;
  const org = agent.metadata?.org ?? "";
  const ownTools = agentUsesTools(spec);
  const pins = ownTools ? "" : subagentPins(spec, org).join(",");
  const needsRead = pins !== "";

  const { data } = useFetch<boolean | null>(
    needsRead && spec !== undefined ? () => runUsesTools(stigmer, spec, org) : null,
    [needsRead, org, pins, stigmer],
    null,
    { cacheKey: needsRead ? `run-uses-tools:${org}:${pins}` : undefined },
  );

  if (ownTools) return true;
  if (!needsRead) return false;
  return data;
}
