/**
 * resolveValuesForCaller — ports
 * pkg/domain/executioncontext/controller/resolve_values_for_caller.go:
 * decides, by presented credential, whether a getByExecutionId response
 * carries decrypted or redacted secret values, and applies the transform
 * in place. The OSS mirror of the cloud edition's
 * ResolveExecutionContextValuesForCaller (oss#535, porting the
 * stigmer-cloud#152 contract: no read RPC hands plaintext secrets to a
 * caller outside the runner lane).
 *
 * # The lane
 *
 * getByExecutionId is the runner's secret-delivery path. The runner
 * distinguishes itself with an execution-scoped token minted by
 * getRunnerScopedToken and presented as a Bearer authorization header
 * (the same header shape a cloud runner uses for its sandbox credential).
 * Decrypt requires the FULL binding: a valid, unexpired token whose
 * execution_id claim equals this EC's spec.execution_id. Everything else
 * — no header, malformed or expired token, or a token minted for a
 * different execution — falls closed to the same redaction
 * get/getByReference apply, as a SUCCESSFUL response, not an error.
 *
 * Token verification lives HERE, in the domain, not on the identity
 * chassis (O2, 20260827.01): the runner token is a lane discriminator,
 * not a caller identity — the chassis deliberately lets it fall through
 * to the trusted-local identity (ruling Q6), and this is the one RPC
 * that reads the raw header — exactly the consumer the runnerauth module
 * header reserves ("the executioncontext resolve step"). The
 * redaction-as-success contract is pinned by the conformance suites and
 * must survive every future verifier: a runner token is NEVER an
 * authentication credential.
 *
 * # Decrypt error doctrine (the oss#405 runtime-resolution doctrine)
 *
 *   - Undecryptable ciphertext (tampered/truncated/wrong-key) is scoped
 *     to one value: WARN and drop that key rather than failing the read.
 *   - EncryptionDisabledError fails the request: the stored ciphertext
 *     may be perfectly valid (key file lost), and dropping it would start
 *     the execution silently missing a credential — a confusing
 *     downstream failure instead of a clear one here.
 *   - Legacy pre-oss#535 plaintext rows pass through undecorated (decrypt
 *     only runs on isEncrypted values), so old stores serve without
 *     migration.
 */
import type { HandlerContext } from "@connectrpc/connect";

import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import { EncryptionDisabledError } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import { internalError } from "../../pipeline/errors.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import type { RunnerAuthService } from "../../runnerauth/runnerauth.js";
import { encryptionKeyMissingMessage } from "./constants.js";
import { redactExecutionContextSecrets } from "./redact.js";

export interface ResolveValuesDeps {
  readonly logger: Logger;
  readonly secretService: SecretService;
  readonly runnerAuthService: RunnerAuthService;
}

/**
 * Applies the credential-dispatched transform in place: decrypt for a
 * scope-bound runner token, redact for everyone else. Both transforms
 * mutate the fresh store unmarshal, never the stored row.
 */
export function resolveValuesForCaller(
  deps: ResolveValuesDeps,
  ctx: HandlerContext,
  ec: ExecutionContext,
): void {
  const executionId = verifyRunnerToken(deps, ctx, ec);
  if (executionId !== undefined) {
    deps.logger.debug(
      "Scope-bound runner token presented - decrypting execution context secrets",
      { executionId },
    );
    decryptSecretValues(deps, ec);
    return;
  }
  redactExecutionContextSecrets(ec);
}

/**
 * Go verifyRunnerToken: the execution id the token is bound to when the
 * caller presented a valid runner token bound to exactly this execution
 * context; undefined otherwise. Every failure mode answers undefined —
 * the caller falls closed to redaction — with the mismatch case
 * WARN-logged because a runner reading across executions indicates a bug,
 * while an absent header is just an ordinary user-shaped read. A keyless
 * RunnerAuthService rejects every token (verify throws), the TS shape of
 * Go's nil-service arm: without a key no token can be genuine.
 */
function verifyRunnerToken(
  deps: ResolveValuesDeps,
  ctx: HandlerContext,
  ec: ExecutionContext,
): string | undefined {
  const token = bearerToken(ctx);
  if (token === "") {
    return undefined;
  }

  let tokenExecutionId: string;
  try {
    tokenExecutionId = deps.runnerAuthService.verify(token);
  } catch {
    deps.logger.debug(
      "Presented runner token failed verification - redacting execution context secrets",
    );
    return undefined;
  }

  if (tokenExecutionId !== (ec.spec?.executionId ?? "")) {
    deps.logger.warn(
      "Runner token is not scope-bound to this execution context - redacting secrets",
      {
        tokenExecutionId,
        executionId: ec.spec?.executionId ?? "",
      },
    );
    return undefined;
  }

  return tokenExecutionId;
}

/**
 * The Bearer credential from the request's authorization header; empty
 * when absent or differently shaped. The parsing shape (Go's exact
 * bearerToken semantics, including the repeated-header first-segment
 * rule) is the ONE shared definition in the identity chassis — promoted
 * there when the verifier chain became its second consumer (O2).
 */
function bearerToken(ctx: HandlerContext): string {
  return parseBearerToken(ctx.requestHeader.get("authorization") ?? "");
}

/**
 * Go decryptSecretValues: walks spec.data and decrypts every encrypted
 * is_secret value in place, per the doctrine documented on the module
 * header.
 */
function decryptSecretValues(
  deps: ResolveValuesDeps,
  ec: ExecutionContext,
): void {
  const executionId = ec.spec?.executionId ?? "";
  const data = ec.spec?.data ?? {};
  for (const [key, value] of Object.entries(data)) {
    if (!value.isSecret || !deps.secretService.isEncrypted(value.value)) {
      continue;
    }

    try {
      value.value = deps.secretService.decrypt(value.value);
    } catch (error) {
      if (error instanceof EncryptionDisabledError) {
        throw internalError(
          error,
          encryptionKeyMissingMessage(executionId, key),
        );
      }
      deps.logger.warn(
        "Undecryptable ciphertext in execution context — dropping this value from the runner read",
        {
          key,
          executionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      delete data[key];
    }
  }
}
