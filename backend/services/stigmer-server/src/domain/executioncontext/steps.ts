/**
 * ExecutionContext domain steps — port the domain-local steps of
 * pkg/domain/executioncontext/controller/ (the write-boundary ciphertext
 * guard, the encrypt-at-rest step, and the execution_id loader).
 *
 * The ordering contract these steps embody (oss#535, the EC flavor of the
 * environment domain's "sentinels → encrypt" doc):
 *   1. RejectCiphertextShapedValues runs BEFORE EncryptSecretValues.
 *      ExecutionContext is create-only with NO redaction round-trip
 *      (unlike Environment, whose PreserveRedactedSecrets restores
 *      ***REDACTED*** markers on update), so this guard is the WHOLE
 *      write boundary: every legitimate creator — the agent/workflow
 *      builders, the MCP connect handler, an SDK caller — supplies
 *      plaintext, and nothing with an enc:v<N>: prefix reaches the store
 *      except server-produced ciphertext. That is what keeps the decrypt
 *      lane safe from forged or replayed blobs.
 *   2. Redaction (redact.ts) runs AFTER Persist, outside the pipeline.
 *
 * Proven by executioncontext.conformance.test.ts
 * (CONFORMANCE_TARGET=local) and __tests__/executioncontext.test.ts.
 */
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import type { ExecutionContextExecutionIdInput } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/io_pb";
import type { ExecutionValue } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";
import type { ExecutionContextQueryController } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/query_pb";

import { Code, ConnectError } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Logger } from "../../boot/logger.js";
import { isCiphertextShaped } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import type { Authorizer, AuthzDecision } from "../../extensions/authorizer.js";
import {
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { ciphertextShapedMessage, encryptFailureMessage } from "./constants.js";

/**
 * RejectCiphertextShapedValues — Go rejectCiphertextShapedStep: refuses
 * client-supplied values that look like stored ciphertext (the enc:v<N>:
 * prefix family, ANY version — an unknown future version fails closed) —
 * the EC flavor of the oss#395 / cloud#229 write-boundary guard. Without
 * it, the encrypt step's idempotent pass-through would let a caller
 * smuggle a forged or replayed ciphertext blob into the store, where the
 * runner lane would later try to decrypt it.
 *
 * Checks ALL of spec.data — secret and non-secret alike, exactly as Go
 * does: the prefix is server-reserved regardless of the is_secret flag.
 * Reads the immutable input (Go ctx.Input()), the request as the client
 * sent it.
 */
export function newRejectCiphertextShapedStep(): PipelineStep<
  typeof ExecutionContextSchema
> {
  return {
    name: "RejectCiphertextShapedValues",
    execute(ctx: RequestContext<typeof ExecutionContextSchema>): void {
      const data = ctx.input.spec?.data ?? {};
      for (const [key, value] of Object.entries(data)) {
        if (isCiphertextShaped(value.value)) {
          throw invalidArgumentError(ciphertextShapedMessage(key));
        }
      }
    },
  };
}

/**
 * EncryptSecretValues — Go encryptSecretValuesStep: encrypts every
 * non-empty is_secret value in spec.data before persistence — the EC twin
 * of the environment domain's step of the same name, closing the at-rest
 * half of oss#535 (the merged EC — decrypted environment secrets,
 * runtime_env overrides, injected OAuth tokens — rested plaintext for
 * each run's duration, the same backup-exposure class oss#405 closed for
 * environments).
 *
 * Runs after RejectCiphertextShapedValues, so every secret value reaching
 * it is client plaintext; encrypt's idempotent pass-through is therefore
 * never exercised by design, but keeps a double application harmless.
 *
 * Keyless mode: values pass through plaintext with one WARN per request,
 * emitted only when a non-empty secret would actually rest plaintext (the
 * oss#394 convention). Non-secret values are never touched: the read
 * paths gate decryption on is_secret, so encrypting a non-secret value
 * would strand it as unreadable ciphertext.
 */
export function newEncryptSecretValuesStep(
  secretService: SecretService,
  logger: Logger,
): PipelineStep<typeof ExecutionContextSchema> {
  return {
    name: "EncryptSecretValues",
    execute(ctx: RequestContext<typeof ExecutionContextSchema>): void {
      const ec = ctx.newState;
      const data = ec.spec?.data;
      if (data === undefined || Object.keys(data).length === 0) {
        return;
      }

      if (!secretService.isEnabled()) {
        if (hasNonEmptySecret(data)) {
          logger.warn(
            "Encryption disabled: execution context secret values will be stored in plaintext",
            { executionId: ec.spec?.executionId ?? "" },
          );
        }
        return;
      }

      for (const [key, value] of Object.entries(data)) {
        if (!value.isSecret || value.value === "") {
          continue;
        }
        try {
          value.value = secretService.encrypt(value.value);
        } catch (error) {
          throw internalError(error, encryptFailureMessage(key));
        }
      }
    },
  };
}

/** Whether any entry would have been encrypted — keeps the WARN honest. */
function hasNonEmptySecret(data: Record<string, ExecutionValue>): boolean {
  return Object.values(data).some((v) => v.isSecret && v.value !== "");
}

type GetByExecutionIdDesc =
  typeof ExecutionContextQueryController.method.getByExecutionId.input;

/**
 * LoadByExecutionId — Go loadByExecutionIdStep: loads an ExecutionContext
 * by querying the spec.executionId FIELD (protobuf JSON naming), not the
 * resource id — the runner's lookup key is the parent execution's id.
 * findByField is a full scan of the kind with first-match semantics, the
 * Go-parity behavior the store interface documents.
 *
 * The empty-input guard is unreachable behind ValidateProto (min_len 1 on
 * execution_id) but ports Go's in-step defense verbatim so the chains
 * correspond step-for-step.
 */
export function newLoadByExecutionIdStep(
  store: Store,
): PipelineStep<GetByExecutionIdDesc> {
  return {
    name: "LoadByExecutionId",
    async execute(ctx: RequestContext<GetByExecutionIdDesc>): Promise<void> {
      const input: ExecutionContextExecutionIdInput = ctx.input;
      if (input.executionId === "") {
        throw invalidArgumentError("execution_id is required");
      }

      let executionContext: ExecutionContext;
      try {
        executionContext = await store.findByField(
          ctx.apiResourceKind,
          "spec.executionId",
          input.executionId,
          ExecutionContextSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          throw notFoundError(
            "execution_context",
            `execution_id=${input.executionId}`,
          );
        }
        throw internalError(error, "failed to query execution context");
      }

      ctx.set(TARGET_RESOURCE_KEY, executionContext);
    },
  };
}

/**
 * AuthorizeCreate — the Java ExecutionContextCreateHandler.AuthorizeCreate
 * port (stigmer-cloud#297; C2 Stage 3D): the create RPC skips the
 * declarative position-1 check (in-process creators — the agent/workflow
 * execution machinery — already authorized the run against its
 * session-or-org and act as the machine account), so EXTERNAL callers are
 * gated here instead: they must hold can_create_execution_in on
 * metadata.org — the same permission that gates creating an execution in
 * the org, so members and org guests pass and an outsider refuses.
 * Ordered before the duplicate check so an unauthorized caller learns
 * nothing about which execution ids exist.
 *
 * OSS byte-identity: the permissive authorizer allows every check, so the
 * single-user posture is unchanged (the rosters prove it).
 */
export function newAuthorizeExecutionContextCreateStep(
  authorizer: Authorizer,
): PipelineStep<typeof ExecutionContextSchema> {
  return {
    name: "AuthorizeCreate",
    async execute(
      ctx: RequestContext<typeof ExecutionContextSchema>,
    ): Promise<void> {
      const caller = ctx.callerIdentity;
      if (caller.callerClass === "internal" || caller.origin === "in-process") {
        return; // authorized upstream — the Java in-process trust arm
      }
      let decision: AuthzDecision;
      try {
        decision = await authorizer.authorize(caller, {
          permission: IamPermission.can_create_execution_in,
          resourceKind: ApiResourceKind.organization,
          resourceId: ctx.newState.metadata?.org ?? "",
        });
      } catch (error) {
        throw internalError(
          error instanceof Error ? error : new Error(String(error)),
          "execution-context create authorization could not be completed",
        );
      }
      switch (decision.kind) {
        case "allow":
          return;
        case "deny":
        case "not-found":
          throw new ConnectError(
            "unauthorized to create execution context in this organization",
            Code.PermissionDenied,
          );
        case "unavailable":
          throw internalError(
            decision.cause,
            "execution-context create authorization could not be completed",
          );
        default: {
          const exhaustive: never = decision;
          throw internalError(
            new Error(`unknown decision ${JSON.stringify(exhaustive)}`),
            "execution-context create authorization could not be completed",
          );
        }
      }
    },
  };
}
