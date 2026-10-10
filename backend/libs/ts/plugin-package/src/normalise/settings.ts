/**
 * A Claude plugin's settings: which of its agents runs the session's main
 * thread.
 *
 * Claude Code reads a plugin's `settings.json` at the plugin root and the
 * same object inline under the manifest's `settings`, the file winning for
 * a key it sets. Two keys take effect there and every other is dropped:
 * `agent`, which runs the main thread as one of the plugin's agents (its
 * prompt, tool lists and model apply to the whole session), and
 * `subagentStatusLine`, a terminal display Stigmer has no counterpart for.
 * So `agent` is read and every other key is named as not applied
 * (`settings-key-ignored`).
 *
 * `agent` must name one of the plugin's own agents, by its bare name or
 * scoped as `<plugin>:<agent>`; anything else is warned and ignored
 * (`settings-agent-unknown`), since a main agent that is not there names
 * nothing a conversation could run. Only a Claude
 * manifest makes these settings meaningful; without one, `settings.json`
 * stays an ignored component. A `settings.json` that is not a JSON object
 * refuses the plugin, as a broken hooks file does.
 */

import { describeValue, fields, isJsonObject, type JsonObject, parseJsonObject, readText } from "../documents.js";
import type { ManifestSet } from "../detect.js";
import type { PluginFileIndex } from "../files.js";
import type { Findings } from "../messages.js";
import type { PluginSubAgent } from "../types.js";

/** The plugin settings file Claude Code reads. */
export const SETTINGS_FILE = "settings.json";

/** True when the package has a Claude manifest, so its settings are read rather than ignored. */
export function readsSettings(set: ManifestSet): boolean {
  return set.manifests.some((manifest) => manifest.dialect === "claude");
}

/** The main agent's name, or `undefined` when the settings name none (or none that exists). */
export function normaliseMainAgent(
  index: PluginFileIndex,
  set: ManifestSet,
  subAgents: readonly PluginSubAgent[],
  findings: Findings,
): string | undefined {
  const claude = set.manifests.find((manifest) => manifest.dialect === "claude");
  if (claude === undefined) return undefined;

  const layers: { readonly path: string; readonly object: JsonObject }[] = [];
  if (claude.settings !== undefined) {
    if (!isJsonObject(claude.settings)) {
      findings.error("manifest-field-type", { path: claude.path, subject: "settings", detail: "an object" });
      return undefined;
    }
    layers.push({ path: `${claude.path}#settings`, object: claude.settings });
  }
  if (index.has(SETTINGS_FILE)) {
    const text = readText(index, SETTINGS_FILE, "settings", findings);
    if (text === undefined) return undefined;
    const object = parseJsonObject(text, SETTINGS_FILE, "settings-unreadable", findings);
    if (object === undefined) return undefined;
    layers.push({ path: SETTINGS_FILE, object });
  }

  // The last layer setting `agent` wins: the file over the inline object.
  let agent: { readonly path: string; readonly value: unknown } | undefined;
  for (const layer of layers) {
    for (const [key, value] of fields(layer.object)) {
      if (key === "agent") agent = { path: layer.path, value };
      else findings.warn("settings-key-ignored", { path: layer.path, subject: key });
    }
  }
  if (agent === undefined) return undefined;

  const raw = agent.value;
  const prefix = `${set.name ?? ""}:`;
  const name = typeof raw === "string" && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  if (typeof name !== "string" || !subAgents.some((subAgent) => subAgent.name === name)) {
    findings.warn("settings-agent-unknown", { path: agent.path, detail: describeValue(raw) });
    return undefined;
  }
  return name;
}
