/**
 * OAuthApp controller — ports pkg/domain/oauthapp (command + query sides).
 * OAuthApp is the outbound-auth registration with an external vendor:
 * client credentials plus the vendor's OAuth endpoints, referenced by
 * McpServer resources via McpServerAuth.oauth_app_ref. The outbound
 * counterpart to IdentityProvider (inbound auth).
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character.
 * Proven by oauthapp.conformance.test.ts (CONFORMANCE_TARGET=local)
 * and __tests__/oauthapp.test.ts.
 *
 * The secret contract: client_secret is AES-256-GCM encrypted at rest via
 * the SAME SecretService instance the Environment controller uses (Go
 * wires one service for both), and redacted to ***REDACTED*** on every
 * read surface; the marker round-trips on update/apply as "keep the stored
 * secret"; client-supplied enc:v<N>:-shaped values are refused on every
 * write door (oss#395). Deletion is blocked while an McpServer's
 * oauth_app_ref resolves to the app (stigmer/stigmer#584).
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies, and
 * Publish steps (no multi-tenant auth, IAM/FGA, or event publishing), and
 * OAuthApp is deliberately not search-indexed (a configuration resource;
 * `not_search_indexed` in the kind registry).
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type {
  ApiResourceDeleteInput,
  ApiResourceId,
  ApiResourceReference,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";
import { OAuthAppsSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/io_pb";
import type {
  ListOAuthAppsByOrgInput,
  OAuthApps,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/io_pb";
import { OAuthAppQueryController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/query_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import { internalError } from "../../pipeline/errors.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY, newLoadExistingStep } from "../../pipeline/steps/load-existing.js";
import { SHOULD_CREATE_KEY, newLoadForApplyStep } from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import { TARGET_RESOURCE_KEY, newLoadTargetStep } from "../../pipeline/steps/load-target.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import {
  newCheckNoReferencingMcpServersStep,
  newEncryptClientSecretForCreateStep,
  newEncryptClientSecretForUpdateStep,
  redactOAuthApp,
} from "./steps.js";

export interface OAuthAppControllerDeps {
  readonly store: Store;
  readonly secretService: SecretService;
  readonly logger: Logger;
}

/** Registers both OAuthApp services on the router (routes stage). */
export function registerOAuthAppServices(
  router: ConnectRouter,
  deps: OAuthAppControllerDeps,
): void {
  router.service(OAuthAppCommandController, {
    apply: (app, ctx) => apply(deps, app, ctx),
    create: (app, ctx) => createOAuthApp(deps, app, ctx),
    update: (app, ctx) => update(deps, app, ctx),
    delete: (input, ctx) => deleteOAuthApp(deps, input, ctx),
  });
  router.service(OAuthAppQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listByOrg: (req, ctx) => listByOrg(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline. ResolveSlug runs before
 * ValidateProto so clients can omit the slug; EncryptClientSecret runs
 * BEFORE BuildNewState because BuildNewState clones the current state —
 * the encrypted value must be in place before the clone. The response is
 * redacted after the pipeline (the persisted row keeps the ciphertext).
 */
async function createOAuthApp(
  deps: OAuthAppControllerDeps,
  app: OAuthApp,
  ctx: HandlerContext,
): Promise<OAuthApp> {
  const reqCtx = new RequestContext(OAuthAppSchema, app, kindOf(ctx));
  await newPipeline<typeof OAuthAppSchema>("oauthapp-create", deps.logger)
    .addStep(newResolveSlugStep())
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(newEncryptClientSecretForCreateStep(deps.secretService, deps.logger))
    .addStep(newBuildNewStateStep())
    .addStep(newPersistStep(deps.store))
    .build()
    .execute(reqCtx);
  const result = reqCtx.newState;
  redactOAuthApp(result);
  return result;
}

/**
 * Update — chain per Go buildUpdatePipeline. EncryptClientSecret runs
 * AFTER BuildUpdateState (which replaces newState with a fresh clone of
 * the input): it then either encrypts a new plaintext secret or restores
 * the stored ciphertext when the redaction marker is echoed back.
 */
async function update(
  deps: OAuthAppControllerDeps,
  app: OAuthApp,
  ctx: HandlerContext,
): Promise<OAuthApp> {
  const reqCtx = new RequestContext(OAuthAppSchema, app, kindOf(ctx));
  await newPipeline<typeof OAuthAppSchema>("oauthapp-update", deps.logger)
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newBuildUpdateStateStep())
    .addStep(newEncryptClientSecretForUpdateStep(deps.secretService, deps.logger))
    .addStep(newPersistStep(deps.store))
    .build()
    .execute(reqCtx);
  const result = reqCtx.newState;
  redactOAuthApp(result);
  return result;
}

/**
 * Apply — kubectl-style idempotent create-or-update: a minimal pipeline
 * decides existence, then delegates to Create or Update with the ORIGINAL
 * request message (Go delegates `app`, not the pipeline's mutated clone).
 */
async function apply(
  deps: OAuthAppControllerDeps,
  app: OAuthApp,
  ctx: HandlerContext,
): Promise<OAuthApp> {
  const reqCtx = new RequestContext(OAuthAppSchema, app, kindOf(ctx));
  await newPipeline<typeof OAuthAppSchema>("oauthapp-apply", deps.logger)
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
  return shouldCreate
    ? createOAuthApp(deps, app, ctx)
    : update(deps, app, ctx);
}

/**
 * Delete — chain per Go buildDeletePipeline: the referential guard runs
 * between load and delete. The RESOURCE_ID_KEY is set manually because
 * ApiResourceDeleteInput carries resourceId, not the value field
 * ExtractResourceId expects (the environment-domain pattern). Returns the
 * deleted resource for the audit trail — unredacted, exactly as Go does
 * (see redactOAuthApp's header for the disclosure).
 */
async function deleteOAuthApp(
  deps: OAuthAppControllerDeps,
  input: ApiResourceDeleteInput,
  ctx: HandlerContext,
): Promise<OAuthApp> {
  const reqCtx = new RequestContext(
    OAuthAppCommandController.method.delete.input,
    input,
    kindOf(ctx),
  );
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  await newPipeline<typeof OAuthAppCommandController.method.delete.input>(
    "oauthapp-delete",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, OAuthAppSchema))
    .addStep(newCheckNoReferencingMcpServersStep(deps.store, deps.logger))
    .addStep(newDeleteResourceStep(deps.store))
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted OAuthApp not found in context"),
      "deleted OAuthApp not found in context",
    );
  }
  return deleted as OAuthApp;
}

/** Get — LoadTarget by id, then redact (Go buildGetPipeline). */
async function get(
  deps: OAuthAppControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<OAuthApp> {
  const reqCtx = new RequestContext(
    OAuthAppQueryController.method.get.input,
    id,
    kindOf(ctx),
  );
  await newPipeline<typeof OAuthAppQueryController.method.get.input>(
    "oauthapp-get",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, OAuthAppSchema))
    .build()
    .execute(reqCtx);
  const app = reqCtx.get(TARGET_RESOURCE_KEY) as OAuthApp;
  redactOAuthApp(app);
  return app;
}

/** GetByReference — LoadByReference (org/slug), then redact. */
async function getByReference(
  deps: OAuthAppControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<OAuthApp> {
  const reqCtx = new RequestContext(
    OAuthAppQueryController.method.getByReference.input,
    ref,
    kindOf(ctx),
  );
  await newPipeline<typeof OAuthAppQueryController.method.getByReference.input>(
    "oauthapp-get-by-reference",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, OAuthAppSchema))
    .build()
    .execute(reqCtx);
  const app = reqCtx.get(TARGET_RESOURCE_KEY) as OAuthApp;
  redactOAuthApp(app);
  return app;
}

const LIST_RESULT_KEY = "listResult";

/**
 * ListByOrg — all OAuthApps whose metadata.org matches, each redacted,
 * sorted created_at descending (Go listByOrgStep). No pagination:
 * typically 1–5 per org. No authorization filtering in OSS.
 */
async function listByOrg(
  deps: OAuthAppControllerDeps,
  req: ListOAuthAppsByOrgInput,
  ctx: HandlerContext,
): Promise<OAuthApps> {
  const reqCtx = new RequestContext(
    OAuthAppQueryController.method.listByOrg.input,
    req,
    kindOf(ctx),
  );
  await newPipeline<typeof OAuthAppQueryController.method.listByOrg.input>(
    "oauthapp-list-by-org",
    deps.logger,
  )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const list = reqCtx.get(LIST_RESULT_KEY);
  if (list === undefined) {
    throw internalError(
      new Error("list result missing from pipeline context"),
      "OAuthApp list not found in context",
    );
  }
  return list as OAuthApps;
}

/** The domain-local list step: load all, filter by org, redact, sort. */
function newListByOrgStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof OAuthAppQueryController.method.listByOrg.input> {
  return {
    name: "ListByOrg",
    async execute(
      ctx: RequestContext<typeof OAuthAppQueryController.method.listByOrg.input>,
    ): Promise<void> {
      const org = ctx.input.org;

      let resources: Uint8Array[];
      try {
        resources = await store.listResources(ApiResourceKind.oauth_app);
      } catch (error) {
        throw internalError(error, "failed to list OAuthApps");
      }

      const apps: OAuthApp[] = [];
      for (const data of resources) {
        let app: OAuthApp;
        try {
          app = fromBinary(OAuthAppSchema, data);
        } catch (error) {
          logger.warn("failed to unmarshal OAuthApp, skipping", {
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        if ((app.metadata?.org ?? "") !== org) {
          continue;
        }
        redactOAuthApp(app);
        apps.push(app);
      }

      apps.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      logger.info("listed OAuthApps by organization", {
        org,
        matchCount: apps.length,
      });

      ctx.set(LIST_RESULT_KEY, create(OAuthAppsSchema, { entries: apps }));
    },
  };
}
