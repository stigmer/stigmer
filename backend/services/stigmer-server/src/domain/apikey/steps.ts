/**
 * ApiKey domain steps (O3, 20260827.06) — the three steps the canonical
 * chains do not provide, mirroring the cloud Java handlers' domain steps:
 *
 *   - GenerateApiKey (Java ApiKeyCreateHandler.GenerateApiKey): mints the
 *     plaintext AFTER BuildNewState, stores hash + fingerprint on the
 *     spec, and parks the plaintext under the context key for the
 *     response step. The client can never choose key material — whatever
 *     spec.key_hash/fingerprint the request carried is overwritten.
 *   - ReplaceHashWithPlainText (Java ApiKeyCreateHandler): AFTER Persist,
 *     swaps the plaintext into spec.key_hash of the RESPONSE only. This
 *     is the ONLY time the plaintext ever leaves the server; the store
 *     and audit rows hold the hash. The INTERNAL copy is byte-pinned to
 *     the Java step's.
 *   - PreserveKeyMaterial (O3 gate ruling Q9): update keeps spec.key_hash
 *     and spec.fingerprint from the STORED resource, so only the expiry
 *     fields are client-mutable. Ruling Q9's original impersonation
 *     rationale was corrected by stigmer-cloud#544's execution: the Java
 *     pipeline's computed-field clearing already strips both fields from
 *     every update request (forgery never persisted) — but nothing
 *     restored them, so every Java update persisted EMPTY key material
 *     and bricked the key. Both editions now strip-and-restore: this
 *     step here, ApiKeyUpdateHandler.PreserveKeyMaterial there. The
 *     shared contract is pinned by the apikey conformance suite's
 *     update-immutability arm.
 */
import { Code, ConnectError } from "@connectrpc/connect";

import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKeyHashSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";

import { internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import type { Store } from "../../store/interface.js";
import {
  fingerprintOf,
  generateApiKeyPlaintext,
  hashApiKey,
} from "./keymaterial.js";
import { findApiKeyByHash } from "./lookup.js";

/**
 * Context key parking the plaintext between GenerateApiKey and
 * ReplaceHashWithPlainText — the Java handler's API_KEY_PLAINTEXT
 * Context.Key, name kept verbatim.
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

/**
 * Swaps the plaintext into the response's spec.key_hash after Persist —
 * the store row keeps the hash; the client gets its one look. The
 * INTERNAL copy is the Java step's, byte-pinned.
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
 * Restores key material from the stored resource after BuildUpdateState —
 * expiry fields (expires_at, never_expires) remain the only client-mutable
 * spec surface (ruling Q9; the module header carries the security
 * rationale).
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
    },
  };
}

/**
 * Java ApiKeyGetByKeyHashHandler's NOT_FOUND copy — byte-pinned
 * cross-edition contract (no id in the message, deliberately: the input
 * IS the hash and echoing hashes into error copy invites log scraping).
 */
export const API_KEY_NOT_FOUND_BY_HASH_MESSAGE = "ApiKey not found";

/**
 * Loads the key whose spec.key_hash equals the input hash into the
 * TargetResource slot (Java ApiKeyGetByKeyHashHandler: the input is used
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
