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
 * A channel can run one saved version of its agent, named on its agent
 * reference by a tag or a content hash, rather than the agent's current
 * one, and its runs dial that version's tools. So the version is part of
 * the question. None, or `"latest"` (after a trim, as the server reads
 * it), is the head the caller holds, judged as above. Any other version is
 * read with `agent.getByReference` by the agent's id, which runs the
 * server's one version rule (the head when the version names the head's
 * own hash or live tag, else the archived version, else not found); no
 * copy of that rule lives here. Then the version's own tools are judged,
 * then its subagents at their pins. Only the version's spec is read: an
 * archived version carries its own old name. The answer is `null` until
 * the read lands, and stays `null` when the version cannot be read (a
 * deleted tag, no access, a failed request): the server refuses that
 * channel's conversations for another reason, so a vault warning would
 * point at the wrong problem. A tag moves, and a channel resolves it again
 * for each new conversation, so the reading is cached under the version
 * and read again on every mount: a cached answer shows only until the
 * fresh one lands.
 *
 * Internal: the readiness hooks are the public face.
 *
 * Pinned by `__tests__/useRunUsesTools.test.tsx`.
 */

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Stigmer, ResourceRef } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import { agentUsesTools, runUsesTools, subagentPins } from "./runServers.js";

/**
 * Whether a run of `agent` at `version` uses tools: `true` or `false`, or
 * `null` while the subagents it lists, or the version, are read, and when
 * the version cannot be read. `version` is the one a channel's agent
 * reference names; none or `"latest"` is `agent` itself.
 */
export function useRunUsesTools(agent: Agent, version = ""): boolean | null {
  const stigmer = useStigmer();
  const spec = agent.spec;
  const org = agent.metadata?.org ?? "";
  const pinned = pinnedVersion(version);
  const ownTools = pinned === null && agentUsesTools(spec);
  const pins = pinned !== null || ownTools ? "" : subagentPins(spec, org).join(",");

  let readKey: string | undefined;
  let read: (() => Promise<boolean | null>) | null = null;
  if (pinned !== null) {
    const ref: ResourceRef = {
      org,
      slug: agent.metadata?.slug ?? "",
      ...(agent.metadata?.id ? { id: agent.metadata.id } : {}),
      version: pinned,
    };
    readKey = `run-uses-tools:${org}:${ref.id ?? ref.slug}@${pinned}`;
    read = () => versionUsesTools(stigmer, ref);
  } else if (pins !== "" && spec !== undefined) {
    readKey = `run-uses-tools:${org}:${pins}`;
    read = () => runUsesTools(stigmer, spec, org);
  }

  const { data } = useFetch<boolean | null>(read, [readKey, stigmer], null, { cacheKey: readKey });

  if (ownTools) return true;
  if (read === null) return false;
  return data;
}

/** The version to read, or `null` when `version` is the head: none or `"latest"`, after a trim. */
function pinnedVersion(version: string): string | null {
  const trimmed = version.trim();
  return trimmed === "" || trimmed === "latest" ? null : trimmed;
}

/** Whether a run of the agent at `ref`'s version uses tools, or `null` when that version cannot be read. */
async function versionUsesTools(stigmer: Pick<Stigmer, "agent">, ref: ResourceRef): Promise<boolean | null> {
  let atVersion: Agent;
  try {
    atVersion = await stigmer.agent.getByReference(ref);
  } catch {
    // Unreadable: not known, as the module header says.
    return null;
  }
  if (agentUsesTools(atVersion.spec)) return true;
  if (atVersion.spec === undefined) return false;
  return runUsesTools(stigmer, atVersion.spec, ref.org);
}
