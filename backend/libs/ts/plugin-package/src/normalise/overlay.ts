/**
 * Stigmer's own extension folder, `ai.stigmer/`: located and checked here,
 * parsed by the installer.
 *
 * The open format gives each client a reverse-domain directory other clients
 * ignore; Stigmer's carries what no portable component can say: a full
 * `Agent` that replaces the composed default (`agent.yaml`), `Workflow`s
 * (`workflows/<name>.yaml`), and the richer `McpServer` overlay for a
 * declared server (`mcp-servers/<server>.yaml`: auth, scope hints, default
 * tools). The library hands these over as bytes with their paths and keeps
 * no knowledge of the resource schemas; the installer parses them where
 * the protos live.
 *
 * Two checks are the library's because they are about the plugin, not the
 * resources: an overlay for a server the plugin does not declare is refused
 * (an overlay that silently applies to nothing is the drift the model
 * exists to prevent), and a file under `ai.stigmer/` that is none of the
 * three document shapes is refused for the same reason (`agent.yml` would
 * otherwise be a typo that installs the composed default).
 */

import { readBytes } from "../documents.js";
import { basename, dirname, type PluginFileIndex } from "../files.js";
import type { Findings } from "../messages.js";
import type { OverlayNamedDocument, OverlayServerDocument, StigmerOverlay } from "../types.js";

export const OVERLAY_DIR = "ai.stigmer";
const AGENT_DOCUMENT = `${OVERLAY_DIR}/agent.yaml`;
const WORKFLOWS_DIR = `${OVERLAY_DIR}/workflows`;
const MCP_SERVERS_DIR = `${OVERLAY_DIR}/mcp-servers`;

/** `serverNames` is every server the plugin DECLARED, refused ones included, so a refused server's overlay is not blamed twice. */
export function normaliseOverlay(index: PluginFileIndex, serverNames: ReadonlySet<string>, findings: Findings): StigmerOverlay {
  const overlay: { -readonly [K in keyof StigmerOverlay]: StigmerOverlay[K] } = { workflows: [], mcpServers: [] };
  const workflows: OverlayNamedDocument[] = [];
  const mcpServers: OverlayServerDocument[] = [];

  for (const path of index.filesUnder(OVERLAY_DIR)) {
    if (path === AGENT_DOCUMENT) {
      const bytes = readBytes(index, path, "overlay", findings);
      if (bytes !== undefined) overlay.agent = { path, bytes };
      continue;
    }
    const name = yamlStem(path);
    if (name !== undefined && dirname(path) === WORKFLOWS_DIR) {
      const bytes = readBytes(index, path, "overlay", findings);
      if (bytes !== undefined) workflows.push({ path, bytes, name });
      continue;
    }
    if (name !== undefined && dirname(path) === MCP_SERVERS_DIR) {
      if (!serverNames.has(name)) {
        findings.error("overlay-server-unknown", { path, subject: name });
        continue;
      }
      const bytes = readBytes(index, path, "overlay", findings);
      if (bytes !== undefined) mcpServers.push({ path, bytes, server: name });
      continue;
    }
    findings.error("overlay-document-unknown", { path });
  }

  overlay.workflows = workflows;
  overlay.mcpServers = mcpServers;
  return overlay;
}

/** The file stem of a `.yaml` document, or `undefined` for any other file. */
function yamlStem(path: string): string | undefined {
  const name = basename(path);
  return name.endsWith(".yaml") && name.length > ".yaml".length ? name.slice(0, -".yaml".length) : undefined;
}
