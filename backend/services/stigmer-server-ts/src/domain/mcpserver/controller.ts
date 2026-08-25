/**
 * McpServer controller — ports pkg/domain/mcpserver/controller whole:
 * the CRUD slice (D4 entry #9) and the connect/OAuth slice (D4 entry
 * #19). Registered methods: apply/create/update/delete/updateVisibility +
 * connect/startConnect/initiateOAuthConnect/completeOAuthConnect/
 * disconnectOAuth on the command side; get/getByReference/
 * getOAuthGrantStatus on the query side; plus the three org-OAuth RPCs as
 * PERMANENT UNIMPLEMENTED stubs (below).
 *
 * The connect/OAuth slice lives in sibling modules named for their Go
 * files (connect.ts, start-connect.ts, initiate-oauth-connect.ts,
 * complete-oauth-connect.ts, disconnect-oauth.ts,
 * get-oauth-grant-status.ts; shared status bookkeeping in
 * connect-status.ts). They are plain handlers — Go uses no pipeline for
 * this slice — over the McpServerConnectDeps the composition root wires.
 * Engine availability is the modeled state: connect/startConnect refuse
 * FailedPrecondition while disconnected; the OAuth RPCs serve
 * unconditionally (DB-1, sub-project 20260825.02 — Go's Temporal-gated
 * managed-env wiring is a disclosed, deliberately unpinned composition
 * artifact).
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies,
 * and Publish steps (no multi-tenant auth, IAM/FGA, or event publishing).
 *
 * Proven by mcpserver.conformance.test.ts +
 * agent-mcpserver-references.conformance.test.ts +
 * mcpserver-oauth.conformance.test.ts (CONFORMANCE_TARGET=local-ts),
 * mcpserver-connect.conformance.test.ts
 * (CONFORMANCE_TARGET=local-ts-execution), and __tests__/.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import type {
  ApiResourceDeleteInput,
  ApiResourceId,
  ApiResourceReference,
  UpdateVisibilityInput,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError, notFoundError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { setAuditFieldsForUpdate, newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import {
  newDeleteSearchIndexStep,
  newIndexSearchStep,
} from "../../pipeline/steps/index-search.js";
import { EXISTING_RESOURCE_KEY, newLoadExistingStep } from "../../pipeline/steps/load-existing.js";
import { SHOULD_CREATE_KEY, newLoadForApplyStep } from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import { TARGET_RESOURCE_KEY, newLoadTargetStep } from "../../pipeline/steps/load-target.js";
import { newNormalizeReferencesStep } from "../../pipeline/steps/references.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import {
  newValidateVisibilityStep,
  newValidateVisibilityUpdateStep,
} from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import { completeOAuthConnect } from "./complete-oauth-connect.js";
import { connect, startBestEffortConnect } from "./connect.js";
import type { McpServerConnectDeps } from "./connect.js";
import { disconnectOAuth } from "./disconnect-oauth.js";
import { getOAuthGrantStatus } from "./get-oauth-grant-status.js";
import { initiateOAuthConnect } from "./initiate-oauth-connect.js";
import { mcpServerSearchExtractor } from "./search-extractor.js";
import { startConnect } from "./start-connect.js";
import {
  newEnrichOAuthStatusStep,
  newValidateDefaultEnabledToolsStep,
} from "./steps.js";

export interface McpServerControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The connect/OAuth slice's dependencies (D4 #19). */
  readonly connect: McpServerConnectDeps;
}

/** Registers both mcpserver services on the router (routes stage). */
export function registerMcpServerServices(
  router: ConnectRouter,
  deps: McpServerControllerDeps,
): void {
  router.service(McpServerCommandController, {
    apply: (server, ctx) => apply(deps, server, ctx),
    create: (server, ctx) => createMcpServer(deps, server, ctx),
    update: (server, ctx) => update(deps, server, ctx),
    updateVisibility: (input, ctx) => updateVisibility(deps, input, ctx),
    delete: (input, ctx) => deleteMcpServer(deps, input, ctx),
    connect: (input) => connect(deps.connect, input),
    startConnect: (input) => startConnect(deps.connect, input),
    initiateOAuthConnect: (input) => initiateOAuthConnect(deps.connect, input),
    completeOAuthConnect: (input) => completeOAuthConnect(deps.connect, input),
    disconnectOAuth: (input) => disconnectOAuth(deps.connect, input),
    setOrgOAuthApp: () => {
      throw orgOAuthAppUnimplemented("SetOrgOAuthApp");
    },
    deleteOrgOAuthApp: () => {
      throw orgOAuthAppUnimplemented("DeleteOrgOAuthApp");
    },
  });
  router.service(McpServerQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    getOAuthGrantStatus: (input) => getOAuthGrantStatus(deps.connect, input),
    getOrgOAuthApp: () => {
      throw orgOAuthAppUnimplemented("GetOrgOAuthApp");
    },
  });
}

/**
 * The org-OAuth-app (BYOA override) surface answers UNIMPLEMENTED on OSS —
 * deliberately, not as coexistence lag (stigmer/stigmer#558, DD-019 in the
 * triage project). An OAuthAppOverride binds an org's own OAuthApp OVER a
 * platform-managed default; OSS has no platform operator distinct from the
 * user — the flat oauthapp domain gives the user full CRUD over the very
 * apps a hosted org could only override — and the OSS OAuth resolution
 * (refresolution) has no override level to consult: the ref IS the whole
 * resolution.
 *
 * The three RPCs are ONE capability. The shared SDK probes it via
 * getOrgOAuthApp and hides every BYOA affordance when the probe answers
 * UNIMPLEMENTED (useOrgOAuthApp.isSupported). Implementing any one RPC
 * without the other two — e.g. a "truthful" read returning
 * has_override=false — would break the probe and resurrect dead
 * affordances on OSS. If this surface is ever brought to OSS, all three
 * RPCs, the OSS resolution chain, and the SDK gate must move together.
 *
 * Explicit stubs (never unregistered methods): connect-es DOES answer an
 * unregistered method of a registered service with Code.Unimplemented —
 * but with ITS generated text ("<service>.<method> is not implemented"),
 * not grpc-go's. Go answers through its embedded
 * Unimplemented*ControllerServer, whose text is the pinned contract; the
 * stubs exist to carry that text byte-for-byte and this doc block.
 */
function orgOAuthAppUnimplemented(method: string): ConnectError {
  return new ConnectError(`method ${method} not implemented`, Code.Unimplemented);
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/** Create — chain per Go buildCreatePipeline. */
async function createMcpServer(
  deps: McpServerControllerDeps,
  server: McpServer,
  ctx: HandlerContext,
): Promise<McpServer> {
  const reqCtx = new RequestContext(McpServerSchema, server, kindOf(ctx));
  await newPipeline<typeof McpServerSchema>("mcpserver-create", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newResolveSlugStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newBuildNewStateStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(newIndexSearchStep(deps.store, mcpServerSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline. ValidateDefaultEnabledTools
 * (#402) runs AFTER BuildUpdateState: the check is self-referential
 * against the OWN status the merge just carried over.
 */
async function update(
  deps: McpServerControllerDeps,
  server: McpServer,
  ctx: HandlerContext,
): Promise<McpServer> {
  const reqCtx = new RequestContext(McpServerSchema, server, kindOf(ctx));
  await newPipeline<typeof McpServerSchema>("mcpserver-update", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newValidateDefaultEnabledToolsStep())
    .addStep(newNormalizeReferencesStep())
    .addStep(newPersistStep(deps.store))
    .addStep(newIndexSearchStep(deps.store, mcpServerSearchExtractor, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update: a minimal probe pipeline
 * decides existence, then delegates with the ORIGINAL request message.
 *
 * The tail fires startBestEffortConnect on the result — Go's
 * `go StartBestEffortConnect(result)` (apply.go:76), auto discovery
 * through the runner's connect workflow. Fire-and-forget on purpose: the
 * gRPC response must not wait on a discovery run; a disconnected engine
 * makes it a silent no-op (byte parity with Go's nil-client return).
 */
async function apply(
  deps: McpServerControllerDeps,
  server: McpServer,
  ctx: HandlerContext,
): Promise<McpServer> {
  const reqCtx = new RequestContext(McpServerSchema, server, kindOf(ctx));
  await newPipeline<typeof McpServerSchema>("mcpserver-apply", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadForApplyStep(deps.store))
    .build()
    .execute(reqCtx);

  const shouldCreate = reqCtx.get(SHOULD_CREATE_KEY);
  if (typeof shouldCreate !== "boolean") {
    throw internalError(
      new Error("apply pipeline did not set shouldCreate flag"),
      "apply operation failed to determine create vs update",
    );
  }
  const result = shouldCreate
    ? await createMcpServer(deps, server, ctx)
    : await update(deps, server, ctx);

  // startBestEffortConnect's arms never throw by design; the catch is
  // the process-safety net an unhandled rejection would pierce.
  void startBestEffortConnect(deps.connect, result).catch((error: unknown) => {
    deps.logger.warn("Best-effort connect task failed unexpectedly", {
      mcp_server_id: result.metadata?.id ?? "",
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return result;
}

/**
 * Delete — returns the deleted server (the audit-trail convention). The
 * id is seeded into context manually because ApiResourceDeleteInput
 * carries resource_id, not the `value` field ExtractResourceId expects
 * (Go does the same manual seed).
 */
async function deleteMcpServer(
  deps: McpServerControllerDeps,
  input: ApiResourceDeleteInput,
  ctx: HandlerContext,
): Promise<McpServer> {
  const reqCtx = new RequestContext(
    McpServerCommandController.method.delete.input,
    input,
    kindOf(ctx),
  );
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  await newPipeline<typeof McpServerCommandController.method.delete.input>(
    "mcpserver-delete",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, McpServerSchema))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(newDeleteSearchIndexStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted mcp server not found in context"),
      "deleted mcp server not found in context",
    );
  }
  return deleted as McpServer;
}

// ---------------------------------------------------------------------------
// updateVisibility — Go update_visibility.go: a targeted metadata update
// (only metadata.visibility changes). Load runs before level validation so
// NOT_FOUND wins, as in Cloud.
// ---------------------------------------------------------------------------

const UPDATE_VISIBILITY_MCP_SERVER_KEY = "updateVisibilityMcpServer";

type UpdateVisibilityDesc =
  typeof McpServerCommandController.method.updateVisibility.input;

async function updateVisibility(
  deps: McpServerControllerDeps,
  input: UpdateVisibilityInput,
  ctx: HandlerContext,
): Promise<McpServer> {
  const reqCtx = new RequestContext(
    McpServerCommandController.method.updateVisibility.input,
    input,
    kindOf(ctx),
  );
  await newPipeline<UpdateVisibilityDesc>("mcpserver-update-visibility", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newLoadMcpServerForVisibilityUpdateStep(deps.store))
    .addStep(newValidateVisibilityUpdateStep())
    .addStep(newSetMcpServerVisibilityStep())
    .addStep(newPersistMcpServerForVisibilityUpdateStep(deps.store))
    .addStep(newIndexMcpServerAfterVisibilityUpdateStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(UPDATE_VISIBILITY_MCP_SERVER_KEY) as McpServer;
}

/** Loads the server by resource_id; ANY load failure → NotFound. */
function newLoadMcpServerForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "LoadMcpServerForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const input = ctx.input;
      let mcpServer: McpServer;
      try {
        mcpServer = await store.getResource(
          ctx.apiResourceKind,
          input.resourceId,
          McpServerSchema,
        );
      } catch {
        throw notFoundError("mcp_server", input.resourceId);
      }
      ctx.set(UPDATE_VISIBILITY_MCP_SERVER_KEY, mcpServer);
    },
  };
}

/** Sets metadata.visibility and stamps the StatusAudit slot (#540). */
function newSetMcpServerVisibilityStep(): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "SetMcpServerVisibility",
    execute(ctx: RequestContext<UpdateVisibilityDesc>): void {
      const mcpServer = ctx.get(UPDATE_VISIBILITY_MCP_SERVER_KEY) as McpServer;
      if (mcpServer.metadata !== undefined) {
        mcpServer.metadata.visibility = ctx.input.visibility;
      }
      setAuditFieldsForUpdate(McpServerSchema, mcpServer, "status_audit");
    },
  };
}

/** Persists the visibility change. */
function newPersistMcpServerForVisibilityUpdateStep(
  store: Store,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "PersistMcpServerForVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const mcpServer = ctx.get(UPDATE_VISIBILITY_MCP_SERVER_KEY) as McpServer;
      try {
        await store.saveResource(
          ctx.apiResourceKind,
          mcpServer.metadata?.id ?? "",
          McpServerSchema,
          mcpServer,
        );
      } catch (error) {
        throw internalError(error, "failed to save mcp server");
      }
    },
  };
}

/** Re-indexes after the change (visibility is indexed); best-effort. */
function newIndexMcpServerAfterVisibilityUpdateStep(
  store: Store,
  logger: Logger,
): PipelineStep<UpdateVisibilityDesc> {
  return {
    name: "IndexMcpServerAfterVisibilityUpdate",
    async execute(ctx: RequestContext<UpdateVisibilityDesc>): Promise<void> {
      const mcpServer = ctx.get(UPDATE_VISIBILITY_MCP_SERVER_KEY) as McpServer;
      const entry = mcpServerSearchExtractor.getSearchIndexEntry(mcpServer);
      if (entry === undefined) {
        logger.warn(
          "IndexMcpServerAfterVisibilityUpdate: extractor returned nil, skipping",
          { id: mcpServer.metadata?.id ?? "" },
        );
        return;
      }
      try {
        await store.upsertSearchIndex(
          ctx.apiResourceKind,
          mcpServer.metadata?.id ?? "",
          entry,
        );
      } catch (error) {
        logger.warn("IndexMcpServerAfterVisibilityUpdate: failed (best-effort)", {
          id: mcpServer.metadata?.id ?? "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

/** Get — LoadTarget by id, then the response-only oauth_status enrich. */
async function get(
  deps: McpServerControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<McpServer> {
  const reqCtx = new RequestContext(
    McpServerQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof McpServerQueryController.method.get.input>(
    "mcpserver-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, McpServerSchema))
    .addStep(newEnrichOAuthStatusStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as McpServer;
}

/** GetByReference — slug+org lookup, then the oauth_status enrich. */
async function getByReference(
  deps: McpServerControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<McpServer> {
  const reqCtx = new RequestContext(
    McpServerQueryController.method.getByReference.input,
    ref,
    kindOf(ctx),
  );
  await newPipeline<typeof McpServerQueryController.method.getByReference.input>(
    "mcpserver-get-by-reference",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, McpServerSchema))
    .addStep(newEnrichOAuthStatusStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);
  return reqCtx.get(TARGET_RESOURCE_KEY) as McpServer;
}
