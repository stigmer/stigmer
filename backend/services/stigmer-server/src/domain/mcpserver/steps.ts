/**
 * McpServer domain-local pipeline steps — port
 * pkg/domain/mcpserver/controller/enrich_oauth_status.go. Shared
 * vocabulary step names.
 *
 * Proven by __tests__/mcpserver.test.ts and mcpserver.conformance.test.ts
 * (CONFORMANCE_TARGET=local).
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
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import type { Store } from "../../store/interface.js";
import { toolAddressOf } from "../vault/address.js";
import { findOrganizationApp } from "../vault/login-app.js";

/**
 * EnrichOAuthStatus — populates response-only status.oauth_status on a
 * loaded McpServer from the login app its organization keeps for the
 * server's address (an OAuthApp listing it, domain/vault/login-app.ts), so
 * the shared SDK's vendor-approval-blocked UI renders before anyone clicks
 * (stigmer/stigmer#523). Without it, a user's first hint that sign-in is
 * vendor-blocked is the start's refusal.
 *
 * Semantics:
 *   - A server with no address, or no app for its address in its
 *     organization, is untouched (Stigmer's built-in apps are listed only
 *     once approved).
 *   - oauth_status is set only when there is something to gate on: a
 *     non-default vendor_approval_status or a docs URL. Its very presence
 *     is the signal the SDK keys on, so "nothing to report" means absent.
 *   - The fields are response-only, per the OAuthStatus proto contract.
 *     Nothing here persists: get pipelines don't save, and the write
 *     pipelines clear client-sent status, so a round-tripped enriched
 *     read cannot leak into the store.
 *
 * A store failure during the lookup degrades to an unenriched response
 * (WARN) instead of failing the read: enrichment is advisory, the start's
 * vendor refusal remains the enforcement boundary, and an advisory lookup
 * must not take down the primary read path.
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
      const address = mcpServer === undefined ? undefined : toolAddressOf(mcpServer);
      if (mcpServer === undefined || address === undefined || mcpServer.spec?.auth === undefined) {
        return;
      }

      let oauthApp;
      try {
        oauthApp = await findOrganizationApp(store, mcpServer.metadata?.org ?? "", address);
      } catch (error) {
        logger.warn(
          "Login app lookup failed; returning MCP server without oauth_status enrichment",
          {
            mcpServerId: mcpServer.metadata?.id ?? "",
            address,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return;
      }
      if (oauthApp === undefined) {
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
