import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServerInput } from "@stigmer/sdk";
import { mcpServerToInput } from "./mcpServerToInput.js";

/**
 * Connection-defining field groups a marketplace definition can drift on.
 *
 * Stable identifiers, not display copy — {@link DefinitionDriftNotice}
 * owns the human-readable labels. Cosmetic fields (description, icon,
 * tags, repository metadata, env var descriptions) are deliberately NOT
 * drift: they cannot break a connection, so they never nag — they simply
 * ride along when the user refreshes.
 */
export type DriftFieldId =
  | "transport"
  | "endpoint"
  | "headers"
  | "queryParams"
  | "timeout"
  | "command"
  | "workingDirectory"
  | "environmentVariables"
  | "authentication";

/**
 * Deep equality over the plain-object projections produced by
 * `mcpServerToInput`. Key order is irrelevant (proto map iteration order
 * is not canonical); `undefined` values and absent keys are equivalent
 * (the conversion uses `undefined` for proto defaults).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => deepEqual(v, b[i]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * The functional shape of an env declaration map: which vars exist,
 * whether they are secret, whether they are optional. Descriptions are
 * guidance for humans — a description-only template edit must not raise
 * a drift notice.
 */
function functionalEnvShape(env: McpServerInput["env"]) {
  if (!env) return undefined;
  const shape: Record<string, { isSecret?: boolean; optional?: boolean }> = {};
  for (const [key, decl] of Object.entries(env)) {
    shape[key] = { isSecret: decl.isSecret, optional: decl.optional };
  }
  return shape;
}

/**
 * Compares an org-owned MCP server against the marketplace definition it
 * mirrors and reports which connection-defining field groups differ, or
 * `null` when the connection-defining configuration matches.
 *
 * The comparison runs on `mcpServerToInput` projections rather than raw
 * protos: that conversion is the SDK's canonical read-modify-write lens,
 * and its exhaustiveness is fence-tested — so a new spec field cannot
 * silently bypass this comparison either.
 */
export function computeDefinitionDrift(
  current: McpServer,
  template: McpServer,
): readonly DriftFieldId[] | null {
  const cur = mcpServerToInput(current);
  const tpl = mcpServerToInput(template);

  const changed: DriftFieldId[] = [];

  const curTransport = cur.stdio ? "stdio" : cur.http ? "http" : "none";
  const tplTransport = tpl.stdio ? "stdio" : tpl.http ? "http" : "none";

  if (curTransport !== tplTransport) {
    changed.push("transport");
  } else if (curTransport === "http") {
    if (cur.http!.url !== tpl.http!.url) changed.push("endpoint");
    if (!deepEqual(cur.http!.headers, tpl.http!.headers)) changed.push("headers");
    if (!deepEqual(cur.http!.queryParams, tpl.http!.queryParams)) {
      changed.push("queryParams");
    }
    if (cur.http!.timeoutSeconds !== tpl.http!.timeoutSeconds) {
      changed.push("timeout");
    }
  } else if (curTransport === "stdio") {
    if (
      cur.stdio!.command !== tpl.stdio!.command ||
      !deepEqual(cur.stdio!.args, tpl.stdio!.args)
    ) {
      changed.push("command");
    }
    if (cur.stdio!.workingDir !== tpl.stdio!.workingDir) {
      changed.push("workingDirectory");
    }
  }

  if (!deepEqual(functionalEnvShape(cur.env), functionalEnvShape(tpl.env))) {
    changed.push("environmentVariables");
  }

  if (!deepEqual(cur.auth, tpl.auth)) {
    changed.push("authentication");
  }

  return changed.length > 0 ? changed : null;
}

/**
 * Builds the update payload for a one-click "refresh from marketplace".
 *
 * Definition fields — transport, env declarations, auth, and the cosmetic
 * description/icon/tags/repository metadata — come from the template.
 * The user's own choices survive: identity (name/org/slug/labels), tool
 * enablement, and pinned approval policies. Visibility is not part of the
 * input contract at all (the backend preserves it on update;
 * `updateVisibility` is its dedicated write path).
 *
 * Built by merging two `mcpServerToInput` projections, so the preserved
 * set is the explicit override list below and nothing can be lost in
 * translation (the conversion is fence-tested exhaustive).
 */
export function buildRefreshInput(
  current: McpServer,
  template: McpServer,
): McpServerInput {
  const cur = mcpServerToInput(current);
  const tpl = mcpServerToInput(template);

  return {
    ...tpl,
    // Identity: the update must land on the user's own resource.
    name: cur.name,
    org: cur.org,
    slug: cur.slug,
    labels: cur.labels,
    // User policy: never reset by a definition refresh.
    defaultEnabledTools: cur.defaultEnabledTools,
    pinnedToolApprovals: cur.pinnedToolApprovals,
  };
}
