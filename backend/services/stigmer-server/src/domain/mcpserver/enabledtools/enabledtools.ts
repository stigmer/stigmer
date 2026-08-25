/**
 * Enabled-tools classification — ports
 * pkg/domain/mcpserver/enabledtools/enabledtools.go: classifies
 * enabled-tools selections against an MCP server's discovered capabilities.
 *
 * It is the shared core of the apply-time validation added for issue #402:
 * the agent controller checks McpServerUsage.enabled_tools and the
 * mcpserver controller (arriving with sub-project #9 — this module is its
 * first resident, placed here so the tree keeps corresponding to Go's)
 * checks McpServerSpec.default_enabled_tools, and both must agree on what
 * counts as a valid tool name. Keeping the classification here — in the
 * domain that owns capability semantics — prevents the two error paths
 * from drifting.
 *
 * The classification deliberately distinguishes resource templates from
 * plainly unknown names: a resource-template name in an enabled-tools list
 * is a specific, documented mistake (templates are read-only data
 * endpoints, not callable tools — see DiscoveredCapabilities in
 * mcpserver/v1/status.proto), and the error message should say so instead
 * of implying a typo.
 */
import type { DiscoveredCapabilities } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";

/**
 * Partitions the requested-but-invalid names of an enabled-tools list.
 * Names present in the server's discovered tools appear in neither array.
 * Order follows the requested list (stable, deterministic error messages).
 */
export interface Classification {
  /**
   * Names the server exposes neither as a tool nor as a resource template
   * — almost always typos or stale entries.
   */
  readonly unknown: string[];
  /**
   * Names that match a discovered resource template: real names on the
   * server, but never callable as tools.
   */
  readonly resourceTemplates: string[];
}

/** Whether every requested name resolved to a discovered tool. */
export function isValidClassification(c: Classification): boolean {
  return c.unknown.length === 0 && c.resourceTemplates.length === 0;
}

/**
 * Checks each requested name against the discovered capabilities. Matching
 * is exact and case-sensitive — tool names must match what the server
 * reports via tools/list (see McpServerUsage.enabled_tools docs).
 *
 * Callers are expected to skip validation entirely when capabilities are
 * absent (server not yet connected); classifying against absent
 * capabilities would mark every name unknown, which is not a statement the
 * platform can honestly make before the first discovery.
 */
export function classify(
  caps: DiscoveredCapabilities,
  requested: readonly string[],
): Classification {
  const tools = new Set(caps.tools.map((tool) => tool.name));
  const templates = new Set(caps.resourceTemplates.map((tmpl) => tmpl.name));

  const unknown: string[] = [];
  const resourceTemplates: string[] = [];
  for (const name of requested) {
    if (tools.has(name)) {
      continue;
    }
    if (templates.has(name)) {
      resourceTemplates.push(name);
      continue;
    }
    unknown.push(name);
  }
  return { unknown, resourceTemplates };
}

/**
 * The discovered tool names in discovery order, for error messages that
 * tell the operator what IS valid.
 */
export function toolNames(caps: DiscoveredCapabilities): string[] {
  return caps.tools.map((tool) => tool.name);
}

/**
 * Renders a name list as 'a', 'b', 'c' for error messages — shared so the
 * agent and mcpserver error texts quote tool names identically.
 */
export function quoteJoin(names: readonly string[]): string {
  return names.map((n) => `'${n}'`).join(", ");
}
