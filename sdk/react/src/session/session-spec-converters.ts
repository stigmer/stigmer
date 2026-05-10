import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type {
  McpServerUsageInput,
  ResourceRef,
  WorkspaceEntryInput,
} from "@stigmer/sdk";

/**
 * Convert proto workspace entries back to SDK input format.
 *
 * Used by `useSessionConversation` (session update with replace semantics)
 * and `useSessionPageFlow` (hydrating composer state from a loaded session).
 */
export function specWorkspaceToInput(
  spec: Session["spec"],
): WorkspaceEntryInput[] | undefined {
  return spec?.workspaceEntries?.map((e): WorkspaceEntryInput => {
    if (e.source?.source.case === "gitRepo") {
      const v = e.source.source.value;
      return {
        name: e.name || undefined,
        source: {
          gitRepo: {
            url: v.url,
            branch: v.branch || undefined,
            commit: v.commit || undefined,
            depth: v.depth || undefined,
          },
        },
      };
    }
    if (e.source?.source.case === "localPath") {
      return {
        name: e.name || undefined,
        source: {
          localPath: { path: e.source.source.value.path || undefined },
        },
      };
    }
    return { name: e.name || undefined, source: {} };
  });
}

/**
 * Convert proto MCP server usages back to SDK input format.
 *
 * Used by `useSessionConversation` (session update with replace semantics)
 * and `useSessionPageFlow` (hydrating composer state from a loaded session).
 */
export function specMcpUsagesToInput(
  spec: Session["spec"],
): McpServerUsageInput[] | undefined {
  return spec?.mcpServerUsages?.map((u) => ({
    mcpServerRef: {
      org: u.mcpServerRef?.org ?? "",
      slug: u.mcpServerRef?.slug ?? "",
      version: u.mcpServerRef?.version || undefined,
      kind: u.mcpServerRef?.kind,
    },
    enabledTools: u.enabledTools?.length ? [...u.enabledTools] : undefined,
    toolApprovalOverrides: u.toolApprovalOverrides?.length
      ? u.toolApprovalOverrides.map((o) => ({
          toolName: o.toolName || undefined,
          requiresApproval: o.requiresApproval || undefined,
          message: o.message || undefined,
        }))
      : undefined,
  }));
}

/**
 * Convert proto skill references back to SDK input format.
 *
 * Used by `useSessionConversation` (session update with replace semantics)
 * and `useSessionPageFlow` (hydrating composer state from a loaded session).
 */
export function specSkillRefsToInput(
  spec: Session["spec"],
): ResourceRef[] | undefined {
  return spec?.skillRefs?.map((r) => ({
    org: r.org ?? "",
    slug: r.slug ?? "",
    version: r.version || undefined,
    kind: r.kind,
  }));
}
