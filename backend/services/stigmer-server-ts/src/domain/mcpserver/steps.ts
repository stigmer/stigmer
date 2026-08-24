/**
 * McpServer domain-local pipeline steps — port
 * pkg/domain/mcpserver/controller/validate_default_enabled_tools.go and
 * enrich_oauth_status.go. Shared vocabulary step names; error copy
 * byte-pinned from Go.
 *
 * Proven by __tests__/mcpserver.test.ts and mcpserver.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts).
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import type { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  McpServerStatusSchema,
  OAuthStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";

import type { Logger } from "../../boot/logger.js";
import { invalidArgumentError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import type { Store } from "../../store/interface.js";
import { resolveOAuthAppRef } from "../oauthapp/refresolution.js";
import {
  classify,
  isValidClassification,
  quoteJoin,
  toolNames,
} from "./enabledtools/enabledtools.js";

/**
 * ValidateDefaultEnabledTools — rejects updates whose
 * spec.default_enabled_tools name tools this server does not expose
 * (issue #402, the mcpserver twin of the agent controller's
 * ValidateEnabledTools step).
 *
 * The check is self-referential — spec against the resource's OWN stored
 * discovered capabilities — so it needs no store fetch: BuildUpdateState
 * has already copied the existing status (including capabilities) onto
 * the merged state this step reads.
 *
 * Wired into the UPDATE pipeline only. On create the resource cannot have
 * a status yet (the first discovery is the post-apply best-effort
 * connect), so a create-side check would be a no-op by construction;
 * leaving it unwired keeps the create pipeline honest about what it
 * enforces.
 *
 * Deliberate skips: an empty default_enabled_tools means "all tools
 * enabled" — nothing to check; absent discovered capabilities mean the
 * server was never connected, so there is no authoritative toolset to
 * validate against (the runner's warn-and-intersect, issue #350, remains
 * the safety net for that window).
 */
export function newValidateDefaultEnabledToolsStep(): PipelineStep<
  typeof McpServerSchema
> {
  return {
    name: "ValidateDefaultEnabledTools",
    execute(ctx: RequestContext<typeof McpServerSchema>): void {
      const mcpServer = ctx.newState;

      const requested = mcpServer.spec?.defaultEnabledTools ?? [];
      if (requested.length === 0) {
        return;
      }

      const caps = mcpServer.status?.discoveredCapabilities;
      if (caps === undefined) {
        return;
      }

      const classification = classify(caps, requested);
      if (isValidClassification(classification)) {
        return;
      }

      const problems: string[] = [];
      if (classification.unknown.length > 0) {
        problems.push(
          `default_enabled_tools names tool(s) this server does not expose: ${quoteJoin(classification.unknown)}`,
        );
      }
      if (classification.resourceTemplates.length > 0) {
        problems.push(
          `default_enabled_tools names resource template(s): ${quoteJoin(classification.resourceTemplates)} — resource templates are read-only data endpoints, not callable tools, and must not appear in default_enabled_tools`,
        );
      }

      throw invalidArgumentError(
        `MCP server '${mcpServer.metadata?.slug ?? ""}': ${problems.join("; ")}. Discovered tools: ${quoteJoin(toolNames(caps))}. If the server's toolset changed, run 'stigmer connect' on it to refresh discovered capabilities.`,
      );
    },
  };
}

/**
 * EnrichOAuthStatus — populates response-only status.oauth_status on a
 * loaded McpServer from the OAuthApp its spec.auth.oauth_app_ref points
 * to, mirroring the cloud's McpServerVendorApprovalEnricher so the shared
 * SDK's vendor-approval-blocked UI renders identically on both editions
 * (stigmer/stigmer#523). Without it, an OSS user's first hint that OAuth
 * sign-in is vendor-blocked is the initiate RPC's refusal — after they
 * click.
 *
 * Semantics shared with the cloud enricher:
 *   - Servers without an oauth_app_ref (DCR or manual-token) are
 *     untouched.
 *   - A missing OAuthApp skips enrichment (the initiate path owns
 *     refusing).
 *   - oauth_status is set only when there is something to gate on: a
 *     non-default vendor_approval_status or a docs URL. Its very presence
 *     is the signal the SDK keys on, so "nothing to report" means absent.
 *   - The fields are response-only, per the OAuthStatus proto contract.
 *     Nothing here persists: get pipelines don't save, and the write
 *     pipelines clear client-sent status, so a round-tripped enriched
 *     read cannot leak into the store.
 *
 * One deliberate divergence from cloud (Go's, preserved): a store failure
 * during the lookup degrades to an unenriched response (WARN) instead of
 * failing the read. Enrichment is advisory — the initiate RPC's vendor
 * refusal remains the enforcement boundary — and an advisory lookup must
 * not take down the primary read path.
 *
 * Generic over the pipeline input (get takes an ApiResourceId,
 * getByReference an ApiResourceReference); it only touches the
 * already-loaded target resource.
 */
export function newEnrichOAuthStatusStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "EnrichOAuthStatus",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const mcpServer = ctx.get(TARGET_RESOURCE_KEY) as McpServer | undefined;
      if (mcpServer === undefined) {
        return;
      }

      const ref = mcpServer.spec?.auth?.oauthAppRef;
      if ((ref?.slug ?? "") === "") {
        return;
      }

      let oauthApp;
      try {
        oauthApp = await resolveOAuthAppRef(store, ref, logger);
      } catch (error) {
        logger.warn(
          "OAuthApp lookup failed; returning MCP server without oauth_status enrichment",
          {
            mcpServerId: mcpServer.metadata?.id ?? "",
            oauthAppSlug: ref?.slug ?? "",
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }
      if (oauthApp === undefined) {
        logger.debug("OAuthApp not found for ref; skipping oauth_status enrichment", {
          mcpServerId: mcpServer.metadata?.id ?? "",
          oauthAppSlug: ref?.slug ?? "",
        });
        return;
      }

      const approvalStatus =
        oauthApp.spec?.vendorApprovalStatus ?? VendorApprovalStatus.UNSPECIFIED;
      const docsUrl = oauthApp.spec?.vendorApprovalDocsUrl ?? "";
      if (approvalStatus === VendorApprovalStatus.UNSPECIFIED && docsUrl === "") {
        return;
      }

      mcpServer.status ??= create(McpServerStatusSchema, {});
      mcpServer.status.oauthStatus = create(OAuthStatusSchema, {
        vendorApprovalStatus: approvalStatus,
        vendorApprovalDocsUrl: docsUrl,
      });
    },
  };
}
