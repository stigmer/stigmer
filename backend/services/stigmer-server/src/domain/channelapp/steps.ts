/**
 * ChannelApp domain steps — ports pkg/domain/channelapp/controller/steps.go:
 * per-field secret encryption/preservation over the provider oneof, the
 * response-side redaction, provider-arm immutability, and the referential
 * delete block against AgentChannels.
 *
 * The marker/ciphertext-guard logic is DELIBERATELY domain-local (not
 * shared with environment or oauthapp): Go keeps each domain's steps in its
 * own package, and the three shapes genuinely differ (environment: a
 * variable map; here: provider-oneof fields; oauthapp: one field). The
 * ratified promotion rule requires an identical second consumer — recorded
 * in the sub-project plan so review does not re-litigate.
 *
 * Proven by channelapp.conformance.test.ts (CONFORMANCE_TARGET=local-ts)
 * and __tests__/channelapp.test.ts.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import type {
  SlackChannelAppConfig,
  WhatsAppChannelAppConfig,
} from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { SecretService } from "../../encryption/encryption.js";
import { isCiphertextShaped } from "../../encryption/encryption.js";
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
  PROVIDER_IMMUTABLE_MESSAGE,
  REDACTED_MARKER,
  deleteBlockedByChannelMessage,
  markerOnCreateMessage,
  noExistingSecretMessage,
  plaintextRequiredMessage,
} from "./constants.js";

type ChannelAppDesc = typeof ChannelAppSchema;
type DeleteInputDesc = typeof ChannelAppCommandController.method.delete.input;

/**
 * Replaces every non-empty secret field with the marker on the given app —
 * used in ALL API responses (get, getByReference, create, update, delete,
 * listByOrg), Go RedactChannelApp.
 *
 * Every provider arm must be handled here. The provider-arm tripwire test
 * (__tests__/channelapp.test.ts) fails if an arm is added to the spec
 * oneof without redaction coverage.
 */
export function redactChannelApp(app: ChannelApp): void {
  const provider = app.spec?.providerConfig;
  switch (provider?.case) {
    case "slack":
      redactSlack(provider.value);
      return;
    case "whatsapp":
      redactWhatsApp(provider.value);
      return;
    case undefined:
      return;
    default: {
      const exhaustive: never = provider;
      throw new Error(`unhandled provider arm: ${String(exhaustive)}`);
    }
  }
}

function redactSlack(slack: SlackChannelAppConfig): void {
  if (slack.clientSecret !== "") {
    slack.clientSecret = REDACTED_MARKER;
  }
  if (slack.signingSecret !== "") {
    slack.signingSecret = REDACTED_MARKER;
  }
}

/** app_id is public and stays — only the three secret fields redact. */
function redactWhatsApp(whatsapp: WhatsAppChannelAppConfig): void {
  if (whatsapp.appSecret !== "") {
    whatsapp.appSecret = REDACTED_MARKER;
  }
  if (whatsapp.accessToken !== "") {
    whatsapp.accessToken = REDACTED_MARKER;
  }
  if (whatsapp.verifyToken !== "") {
    whatsapp.verifyToken = REDACTED_MARKER;
  }
}

/**
 * EncryptChannelAppSecrets — Go encryptChannelAppSecretsStep: the oauthapp
 * encryptClientSecretStep generalized to a provider oneof carrying
 * multiple secrets (Slack: client_secret and signing_secret; WhatsApp:
 * app_secret, access_token and verify_token).
 *
 * Each field is handled independently, per field:
 *   - Create: encrypts the plaintext value; the redaction marker is
 *     refused (nothing to preserve).
 *   - Update with a new value: encrypts the new plaintext.
 *   - Update with the marker: preserves the existing encrypted value from
 *     the loaded resource. Independence matters: one request may rotate
 *     one secret while keeping the other.
 *   - A ciphertext-shaped (enc:v<N>:) value is refused on both create and
 *     update (oss#395).
 *
 * Ordering is load-bearing (Go's pipeline comments): on CREATE this runs
 * BEFORE BuildNewState (which clones state — the encrypted values must be
 * in place before the clone); on UPDATE it runs AFTER BuildUpdateState
 * (which replaces newState with the merged clone).
 */
export function newEncryptChannelAppSecretsForCreateStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<ChannelAppDesc> {
  return newEncryptChannelAppSecretsStep(secretService, logger, true);
}

export function newEncryptChannelAppSecretsForUpdateStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<ChannelAppDesc> {
  return newEncryptChannelAppSecretsStep(secretService, logger, false);
}

function newEncryptChannelAppSecretsStep(
  secretService: SecretService,
  logger: Logger,
  isCreate: boolean,
): PipelineStep<ChannelAppDesc> {
  /**
   * Computes the storage-ready value for one secret field.
   *
   * Arm order is load-bearing: the marker arm restores STORED ciphertext
   * and returns before the ciphertext-shape rejection, which therefore
   * only ever sees raw client input (oss#395).
   */
  function resolveSecret(
    ctx: RequestContext<ChannelAppDesc>,
    fieldName: string,
    requestValue: string,
    readExisting: (existing: ChannelApp) => string,
  ): string {
    if (requestValue === "") {
      return requestValue;
    }

    if (requestValue === REDACTED_MARKER) {
      return preserveExistingSecret(ctx, fieldName, readExisting);
    }

    // Unconditional (not gated on isEnabled): the enc:v<N>: prefix is
    // server-reserved regardless of key state.
    if (isCiphertextShaped(requestValue)) {
      throw invalidArgumentError(plaintextRequiredMessage(fieldName));
    }

    if (!secretService.isEnabled()) {
      logger.warn(`Encryption disabled: ${fieldName} will be stored in plaintext`);
      return requestValue;
    }

    try {
      return secretService.encrypt(requestValue);
    } catch (error) {
      throw internalError(error, `failed to encrypt ${fieldName}`);
    }
  }

  /** Copies the stored encrypted value when the client sends the marker. */
  function preserveExistingSecret(
    ctx: RequestContext<ChannelAppDesc>,
    fieldName: string,
    readExisting: (existing: ChannelApp) => string,
  ): string {
    if (isCreate) {
      throw invalidArgumentError(markerOnCreateMessage(fieldName));
    }

    const existing = ctx.get(EXISTING_RESOURCE_KEY) as ChannelApp | undefined;
    if (existing === undefined) {
      throw internalError(
        new Error("existing resource not loaded"),
        `cannot preserve ${fieldName}: existing resource not loaded`,
      );
    }

    const existingSecret = readExisting(existing);
    if (existingSecret === "") {
      throw invalidArgumentError(noExistingSecretMessage(fieldName));
    }
    return existingSecret;
  }

  return {
    name: "EncryptChannelAppSecrets",
    execute(ctx: RequestContext<ChannelAppDesc>): void {
      const provider = ctx.newState.spec?.providerConfig;
      switch (provider?.case) {
        case "slack": {
          const slack = provider.value;
          slack.clientSecret = resolveSecret(
            ctx,
            "client_secret",
            slack.clientSecret,
            (existing) =>
              existing.spec?.providerConfig.case === "slack"
                ? existing.spec.providerConfig.value.clientSecret
                : "",
          );
          slack.signingSecret = resolveSecret(
            ctx,
            "signing_secret",
            slack.signingSecret,
            (existing) =>
              existing.spec?.providerConfig.case === "slack"
                ? existing.spec.providerConfig.value.signingSecret
                : "",
          );
          return;
        }
        case "whatsapp": {
          const whatsapp = provider.value;
          whatsapp.appSecret = resolveSecret(
            ctx,
            "app_secret",
            whatsapp.appSecret,
            (existing) =>
              existing.spec?.providerConfig.case === "whatsapp"
                ? existing.spec.providerConfig.value.appSecret
                : "",
          );
          whatsapp.accessToken = resolveSecret(
            ctx,
            "access_token",
            whatsapp.accessToken,
            (existing) =>
              existing.spec?.providerConfig.case === "whatsapp"
                ? existing.spec.providerConfig.value.accessToken
                : "",
          );
          whatsapp.verifyToken = resolveSecret(
            ctx,
            "verify_token",
            whatsapp.verifyToken,
            (existing) =>
              existing.spec?.providerConfig.case === "whatsapp"
                ? existing.spec.providerConfig.value.verifyToken
                : "",
          );
          return;
        }
        case undefined:
          return;
        default: {
          const exhaustive: never = provider;
          throw new Error(`unhandled provider arm: ${String(exhaustive)}`);
        }
      }
    },
  };
}

/**
 * ValidateProviderImmutable — Go validateProviderImmutableStep: a slack
 * app cannot become a whatsapp app — every referencing channel's install
 * state and the webhook verification path are provider-shaped. Compares
 * the INPUT's oneof arm against the loaded resource's (Go WhichOneof over
 * provider_config); runs after LoadExisting. InvalidArgument by pinned
 * contract (see constants.ts on the cross-domain inconsistency).
 */
export function newValidateProviderImmutableStep(): PipelineStep<ChannelAppDesc> {
  return {
    name: "ValidateProviderImmutable",
    execute(ctx: RequestContext<ChannelAppDesc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as ChannelApp | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing channel app not found in context"),
          "existing channel app not found in context",
        );
      }

      const existingCase = existing.spec?.providerConfig.case;
      const inputCase = ctx.input.spec?.providerConfig.case;
      if (existingCase !== inputCase) {
        throw invalidArgumentError(PROVIDER_IMMUTABLE_MESSAGE);
      }
    },
  };
}

/**
 * CheckNoReferencingChannels — Go checkNoReferencingChannelsStep: prevents
 * deletion of a ChannelApp still referenced by any AgentChannel via
 * spec.app_ref — a deleted app would break the referencing channels'
 * webhook verification and any future re-install (the oauthapp
 * checkNoReferencingMcpServers precedent). Full scan through the store
 * (the OSS lookup posture); malformed rows are skipped with a warning.
 *
 * Requires LoadExistingForDelete to have run first.
 */
export function newCheckNoReferencingChannelsStep(
  store: Store,
  logger: Logger,
): PipelineStep<DeleteInputDesc> {
  return {
    name: "CheckNoReferencingChannels",
    async execute(ctx: RequestContext<DeleteInputDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as ChannelApp | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing ChannelApp not loaded in delete pipeline"),
          "existing ChannelApp not loaded in delete pipeline",
        );
      }

      const org = existing.metadata?.org ?? "";
      const slug = existing.metadata?.slug ?? "";

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent_channel);
      } catch (error) {
        throw internalError(
          error,
          "failed to list agent channels for referential integrity check",
        );
      }

      for (const bytes of rows) {
        let channel;
        try {
          channel = fromBinary(AgentChannelSchema, bytes);
        } catch {
          logger.warn(
            "Failed to unmarshal agent channel during referential integrity check, skipping",
          );
          continue;
        }

        const ref = channel.spec?.appRef;
        if (ref === undefined || ref.slug === "") {
          continue;
        }
        // An empty ref org means same-org; normalize before comparing so a
        // pre-normalization row still guards its app.
        const refOrg = ref.org !== "" ? ref.org : (channel.metadata?.org ?? "");

        if (refOrg === org && ref.slug === slug) {
          throw failedPreconditionError(
            deleteBlockedByChannelMessage(org, slug, channel.metadata?.name ?? ""),
          );
        }
      }
    },
  };
}
