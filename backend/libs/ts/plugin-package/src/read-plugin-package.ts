/**
 * The one entry: a `PluginFiles` in, a `PluginReadOutcome` out.
 *
 * The read is a fixed sequence, each stage a pure function over the index
 * and the stages before it: containment of the listed paths; manifest
 * detection and identity; skills; MCP servers; hooks; variables (which
 * need the servers' and the hooks' references); sub-agents (which need the
 * skills' names); the main agent a Claude plugin's settings name (which
 * needs the sub-agents); the `ai.stigmer/` overlay (which needs the
 * servers' names); the ignored components. Every stage records findings and keeps going, so the outcome
 * names every problem in the package at once, and the plugin is returned
 * only when no stage refused.
 *
 * Nothing here throws on a plugin's content. A throw means a reader broke
 * its contract (a listed path that cannot be read) or the library has a bug.
 */

import { detectManifests } from "./detect.js";
import { isContainedPath, PluginFileIndex, type PluginFiles } from "./files.js";
import { Findings } from "./messages.js";
import { normaliseHooks } from "./normalise/hooks.js";
import { dedupeIgnored, ignoredOnDisk } from "./normalise/ignored.js";
import { normaliseMcpServers } from "./normalise/mcp-servers.js";
import { normaliseOverlay } from "./normalise/overlay.js";
import { normaliseMainAgent, readsSettings } from "./normalise/settings.js";
import { normaliseSkills } from "./normalise/skills.js";
import { normaliseSubAgents } from "./normalise/sub-agents.js";
import { normaliseVariables } from "./normalise/variables.js";
import type { PluginReadOutcome } from "./outcome.js";
import type { PluginPackage } from "./types.js";

export function readPluginPackage(files: PluginFiles): PluginReadOutcome {
  const findings = new Findings();

  for (const entry of files.entries) {
    if (!isContainedPath(entry.path)) findings.error("path-uncontained", { path: entry.path });
  }
  const index = new PluginFileIndex(files);

  const set = detectManifests(index, findings);
  if (set === undefined) {
    return { ok: false, errors: findings.errors, warnings: findings.warnings };
  }

  const skills = normaliseSkills(index, set, findings);
  const servers = normaliseMcpServers(index, set.mcpSources, findings);
  const mcpServers = servers.servers;
  const hooks = normaliseHooks(index, set, findings);
  const variables = normaliseVariables(set, servers, hooks.references, findings);
  const subAgents = normaliseSubAgents(index, set, skills, findings);
  const mainAgent = normaliseMainAgent(index, set, subAgents, findings);
  const overlay = normaliseOverlay(index, servers.declaredNames, findings);
  const ignored = dedupeIgnored([ignoredOnDisk(index, set.readsAgents, readsSettings(set)), ...set.manifests.map((m) => m.ignored)]);

  if (findings.errors.length > 0 || set.name === undefined) {
    return { ok: false, errors: findings.errors, warnings: findings.warnings };
  }

  const identity = set.manifests[0]?.identity ?? {};
  const plugin: PluginPackage = {
    name: set.name,
    ...(identity.version !== undefined && { version: identity.version }),
    ...(identity.description !== undefined && { description: identity.description }),
    ...(identity.author !== undefined && { author: identity.author }),
    ...(identity.homepage !== undefined && { homepage: identity.homepage }),
    ...(identity.repository !== undefined && { repository: identity.repository }),
    ...(identity.license !== undefined && { license: identity.license }),
    keywords: identity.keywords ?? [],
    dialect: set.dialect,
    manifestsFound: set.manifests.map((m) => m.path),
    skills,
    mcpServers,
    subAgents,
    variables,
    overlay,
    ...(hooks.hooks !== undefined && { hooks: hooks.hooks }),
    ...(mainAgent !== undefined && { mainAgent }),
    ignored,
  };
  return { ok: true, plugin, warnings: findings.warnings };
}
