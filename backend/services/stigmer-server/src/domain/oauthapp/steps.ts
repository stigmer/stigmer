/**
 * OAuthApp domain-local pipeline steps — port
 * pkg/domain/oauthapp/controller/steps: the client-secret encrypt/preserve
 * step, the login endpoint check and the response redaction helper.
 * Proven by oauthapp.conformance.test.ts and __tests__/oauthapp.test.ts.
 */

import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import { isCiphertextShaped } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import { EncryptionScope } from "../../encryption/encryption.js";
import {
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { loginEndpointProblem } from "../vault/sign-in/endpoint.js";
import {
  CIPHERTEXT_SHAPED_SECRET_MESSAGE,
  MARKER_ON_CREATE_MESSAGE,
  PRESERVE_NO_EXISTING_SECRET_MESSAGE,
  REDACTED_MARKER,
} from "./constants.js";

/**
 * Refuses an app whose authorization, token or user-info URL breaks the
 * login endpoint rule (https, or http on the loopback interface), naming the
 * field and never the value: the console sends a person's browser to the
 * authorization URL, so a script URL there would run in the console's
 * origin, and the other two receive a code, a secret or a token.
 */
export function newCheckLoginEndpointsStep(): PipelineStep<typeof OAuthAppSchema> {
  return {
    name: "CheckLoginEndpoints",
    execute(ctx: RequestContext<typeof OAuthAppSchema>): void {
      const spec = ctx.newState.spec;
      for (const [field, value] of [
        ["authorization_url", spec?.authorizationUrl ?? ""],
        ["token_url", spec?.tokenUrl ?? ""],
        ["userinfo_url", spec?.userinfoUrl ?? ""],
      ] as const) {
        const problem = value === "" ? undefined : loginEndpointProblem(value);
        if (problem !== undefined) {
          throw invalidArgumentError(`spec.${field} ${problem}`);
        }
      }
    },
  };
}

/**
 * Replaces client_secret with the redaction marker (Go RedactOAuthApp).
 *
 * A function rather than a pipeline step because redaction applies at
 * different points per operation: create/update after persist on newState;
 * get/getByReference after load on the target; listByOrg per entry; delete
 * on the removed row after its chain. Every response is redacted, the
 * delete's included: the Go port returned the stored secret from delete —
 * ciphertext, or plaintext on a keyless server — which no reader needs
 * once the chain has destroyed the sealed value (stigmer/stigmer#1257).
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
