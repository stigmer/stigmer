/**
 * ApiKey domain steps — the steps the canonical chains do not provide:
 *
 *   - GenerateApiKey: mints the
 *     plaintext AFTER BuildNewState, stores hash + fingerprint on the
 *     spec, and parks the plaintext under the context key for the
 *     response step. The client can never choose key material — whatever
 *     spec.key_hash/fingerprint the request carried is overwritten.
 *   - ReplaceHashWithPlainText: AFTER Persist,
 *     swaps the plaintext into spec.key_hash of the RESPONSE only. This
 *     is the ONLY time the plaintext ever leaves the server; the store
 *     and audit rows hold the hash. The INTERNAL copy is byte-pinned
 *     (existing error copy is wire contract).
 *   - BindApiKeyOrganization: the organization a key is limited to
 *     (spec.bound_org). A credential limited to an organization creates only
 *     keys limited to an organization it reaches (its own, or one of its
 *     children; the binding's `admitsOrganization`), so a limited key or an
 *     app user can never mint a key that speaks for the person everywhere,
 *     nor one limited to a parent or a sibling: an empty spec.bound_org
 *     takes the caller's own organization, and any other it does not reach
 *     is refused. For every caller, a key is limited only to an organization
 *     its owner may view. API key create is a skip lane by annotation (any
 *     signed-in person may hold keys), so this step is the one place its
 *     organization is checked.
 *   - CheckDuplicate (the key's own, by name per owner): the shared step's
 *     check is per organization, which is not whose a key is.
 *   - PreserveKeyMaterial: update keeps spec.key_hash, spec.fingerprint
 *     and spec.bound_org from the STORED resource, so only the expiry fields are
 *     client-mutable (an update that cleared spec.bound_org would free a limited
 *     key of its organization). The point is not forgery alone: a
 *     pipeline that only stripped the computed fields from an update
 *     would persist EMPTY key material and brick the key. This
 *     step strips and restores, in every edition. The
 *     shared contract is pinned by the apikey conformance suite's
 *     update-immutability arm.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import type { ApiKey } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKeyHashSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/io_pb";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySpecSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/spec_pb";
import { IamPermission } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { create } from "@bufbuild/protobuf";

import { boundOrgOf } from "../../extensions/identity.js";
import type { Authorizer } from "../../extensions/authorizer.js";
import type { OrganizationAdmission } from "../../pipeline/steps/refuse-bound-elsewhere.js";
import { alreadyExistsError, internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { authorizeResolvedResource } from "../../pipeline/steps/authorize.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import type { Store } from "../../store/interface.js";
import {
  fingerprintOf,
  generateApiKeyPlaintext,
  hashApiKey,
} from "./keymaterial.js";
import { findApiKeyByHash } from "./lookup.js";
import { keysOwnedBy } from "./queries.js";

/**
 * Context key parking the plaintext between GenerateApiKey and
 * ReplaceHashWithPlainText.
 */
export const API_KEY_PLAINTEXT_KEY = "API_KEY_PLAINTEXT";

type ApiKeyDesc = typeof ApiKeySchema;

/** Mints the key material onto newState.spec; parks the plaintext. */
export function newGenerateApiKeyStep(): PipelineStep<ApiKeyDesc> {
  return {
    name: "GenerateApiKey",
    execute(ctx: RequestContext<ApiKeyDesc>): void {
      const resource: ApiKey = ctx.newState;
      if (resource.spec === undefined) {
        throw internalError(
          new Error("spec is nil after BuildNewState"),
          "generate api key",
        );
      }
      const plaintext = generateApiKeyPlaintext();
      resource.spec.keyHash = hashApiKey(plaintext);
      resource.spec.fingerprint = fingerprintOf(plaintext);
      ctx.set(API_KEY_PLAINTEXT_KEY, plaintext);
    },
  };
}

/** A limited credential asked for a key limited where it does not reach. */
export const API_KEY_BOUND_ELSEWHERE_MESSAGE =
  "this credential is limited to one organization, so it can only create API keys limited to that organization or one of its child organizations";

/** The key's organization is one its owner may not view (or does not exist for them). */
export const API_KEY_ORGANIZATION_NOT_VISIBLE_MESSAGE =
  "an API key can only be limited to an organization you can view";

/**
 * Settles the organization the new key is limited to (the module header):
 * a limited caller's own when empty, one it reaches when set; then,
 * when the key is limited, the owner's `can_view` on that organization
 * through the composed Authorizer. Runs after BuildNewState, on the state
 * that is persisted; spec.bound_org has already been resolved from a slug to the
 * organization's id by the name resolver at the edge.
 */
export function newBindApiKeyOrganizationStep(
  authorizer: Authorizer,
  binding: OrganizationAdmission,
): PipelineStep<ApiKeyDesc> {
  return {
    name: "BindApiKeyOrganization",
    async execute(ctx: RequestContext<ApiKeyDesc>): Promise<void> {
      const resource: ApiKey = ctx.newState;
      resource.spec ??= create(ApiKeySpecSchema);
      const bound = boundOrgOf(ctx.callerIdentity);
      if (bound !== undefined) {
        if (resource.spec.boundOrg === "") {
          resource.spec.boundOrg = bound;
        } else if (
          !(await binding.admitsOrganization(
            ctx.callerIdentity,
            resource.spec.boundOrg,
          ))
        ) {
          throw new ConnectError(
            API_KEY_BOUND_ELSEWHERE_MESSAGE,
            Code.PermissionDenied,
          );
        }
      }
      if (resource.spec.boundOrg === "") {
        return;
      }
      await authorizeResolvedResource(
        authorizer,
        ctx.callerIdentity,
        {
          permission: IamPermission.can_view,
          resourceKind: ApiResourceKind.organization,
          resourceId: resource.spec.boundOrg,
        },
        API_KEY_ORGANIZATION_NOT_VISIBLE_MESSAGE,
      ).catch((error: unknown) => {
        // A missing organization answers like one the owner may not view,
        // so a key's create never tells which organization ids exist.
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          throw new ConnectError(
            API_KEY_ORGANIZATION_NOT_VISIBLE_MESSAGE,
            Code.PermissionDenied,
          );
        }
        throw error;
      });
    },
  };
}

/**
 * CheckDuplicate for a key: a name is unique among the keys of one owner,
 * the account the key will speak for (`owner`, read before BuildNewState
 * stamps it). The shared step's check is per `metadata.org`, which says
 * nothing about whose a key is: two people of one organization could not
 * both name a key "ci", a key created naming no organization was checked
 * against every key on the server, and the refusal named the other
 * person's key id (stigmer/stigmer#2111).
 */
export function newCheckDuplicateKeyNameStep(
  store: Store,
  ownerOf: (ctx: RequestContext<ApiKeyDesc>) => string,
): PipelineStep<ApiKeyDesc> {
  return {
    name: "CheckDuplicate",
    async execute(ctx: RequestContext<ApiKeyDesc>): Promise<void> {
      const slug = ctx.newState.metadata?.slug ?? "";
      if (slug === "") {
        throw internalError(new Error("resource slug is empty"), "duplicate check");
      }
      let owned: ApiKey[];
      try {
        owned = await keysOwnedBy(store, [ownerOf(ctx)]);
      } catch (error) {
        throw internalError(error, "failed to check for duplicates");
      }
      if (owned.some((key) => (key.metadata?.slug ?? "") === slug)) {
        throw alreadyExistsError("ApiKey", `slug '${slug}'`);
      }
    },
  };
}

/**
 * Swaps the plaintext into the response's spec.key_hash after Persist —
 * the store row keeps the hash; the client gets its one look. The
 * INTERNAL copy is byte-pinned (existing error copy is wire contract).
 */
export function newReplaceHashWithPlainTextStep(): PipelineStep<ApiKeyDesc> {
  return {
    name: "ReplaceHashWithPlainText",
    execute(ctx: RequestContext<ApiKeyDesc>): void {
      const plaintext = ctx.get(API_KEY_PLAINTEXT_KEY);
      if (typeof plaintext !== "string" || plaintext === "") {
        throw internalError(
          new Error("plaintext API key not found in context"),
          "Failed to retrieve generated API key",
        );
      }
      const resource: ApiKey = ctx.newState;
      if (resource.spec === undefined) {
        throw internalError(
          new Error("spec is nil after Persist"),
          "replace hash with plaintext",
        );
      }
      resource.spec.keyHash = plaintext;
    },
  };
}

/**
 * Restores key material and the key's organization from the stored
 * resource after BuildUpdateState — expiry fields (expires_at,
 * never_expires) remain the only client-mutable spec surface (the module
 * header carries the reason).
 */
export function newPreserveKeyMaterialStep(): PipelineStep<ApiKeyDesc> {
  return {
    name: "PreserveKeyMaterial",
    execute(ctx: RequestContext<ApiKeyDesc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as ApiKey | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing resource not in context - LoadExisting must run first"),
          "preserve key material",
        );
      }
      const resource: ApiKey = ctx.newState;
      if (resource.spec === undefined || existing.spec === undefined) {
        throw internalError(
          new Error("spec is nil on update"),
          "preserve key material",
        );
      }
      resource.spec.keyHash = existing.spec.keyHash;
      resource.spec.fingerprint = existing.spec.fingerprint;
      resource.spec.boundOrg = existing.spec.boundOrg;
    },
  };
}

/**
 * GetByKeyHash's NOT_FOUND copy — byte-pinned
 * cross-edition contract (no id in the message, deliberately: the input
 * IS the hash and echoing hashes into error copy invites log scraping).
 */
export const API_KEY_NOT_FOUND_BY_HASH_MESSAGE = "ApiKey not found";

/**
 * Loads the key whose spec.key_hash equals the input hash into the
 * TargetResource slot (the input is used
 * as-is — already hashed — and the stored resource returns unmodified,
 * hash in place; the secret is only ever visible in the create response).
 */
export function newLoadByKeyHashStep(
  store: Store,
): PipelineStep<typeof ApiKeyHashSchema> {
  return {
    name: "LoadByKeyHash",
    async execute(ctx: RequestContext<typeof ApiKeyHashSchema>): Promise<void> {
      const found = await findApiKeyByHash(store, ctx.input.value);
      if (found === undefined) {
        throw new ConnectError(API_KEY_NOT_FOUND_BY_HASH_MESSAGE, Code.NotFound);
      }
      ctx.set(TARGET_RESOURCE_KEY, found);
    },
  };
}
