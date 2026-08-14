/**
 * Enforcement semantics for McpServerUsage.enabled_tools (issue #350).
 *
 * The proto contract (agent/v1/spec.proto McpServerUsage.enabled_tools,
 * mcpserver/v1/spec.proto McpServerSpec.default_enabled_tools):
 * - A non-empty enabled_tools on the usage is the allow-list for that server.
 * - An empty usage list falls back to the server's default_enabled_tools.
 * - Both empty means NO restriction — every discovered tool is available.
 *
 * Resolution is shared (shared/mcp-resolver.ts threads the effective list
 * onto every ResolvedMcpServer), but ENFORCEMENT is per-harness:
 * - The deep-agent harness filters the discovered toolset before it reaches
 *   the model (shared/mcp-manager.ts connectMcpServers).
 * - The Cursor harness cannot hide tools (the Cursor SDK's McpServerConfig
 *   has no allow-list field), so it denies non-enabled calls in the HITL
 *   hook instead (execute-cursor/approval-state.ts mcpServerEnabledTools +
 *   the "disabled" arm in hook-script.ts). Same guarantee, fail-closed.
 *
 * Names are bare tool names exactly as reported by tools/list — the same
 * identity space as the sub-agent McpAccess filter and the approval-policy
 * maps. An enabled name the server does not expose is warned and dropped
 * (enforce the intersection): the restriction still holds and the run
 * proceeds with the valid subset. The server-side half (issue #402) rejects
 * such names at apply time once the referenced server has discovered
 * capabilities (stigmer-server validateEnabledToolsStep /
 * validateDefaultEnabledToolsStep); this runtime leniency remains the
 * safety net for manifests applied before a server's first connect and for
 * toolsets that changed since the last discovery.
 */

/**
 * Compute the effective allow-list for one resolved MCP server.
 *
 * Returns `undefined` when the server is unrestricted (both lists empty) —
 * the absent-field shape ResolvedMcpServer carries so synthesized attachment
 * servers and the discovery path stay unfiltered by construction.
 */
export function effectiveEnabledTools(
  usageEnabledTools: readonly string[] | undefined,
  defaultEnabledTools: readonly string[] | undefined,
): string[] | undefined {
  if (usageEnabledTools && usageEnabledTools.length > 0) {
    return [...usageEnabledTools];
  }
  if (defaultEnabledTools && defaultEnabledTools.length > 0) {
    return [...defaultEnabledTools];
  }
  return undefined;
}

/**
 * Filter a server's discovered tools by its effective allow-list.
 *
 * `undefined` enabledTools → unrestricted, tools pass through untouched.
 * Otherwise only tools whose bare name is on the list survive; enabled names
 * the server does not expose are warned and ignored (warn-and-intersect —
 * a stale or mistyped name must narrow the toolset, never widen it or fail
 * the run).
 */
export function filterToolsByEnabledTools<T extends { name: string }>(
  slug: string,
  tools: readonly T[],
  enabledTools: readonly string[] | undefined,
): T[] {
  if (!enabledTools) {
    return [...tools];
  }

  const allowed = new Set(enabledTools);
  const filtered = tools.filter((tool) => allowed.has(tool.name));

  const discovered = new Set(tools.map((t) => t.name));
  const unknown = enabledTools.filter((name) => !discovered.has(name));
  if (unknown.length > 0) {
    console.warn(
      `[MCP] Server '${slug}': enabled_tools lists [${unknown.join(", ")}] ` +
      `which the server does not expose — ignoring (the run proceeds with ` +
      `the ${filtered.length} matching tool(s)). Fix the agent's ` +
      `enabled_tools to match the server's discovered tools.`,
    );
  }

  console.log(
    `[MCP] Server '${slug}': enabled_tools restricts ${tools.length} ` +
    `discovered tool(s) to ${filtered.length}`,
  );

  return filtered;
}

/**
 * Collect the restricted servers' allow-lists keyed by slug — the shape the
 * Cursor harness writes into the approval state file (mcpServerEnabledTools)
 * for the hook's "disabled" arm. Unrestricted servers are ABSENT (the hook
 * treats an absent slug as unrestricted), so the common no-restriction case
 * stays an empty object.
 */
export function enabledToolsBySlug(
  servers: readonly { slug: string; enabledTools?: string[] }[],
): Record<string, string[]> {
  const bySlug: Record<string, string[]> = {};
  for (const server of servers) {
    if (server.enabledTools) {
      bySlug[server.slug] = [...server.enabledTools];
    }
  }
  return bySlug;
}
