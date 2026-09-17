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
 * Decrypt requires the FULL binding: a valid token whose execution_id
 * claim equals this EC's spec.execution_id, and — for a RUN credential,
 * the no-`exp` token the dispatch path hands the runner — a bound
 * execution that is still live (runnerauth/bound-execution.ts: not
 * terminal, or ended within the grace). Everything else — no header, a
 * malformed or expired token, a token minted for a different execution,
 * a run credential whose run is over — falls closed to the same
 * redaction get/getByReference apply, as a SUCCESSFUL response, not an
 * error.
 *
 * The decrypt decision lives HERE, in the domain, whatever the identity
 * chassis makes of the token. Under trusted-local no verifier claims it
 * and this is the one RPC that reads the raw header (the consumer the
 * runnerauth module header reserves, "the executioncontext resolve
 * step"). Under the built-in authorization posture the runner-subject
 * verifier ALSO admits the same token as the run's human at position 1
 * (runnerauth.ts header, 2026-09-16) — that decides WHO is calling and
 * whether they may read the row; whether the row's secrets are decrypted
 * for them is still this lane's binding check, so a person who can view
 * an execution's context never receives its plaintext by holding a
 * credential for a different one. The redaction-as-success contract is
 * pinned by the conformance suites and holds on every arm.
 *
 * Why liveness is read only for a no-`exp` token: a clocked token's
 * validity was decided by `verify` (its clock) and its binding, and the
 * ExecutionContext it opens need not name an execution row at all — the
 * connect lane's token opens an EC for an MCP discovery, and the rosters
 * pin a clocked token decrypting an EC whose execution id names no row.
 * A run credential has no clock; the row is the only thing that can end
 * it, and a plaintext token in Temporal history must not decrypt a
 * finished run's secrets for good.
 *
 * # Decrypt error doctrine (the oss#405 runtime-resolution doctrine,
 * # arms per the two-armed taxonomy in encryption/errors.ts)
 *
 *   - The value-scoped arm (InvalidCiphertextError family —
 *     tampered/truncated/wrong-key) is scoped to one value: WARN and
 *     drop that key rather than failing the read.
 *   - The infrastructure arm (EncryptionUnavailableError, incl. its
 *     keyless EncryptionDisabledError case) fails the request: the
 *     stored ciphertext may be perfectly valid (key file lost, codec's
 *     key provider unreachable, version with no codec here), and
 *     dropping it would start the execution silently missing a
 *     credential — a confusing downstream failure instead of a clear one
 *     here.
 *   - Legacy pre-oss#535 plaintext rows pass through undecorated (decrypt
 *     only runs on isEncrypted values), so old stores serve without
 *     migration.
 */
import type { HandlerContext } from "@connectrpc/connect";

import type { ExecutionContext } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import { EncryptionUnavailableError } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import { internalError } from "../../pipeline/errors.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import {
  bindsARun,
  loadBoundExecution,
} from "../../runnerauth/bound-execution.js";
import type { BoundExecutionStore } from "../../runnerauth/bound-execution.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import {
  isClockedToken,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../../runnerauth/runnerauth.js";
import { encryptionKeyMissingMessage } from "./constants.js";
import { redactExecutionContextSecrets } from "./redact.js";

export interface ResolveValuesDeps {
  readonly logger: Logger;
  readonly secretService: SecretService;
  readonly runnerAuthService: RunnerCredentialProvider;
  /** Where the bound execution lives — read for a run credential's liveness only. */
  readonly store: BoundExecutionStore;
}

/**
 * Applies the credential-dispatched transform in place: decrypt for a
 * scope-bound runner token, redact for everyone else. Both transforms
 * mutate the fresh store unmarshal, never the stored row.
 *
 * With the authorizeExecutionContextRead capability composed (C4, gate
 * ruling Q1), the provider owns the ENTIRE trust decision — its lane set
 * and scope bindings (the cloud's session/workflow/connect rules) replace
 * the OSS execution-scoped check below. Redaction-as-success stays the
 * contract on every arm.
 */
export async function resolveValuesForCaller(
  deps: ResolveValuesDeps,
  ctx: HandlerContext,
  ec: ExecutionContext,
): Promise<void> {
  if (await runnerMayDecrypt(deps, ctx, ec)) {
    await decryptSecretValues(deps, ec);
    return;
  }
  redactExecutionContextSecrets(ec);
}

/**
 * The trust decision: the composed capability when present, the OSS
 * execution-scoped verify otherwise. A capability that THROWS is a bug in
 * the composition, not a credential failure — it still falls closed to
 * redaction, WARN-logged, because a read that would have redacted must
 * never start failing outright on a policy fault (the
 * redaction-as-success contract).
 */
async function runnerMayDecrypt(
  deps: ResolveValuesDeps,
  ctx: HandlerContext,
  ec: ExecutionContext,
): Promise<boolean> {
  const authorizeRead =
    deps.runnerAuthService.authorizeExecutionContextRead?.bind(
      deps.runnerAuthService,
    );
  if (authorizeRead !== undefined) {
    const token = bearerToken(ctx);
    if (token === "") {
      return false;
    }
    try {
      return await authorizeRead(token, ec.spec?.executionId ?? "");
    } catch (error) {
      deps.logger.warn(
        "ExecutionContext read authorization failed — redacting secrets",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return false;
    }
  }

  const token = bearerToken(ctx);
  const executionId = verifyRunnerToken(deps, token, ec);
  if (executionId === undefined) {
    return false;
  }
  if (!isClockedToken(token) && !(await runIsLive(deps, executionId))) {
    deps.logger.debug(
      "Run credential presented for a run that is over - redacting execution context secrets",
      { executionId },
    );
    return false;
  }
  deps.logger.debug(
    "Scope-bound runner token presented - decrypting execution context secrets",
    { executionId },
  );
  return true;
}

/**
 * Go verifyRunnerToken: the execution id the token is bound to when the
 * caller presented a valid runner token bound to exactly this execution
 * context; undefined otherwise. Every failure mode answers undefined —
 * the caller falls closed to redaction — with the mismatch case
 * WARN-logged because a runner reading across executions indicates a bug,
 * while an absent header is just an ordinary user-shaped read. A keyless
 * provider rejects every token (verify throws), the TS shape of Go's
 * nil-service arm: without a key no token can be genuine. This lane
 * accepts exactly the execution_scoped credential lane — the caller-side
 * trust statement the provider contract requires.
 */
function verifyRunnerToken(
  deps: ResolveValuesDeps,
  token: string,
  ec: ExecutionContext,
): string | undefined {
  if (token === "") {
    return undefined;
  }

  let tokenExecutionId: string;
  try {
    tokenExecutionId = deps.runnerAuthService.verify(
      TOKEN_TYPE_EXECUTION_SCOPED,
      token,
    );
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
 * A run credential's liveness: the bound execution exists, IS a run
 * (`bindsARun` — a clockless token bound to a connect is a shape no mint
 * produces, refused here and by the verifier through the one predicate)
 * and is live (runnerauth/bound-execution.ts). A missing row is "not
 * live" — the credential opens nothing. A store fault is an
 * infrastructure fault, sanitized here as every direct handler does (the
 * store-fault doctrine): an outage must not read as a redaction decision,
 * and the same store just served the row this read is for.
 */
async function runIsLive(
  deps: ResolveValuesDeps,
  executionId: string,
): Promise<boolean> {
  try {
    const execution = await loadBoundExecution(deps.store, executionId);
    return (
      execution !== undefined && bindsARun(execution.kind) && execution.live
    );
  } catch (error) {
    throw internalError(error, "failed to load the run credential's execution");
  }
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
async function decryptSecretValues(
  deps: ResolveValuesDeps,
  ec: ExecutionContext,
): Promise<void> {
  const executionId = ec.spec?.executionId ?? "";
  const data = ec.spec?.data ?? {};
  // One value at a time, deliberately NOT the batch verb: decryptAll
  // fails as a whole, and this lane's contract is per-key skip for
  // value-scoped failures.
  for (const [key, value] of Object.entries(data)) {
    if (!value.isSecret || !deps.secretService.isEncrypted(value.value)) {
      continue;
    }

    try {
      value.value = await deps.secretService.decrypt(value.value);
    } catch (error) {
      if (error instanceof EncryptionUnavailableError) {
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
