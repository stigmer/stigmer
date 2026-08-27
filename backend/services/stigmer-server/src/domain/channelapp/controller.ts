/**
 * ChannelApp controller — ports pkg/domain/channelapp/controller (command +
 * query sides): the org-scoped holder of customer messaging-app credentials
 * (Slack OAuth client + signing secret; WhatsApp app_secret / access_token /
 * verify_token), referenced by AgentChannel spec.app_ref. The channel-domain
 * sibling of OAuthApp: inline encrypted secrets (AES-256-GCM via the shared
 * SecretService — the same instance Environment uses), ***REDACTED*** on
 * every response surface, delete blocked while referenced.
 *
 * Pipeline per RPC mirrors the Go step chains character-for-character —
 * notably create's ResolveSlug-before-ValidateProto order and the encrypt
 * step's placement (before BuildNewState on create, after BuildUpdateState
 * on update; see steps.ts). NOT search-indexed by design (the kind declares
 * not_search_indexed — configuration reached through its parent surface,
 * not a library artifact), so no index steps appear in any chain.
 *
 * Versus Stigmer Cloud, OSS excludes the Authorize, CreateIamPolicies, and
 * Publish steps (single-user local posture); validation, secret handling,
 * and the referential delete block are byte-compatible.
 *
 * Proven by channelapp.conformance.test.ts (CONFORMANCE_TARGET=local)
 * and __tests__/channelapp.test.ts.
 */
import type { ConnectRouter, HandlerContext } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";

import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { ChannelAppsSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/io_pb";
import type {
  ChannelApps,
  ListChannelAppsByOrgInput,
} from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/io_pb";
import type {
  ApiResourceDeleteInput,
  ApiResourceId,
  ApiResourceReference,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import type { SecretService } from "../../encryption/encryption.js";
import { apiResourceKindKey } from "../../pipeline/interceptors/apiresource.js";
import { internalError } from "../../pipeline/errors.js";
import { newPipeline } from "../../pipeline/pipeline.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { callerIdentityOf } from "../../pipeline/interceptors/auth.js";
import { RequestContext } from "../../pipeline/request-context.js";
import { newAuthorizeStep } from "../../pipeline/steps/authorize.js";
import { newBuildNewStateStep } from "../../pipeline/steps/defaults.js";
import { newBuildUpdateStateStep } from "../../pipeline/steps/build-update-state.js";
import { newCheckDuplicateStep } from "../../pipeline/steps/duplicate.js";
import {
  RESOURCE_ID_KEY,
  newDeleteResourceStep,
  newLoadExistingForDeleteStep,
} from "../../pipeline/steps/delete.js";
import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import {
  EXISTING_RESOURCE_KEY,
  newLoadExistingStep,
} from "../../pipeline/steps/load-existing.js";
import {
  SHOULD_CREATE_KEY,
  newLoadForApplyStep,
  withResolvedApplyId,
} from "../../pipeline/steps/load-for-apply.js";
import { newLoadByReferenceStep } from "../../pipeline/steps/load-by-reference.js";
import {
  TARGET_RESOURCE_KEY,
  newLoadTargetStep,
} from "../../pipeline/steps/load-target.js";
import {
  newCleanupIamPoliciesStep,
  newCreateAuthorizationTuplesStep,
} from "../../pipeline/steps/authorization-tuples.js";
import { newPersistStep } from "../../pipeline/steps/persist.js";
import { newResolveSlugStep } from "../../pipeline/steps/slug.js";
import { newValidateProtoStep } from "../../pipeline/steps/validation.js";
import { newValidateVisibilityStep } from "../../pipeline/steps/validate-visibility.js";
import type { Store } from "../../store/interface.js";
import {
  newCheckNoReferencingChannelsStep,
  newEncryptChannelAppSecretsForCreateStep,
  newEncryptChannelAppSecretsForUpdateStep,
  newValidateProviderImmutableStep,
  redactChannelApp,
} from "./steps.js";

export interface ChannelAppControllerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The composed authorization seam — the Authorize step at position 1 of every chain calls it (O2, DD-007 §3). */
  readonly authorizer: Authorizer;
  /** The composed tuple-lifecycle driver — undefined = the shared steps no-op (C2). */
  readonly authorizationLifecycle: ResourceAuthorizationLifecycle | undefined;
  readonly secretService: SecretService;
}

/** Registers both channelapp services on the router (routes stage). */
export function registerChannelAppServices(
  router: ConnectRouter,
  deps: ChannelAppControllerDeps,
): void {
  router.service(ChannelAppCommandController, {
    apply: (app, ctx) => apply(deps, app, ctx),
    create: (app, ctx) => createChannelApp(deps, app, ctx),
    update: (app, ctx) => update(deps, app, ctx),
    delete: (input, ctx) => deleteChannelApp(deps, input, ctx),
  });
  router.service(ChannelAppQueryController, {
    get: (id, ctx) => get(deps, id, ctx),
    getByReference: (ref, ctx) => getByReference(deps, ref, ctx),
    listByOrg: (req, ctx) => listByOrg(deps, req, ctx),
  });
}

function kindOf(ctx: HandlerContext): ApiResourceKind {
  return ctx.values.get(apiResourceKindKey);
}

/**
 * Create — chain per Go buildCreatePipeline. ResolveSlug runs BEFORE
 * ValidateProto (unique among the sharing/channel domains — Go's order,
 * preserved); EncryptChannelAppSecrets runs before BuildNewState because
 * BuildNewState clones state (the oauthapp ordering). The response is
 * redacted; the store keeps ciphertext.
 */
async function createChannelApp(
  deps: ChannelAppControllerDeps,
  app: ChannelApp,
  ctx: HandlerContext,
): Promise<ChannelApp> {
  const reqCtx = new RequestContext(
    ChannelAppSchema,
    app,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelAppSchema>("channelapp-create", deps.logger)
    .addStep(
      newAuthorizeStep(
        ChannelAppCommandController.method.create,
        deps.authorizer,
      ),
    )
    .addStep(newResolveSlugStep())
    .addStep(newValidateProtoStep())
    .addStep(newValidateVisibilityStep())
    .addStep(newCheckDuplicateStep(deps.store))
    .addStep(
      newEncryptChannelAppSecretsForCreateStep(deps.secretService, deps.logger),
    )
    .addStep(newBuildNewStateStep())
    .addStep(newPersistStep(deps.store))
    .addStep(
      newCreateAuthorizationTuplesStep(
        deps.authorizationLifecycle,
        deps.logger,
      ),
    )
    .build()
    .execute(reqCtx);
  redactChannelApp(reqCtx.newState);
  return reqCtx.newState;
}

/**
 * Update — chain per Go buildUpdatePipeline; EncryptChannelAppSecrets runs
 * AFTER BuildUpdateState because BuildUpdateState replaces newState with
 * the merged clone (the oauthapp ordering). The marker preserves the
 * stored value PER FIELD — one request may rotate one secret while
 * keeping the other.
 */
async function update(
  deps: ChannelAppControllerDeps,
  app: ChannelApp,
  ctx: HandlerContext,
): Promise<ChannelApp> {
  const reqCtx = new RequestContext(
    ChannelAppSchema,
    app,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelAppSchema>("channelapp-update", deps.logger)
    .addStep(
      newAuthorizeStep(
        ChannelAppCommandController.method.update,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newResolveSlugStep())
    .addStep(newLoadExistingStep(deps.store))
    .addStep(newValidateProviderImmutableStep())
    .addStep(newBuildUpdateStateStep())
    .addStep(
      newEncryptChannelAppSecretsForUpdateStep(deps.secretService, deps.logger),
    )
    .addStep(newPersistStep(deps.store))
    .build()
    .execute(reqCtx);
  redactChannelApp(reqCtx.newState);
  return reqCtx.newState;
}

/**
 * Apply — kubectl-style create-or-update (the OAuthApp apply shape): a
 * minimal probe pipeline decides existence, then delegates to Create or
 * Update with the ORIGINAL request message (Go delegates `app`, not the
 * pipeline's clone — unlike agentshare/agentchannel, whose defaults live
 * on the clone; channelapp's Update re-resolves the slug itself); the
 * update arm carries the resolved id via withResolvedApplyId. Sending
 * the marker for a secret field on an apply that resolves to update
 * preserves the stored value; on an apply that resolves to create it is
 * refused — there is nothing to preserve.
 */
async function apply(
  deps: ChannelAppControllerDeps,
  app: ChannelApp,
  ctx: HandlerContext,
): Promise<ChannelApp> {
  const reqCtx = new RequestContext(
    ChannelAppSchema,
    app,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelAppSchema>("channelapp-apply", deps.logger)
    .addStep(
      newAuthorizeStep(
        ChannelAppCommandController.method.apply,
        deps.authorizer,
      ),
    )
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
    ? createChannelApp(deps, app, ctx)
    : update(deps, withResolvedApplyId(ChannelAppSchema, app, reqCtx), ctx);
}

/**
 * Delete — blocked with FAILED_PRECONDITION while any AgentChannel
 * references this app via spec.app_ref. The deleted ChannelApp is returned
 * for audit purposes, redacted like every other response. The id is seeded
 * manually because ApiResourceDeleteInput carries resource_id, not the
 * `value` field ExtractResourceId expects (the oauthapp delete shape).
 */
async function deleteChannelApp(
  deps: ChannelAppControllerDeps,
  input: ApiResourceDeleteInput,
  ctx: HandlerContext,
): Promise<ChannelApp> {
  const reqCtx = new RequestContext(
    ChannelAppCommandController.method.delete.input,
    input,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  reqCtx.set(RESOURCE_ID_KEY, input.resourceId);
  await newPipeline<typeof ChannelAppCommandController.method.delete.input>(
    "channelapp-delete",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        ChannelAppCommandController.method.delete,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadExistingForDeleteStep(deps.store, ChannelAppSchema))
    .addStep(newCheckNoReferencingChannelsStep(deps.store, deps.logger))
    .addStep(newDeleteResourceStep(deps.store))
    .addStep(
      newCleanupIamPoliciesStep(deps.authorizationLifecycle, deps.logger),
    )
    .build()
    .execute(reqCtx);

  const deleted = reqCtx.get(EXISTING_RESOURCE_KEY);
  if (deleted === undefined) {
    throw internalError(
      new Error("deleted ChannelApp not found in context"),
      "deleted ChannelApp not found in context",
    );
  }
  const app = deleted as ChannelApp;
  redactChannelApp(app);
  return app;
}

/** Get — LoadTarget by id; the response is redacted. */
async function get(
  deps: ChannelAppControllerDeps,
  id: ApiResourceId,
  ctx: HandlerContext,
): Promise<ChannelApp> {
  const reqCtx = new RequestContext(
    ChannelAppQueryController.method.get.input,
    id,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelAppQueryController.method.get.input>(
    "channelapp-get",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(ChannelAppQueryController.method.get, deps.authorizer),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadTargetStep(deps.store, ChannelAppSchema))
    .build()
    .execute(reqCtx);
  const app = reqCtx.get(TARGET_RESOURCE_KEY) as ChannelApp;
  redactChannelApp(app);
  return app;
}

/** GetByReference — org/slug lookup; the response is redacted. */
async function getByReference(
  deps: ChannelAppControllerDeps,
  ref: ApiResourceReference,
  ctx: HandlerContext,
): Promise<ChannelApp> {
  const reqCtx = new RequestContext(
    ChannelAppQueryController.method.getByReference.input,
    ref,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<
    typeof ChannelAppQueryController.method.getByReference.input
  >("channelapp-get-by-reference", deps.logger)
    .addStep(
      newAuthorizeStep(
        ChannelAppQueryController.method.getByReference,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newLoadByReferenceStep(deps.store, ChannelAppSchema))
    .build()
    .execute(reqCtx);
  const app = reqCtx.get(TARGET_RESOURCE_KEY) as ChannelApp;
  redactChannelApp(app);
  return app;
}

const LIST_RESULT_KEY = "listResult";

/**
 * ListByOrg — all ChannelApps of an organization, newest-first, every
 * entry redacted. No pagination — the set is small by nature (typically
 * one app per provider per org), the OAuthApp listByOrg posture.
 */
async function listByOrg(
  deps: ChannelAppControllerDeps,
  req: ListChannelAppsByOrgInput,
  ctx: HandlerContext,
): Promise<ChannelApps> {
  const reqCtx = new RequestContext(
    ChannelAppQueryController.method.listByOrg.input,
    req,
    callerIdentityOf(ctx),
    kindOf(ctx),
  );
  await newPipeline<typeof ChannelAppQueryController.method.listByOrg.input>(
    "channelapp-list-by-org",
    deps.logger,
  )
    .addStep(
      newAuthorizeStep(
        ChannelAppQueryController.method.listByOrg,
        deps.authorizer,
      ),
    )
    .addStep(newValidateProtoStep())
    .addStep(newListByOrgStep(deps.store, deps.logger))
    .build()
    .execute(reqCtx);

  const result = reqCtx.get(LIST_RESULT_KEY);
  if (result === undefined) {
    throw internalError(
      new Error("ChannelApp list not found in context"),
      "ChannelApp list not found in context",
    );
  }
  return result as ChannelApps;
}

/**
 * ListByOrg — Go list_by_org.go's domain step: full scan, malformed rows
 * skipped with a warning, org equality filter, per-item redaction, sorted
 * by spec-audit created_at descending (seconds then nanos; timestamped
 * entries before untimestamped ones).
 */
function newListByOrgStep(
  store: Store,
  logger: Logger,
): PipelineStep<typeof ChannelAppQueryController.method.listByOrg.input> {
  return {
    name: "ListByOrg",
    async execute(
      ctx: RequestContext<
        typeof ChannelAppQueryController.method.listByOrg.input
      >,
    ): Promise<void> {
      const org = ctx.input.org;

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.channel_app);
      } catch (error) {
        throw internalError(error, "failed to list ChannelApps");
      }

      const apps: ChannelApp[] = [];
      for (const bytes of rows) {
        let app: ChannelApp;
        try {
          app = fromBinary(ChannelAppSchema, bytes);
        } catch {
          logger.warn("Failed to unmarshal ChannelApp, skipping");
          continue;
        }
        if ((app.metadata?.org ?? "") !== org) {
          continue;
        }
        redactChannelApp(app);
        apps.push(app);
      }

      apps.sort((a, b) =>
        compareCreatedAtDesc(
          a.status?.audit?.specAudit?.createdAt,
          b.status?.audit?.specAudit?.createdAt,
        ),
      );

      ctx.set(LIST_RESULT_KEY, create(ChannelAppsSchema, { entries: apps }));
    },
  };
}
