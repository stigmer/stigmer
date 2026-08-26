/**
 * Runtime environment resolution — ports
 * pkg/domain/environment/resolution/runtime_resolution.go, the OSS twin of
 * the cloud edition's EnvironmentRuntimeResolutionService.
 *
 * Runtime resolution and human reveal are two DISTINCT operations: the
 * environment RPC surface redacts secret values in every response
 * (oss#405, getSecretValue being the single-key reveal path), while an
 * execution needs the full map decrypted. This service is the sanctioned
 * internal path for the latter. It deliberately does not ride the gRPC
 * surface: the RPC responses are redacted by design, and this single-user
 * edition has no caller identity that could gate an "unredacted" RPC.
 *
 * Called cross-domain by the execution-context builders (the
 * agentexecution and workflowexecution sub-projects, D4 #15/#17/#20) — a
 * deliberate, documented boundary crossing in the style of the cloud
 * edition's EnvironmentMergeService dependency. OSS omits the cloud's
 * OrgSharedEnvironmentPolicy gate: single-user, no trust boundary.
 *
 * Returned values are PLAINTEXT, for execution-context builds only. Never
 * surface them in an API response, log, or error message.
 */
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../../boot/logger.js";
import { EncryptionDisabledError } from "../../../encryption/encryption.js";
import type { SecretService } from "../../../encryption/encryption.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../../pipeline/errors.js";
import {
  findResourceBySlug,
  requireOrgForReference,
} from "../../../pipeline/steps/helpers.js";
import { apiResourceKindName } from "../../../store/sqlite/proto-fields.js";
import type { Store } from "../../../store/interface.js";

/**
 * Resolves environments with secret values decrypted, for merging into an
 * ExecutionContext.
 */
export class RuntimeResolutionService {
  constructor(
    private readonly store: Store,
    private readonly secretService: SecretService,
    private readonly logger: Logger,
  ) {}

  /**
   * Go ResolveByReference: loads the referenced environment and decrypts
   * its is_secret values in place on the freshly-loaded copy (the store is
   * never touched). Lookup semantics match the getByReference RPC exactly
   * — same slug+org matching and the same org requirement for this
   * org-scoped kind — so a ref that resolves through the RPC surface
   * resolves identically here, and vice versa.
   *
   * Error doctrine (the cloud service's, in this edition's taxonomy):
   *   - Undecryptable ciphertext (tampered/truncated/wrong-key) is scoped
   *     to one value: WARN and drop that key (the cloud's per-key skip).
   *   - EncryptionDisabledError propagates: the stored ciphertext may be
   *     perfectly valid (key file lost), and skipping it would start the
   *     execution silently missing a credential — a confusing downstream
   *     failure instead of a clear one here.
   *   - An unresolvable reference is NotFound, same as the RPC path — the
   *     execution-context builders treat that as an authoring error that
   *     fails the create (never a silent run without credentials).
   */
  async resolveByReference(
    ref: ApiResourceReference | undefined,
  ): Promise<Environment> {
    if (ref === undefined || ref.slug === "") {
      throw invalidArgumentError("environment reference with slug is required");
    }
    if (
      ref.kind !== ApiResourceKind.api_resource_kind_unknown &&
      ref.kind !== ApiResourceKind.environment
    ) {
      throw invalidArgumentError(
        `kind mismatch: expected environment, got ${apiResourceKindName(ref.kind)}`,
      );
    }
    requireOrgForReference(ApiResourceKind.environment, ref.org);

    let env: Environment | undefined;
    try {
      env = await findResourceBySlug(
        this.store,
        ApiResourceKind.environment,
        EnvironmentSchema,
        ref.slug,
        ref.org,
      );
    } catch (error) {
      throw internalError(
        error,
        "failed to look up environment for runtime resolution",
      );
    }
    if (env === undefined) {
      throw notFoundError("environment", ref.slug);
    }

    this.decryptSecretValues(env);
    return env;
  }

  /**
   * Decrypts every encrypted is_secret value in place. Plaintext legacy
   * rows pass through decrypt unchanged, so pre-oss#405 stores resolve
   * without migration.
   */
  private decryptSecretValues(env: Environment): void {
    const data = env.spec?.data;
    if (data === undefined || Object.keys(data).length === 0) {
      return;
    }

    const environmentId = env.metadata?.id ?? "";
    for (const [key, value] of Object.entries(data)) {
      if (!value.isSecret || !this.secretService.isEncrypted(value.value)) {
        continue;
      }

      try {
        value.value = this.secretService.decrypt(value.value);
      } catch (error) {
        if (error instanceof EncryptionDisabledError) {
          throw internalError(
            error,
            `environment ${environmentId} holds encrypted secret '${key}' but no encryption key is configured`,
          );
        }
        this.logger.warn(
          "Undecryptable ciphertext in environment — dropping this value from runtime resolution",
          {
            key,
            environmentId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
        delete data[key];
      }
    }
  }
}
