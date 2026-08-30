/**
 * OAuthApp domain-local pipeline steps — port
 * pkg/domain/oauthapp/controller/steps: the client-secret encrypt/preserve
 * step, the referential delete guard, and the response redaction helper.
 * Proven by oauthapp.conformance.test.ts and __tests__/oauthapp.test.ts.
 */
import { fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import { isCiphertextShaped } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import { EncryptionScope } from "../../encryption/encryption.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import {
  CIPHERTEXT_SHAPED_SECRET_MESSAGE,
  MARKER_ON_CREATE_MESSAGE,
  PRESERVE_NO_EXISTING_SECRET_MESSAGE,
  REDACTED_MARKER,
  deleteBlockedByMcpServerMessage,
} from "./constants.js";
import { resolveOAuthAppRef } from "./refresolution/refresolution.js";

/**
 * Replaces client_secret with the redaction marker (Go RedactOAuthApp).
 *
 * A function rather than a pipeline step because redaction applies at
 * different points per operation: create/update after persist on newState;
 * get/getByReference after load on the target; listByOrg per entry. Go's
 * response list deliberately excludes DELETE — the delete RPC returns the
 * STORED resource with its encrypted secret intact, ported byte-faithfully
 * and disclosed in the PR (a cross-edition follow-up candidate: with
 * encryption disabled the stored value is plaintext).
 */
export function redactOAuthApp(app: OAuthApp): void {
  if (app.spec !== undefined && app.spec.clientSecret !== "") {
    app.spec.clientSecret = REDACTED_MARKER;
  }
}

/**
 * EncryptClientSecret for the create pipeline (Go
 * NewEncryptClientSecretForCreateStep): encrypts the plaintext secret;
 * rejects the redaction marker — there is no existing secret to preserve.
 */
export function newEncryptClientSecretForCreateStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof OAuthAppSchema> {
  return newEncryptClientSecretStep(secretService, logger, true);
}

/**
 * EncryptClientSecret for the update pipeline (Go
 * NewEncryptClientSecretForUpdateStep): the redaction marker restores the
 * stored encrypted value from ExistingResource; a new plaintext value is
 * encrypted.
 */
export function newEncryptClientSecretForUpdateStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof OAuthAppSchema> {
  return newEncryptClientSecretStep(secretService, logger, false);
}

/**
 * The shared encrypt/preserve mechanics. On both arms a ciphertext-shaped
 * (enc:v<N>:) client value is rejected UNCONDITIONALLY — not gated on
 * isEnabled: the prefix is server-reserved regardless of key state, and a
 * keyless deployment that later gains a key must not wake up holding
 * smuggled "ciphertext" (oss#395). The marker arm stays FIRST — it
 * restores stored ciphertext, which is legitimate and returns before the
 * shape check.
 */
function newEncryptClientSecretStep(
  secretService: SecretService,
  logger: Logger,
  isCreate: boolean,
): PipelineStep<typeof OAuthAppSchema> {
  return {
    name: "EncryptClientSecret",
    async execute(ctx: RequestContext<typeof OAuthAppSchema>): Promise<void> {
      const app = ctx.newState;
      if (app.spec === undefined) {
        return;
      }
      const clientSecret = app.spec.clientSecret;
      if (clientSecret === "") {
        return;
      }

      if (clientSecret === REDACTED_MARKER) {
        preserveExistingSecret(ctx, app, isCreate, logger);
        return;
      }

      if (isCiphertextShaped(clientSecret)) {
        throw invalidArgumentError(CIPHERTEXT_SHAPED_SECRET_MESSAGE);
      }

      if (!secretService.isEnabled()) {
        logger.warn(
          "encryption disabled: client_secret will be stored in plaintext",
        );
        return;
      }

      try {
        // Tenancy-only scope, the pre-v3 write posture: oauthapp is an
        // org-scoped kind, so metadata.org is validated non-empty before
        // this step.
        app.spec.clientSecret = await secretService.encrypt(
          clientSecret,
          EncryptionScope.forOrganization(app.metadata?.org ?? ""),
        );
      } catch (error) {
        throw internalError(error, "failed to encrypt client_secret");
      }
    },
  };
}

/** Go preserveExistingSecret: copy the stored ciphertext on marker echo. */
function preserveExistingSecret(
  ctx: RequestContext<typeof OAuthAppSchema>,
  app: OAuthApp,
  isCreate: boolean,
  logger: Logger,
): void {
  if (isCreate) {
    throw invalidArgumentError(MARKER_ON_CREATE_MESSAGE);
  }

  const existing = ctx.get(EXISTING_RESOURCE_KEY) as OAuthApp | undefined;
  if (existing === undefined) {
    throw internalError(
      new Error("existing resource not loaded"),
      "cannot preserve client_secret: existing resource not loaded",
    );
  }

  const existingSecret = existing.spec?.clientSecret ?? "";
  if (existingSecret === "") {
    throw invalidArgumentError(PRESERVE_NO_EXISTING_SECRET_MESSAGE);
  }

  if (app.spec !== undefined) {
    app.spec.clientSecret = existingSecret;
  }

  logger.debug("preserved existing encrypted client_secret", {
    oauthAppId: app.metadata?.id ?? "",
  });
}

/**
 * CheckNoReferencingMcpServers (Go newCheckNoReferencingMcpServersStep):
 * blocks deletion while any McpServer's spec.auth.oauth_app_ref RESOLVES
 * to the app being deleted — resolution semantics through the shared
 * refresolution, not literal field match (stigmer/stigmer#584). A ref
 * pinned to another org can reach this app through the unique-slug
 * fallback (deleting would sever a live vendor-OAuth connection), while a
 * literal match whose resolution lands elsewhere must not block.
 *
 * Requires LoadExistingForDelete to have run first (the OAuthApp being
 * deleted is read from ExistingResource). Generic over the delete input
 * Desc, like the shared delete steps.
 */
export function newCheckNoReferencingMcpServersStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CheckNoReferencingMcpServers",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as OAuthApp | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing OAuthApp missing from pipeline context"),
          "existing OAuthApp not loaded in delete pipeline",
        );
      }

      let resources: Uint8Array[];
      try {
        resources = await store.listResources(ApiResourceKind.mcp_server);
      } catch (error) {
        throw internalError(
          error,
          "failed to list MCP servers for referential integrity check",
        );
      }

      for (const data of resources) {
        let mcp: McpServer;
        try {
          mcp = fromBinary(McpServerSchema, data);
        } catch (error) {
          logger.warn(
            "failed to unmarshal MCP server during referential integrity check, skipping",
            { error: error instanceof Error ? error.message : String(error) },
          );
          continue;
        }

        const ref = mcp.spec?.auth?.oauthAppRef;
        if (ref === undefined) {
          continue;
        }

        let resolved: OAuthApp | undefined;
        try {
          resolved = await resolveOAuthAppRef(store, ref, logger);
        } catch (error) {
          throw internalError(
            error,
            "failed to resolve oauth_app_ref during referential integrity check",
          );
        }
        if (
          resolved !== undefined &&
          (resolved.metadata?.id ?? "") === (existing.metadata?.id ?? "")
        ) {
          throw failedPreconditionError(
            deleteBlockedByMcpServerMessage(
              existing.metadata?.org ?? "",
              existing.metadata?.slug ?? "",
              mcp.metadata?.name ?? "",
            ),
          );
        }
      }
    },
  };
}
