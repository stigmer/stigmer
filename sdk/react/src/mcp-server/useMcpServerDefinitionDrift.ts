"use client";

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import {
  computeDefinitionDrift,
  type DriftFieldId,
} from "./internal/definitionDrift.js";

/** A detected divergence from the marketplace definition. */
export interface McpServerDefinitionDrift {
  /** The marketplace definition the comparison ran against. */
  readonly template: McpServer;
  /** Connection-defining field groups that differ. Never empty. */
  readonly changedFields: readonly DriftFieldId[];
}

/** Return value of {@link useMcpServerDefinitionDrift}. */
export interface UseMcpServerDefinitionDriftReturn {
  /**
   * The detected drift, or `null` — which covers all of: still checking,
   * no marketplace counterpart, ambiguous counterpart, configurations
   * match, or the check failed. Consumers need no other state: this is an
   * advisory affordance, not page data.
   */
  readonly drift: McpServerDefinitionDrift | null;
}

/**
 * Detects when an org-owned MCP server's connection-defining
 * configuration has drifted from the marketplace definition it mirrors
 * (stigmer/stigmer#228: a template fix — e.g. monday.com's OAuth header —
 * never reached servers copied before the fix, stranding them on a
 * configuration that can never connect).
 *
 * **How the marketplace counterpart is found.** Connected copies carry no
 * reference back to their template, so the hook uses the platform's own
 * client-side definition of "marketplace": the search RPC's
 * `crossOrgPublic` scope (what the library's "All" tab shows). A public
 * row with the exact same slug from a different org is treated as the
 * template. Zero or multiple candidates means there is nothing
 * trustworthy to compare against — the hook stays quiet.
 *
 * **Fail-quiet by design.** Drift detection is advisory. No network
 * error, missing template, or ambiguity may ever degrade the detail page,
 * so every failure path resolves to `null` rather than an error state.
 *
 * Pass `null` to skip (stable no-op) — callers gate on editability, since
 * the paired refresh action writes to the resource and the notice is
 * meaningless to viewers who cannot act on it.
 */
export function useMcpServerDefinitionDrift(
  mcpServer: McpServer | null,
): UseMcpServerDefinitionDriftReturn {
  const stigmer = useStigmer();

  const org = mcpServer?.metadata?.org ?? null;
  const slug = mcpServer?.metadata?.slug ?? null;

  const { data: drift } = useFetch<McpServerDefinitionDrift | null>(
    mcpServer && org && slug
      ? async () => {
          try {
            const result = await stigmer.mcpServer.list({
              org,
              query: slug,
              crossOrgPublic: true,
            });
            const candidateOrgs = [
              ...new Set(
                result.entries
                  .filter((e) => e.slug === slug && e.org && e.org !== org)
                  .map((e) => e.org),
              ),
            ];
            if (candidateOrgs.length !== 1) return null;

            const template = await stigmer.mcpServer.getByReference({
              org: candidateOrgs[0],
              slug,
            });
            const changedFields = computeDefinitionDrift(mcpServer, template);
            return changedFields ? { template, changedFields } : null;
          } catch {
            return null;
          }
        }
      : null,
    [mcpServer, org, slug, stigmer],
    null,
  );

  return { drift };
}
