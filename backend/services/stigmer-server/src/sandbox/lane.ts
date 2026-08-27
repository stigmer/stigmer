/**
 * The composed sandbox lane — the explicit modeled state the invocation
 * steps consume (never a nullable provisioner threaded through deps; the
 * composition doctrine's "optional infrastructure is a modeled state").
 * Disabled IS the OSS default: SANDBOX_PROVISIONER_TYPE unset means the
 * external-runner posture (gate ruling Q1) and every step below
 * short-circuits on its fast path — byte-identical wire behavior, pinned
 * by the conformance rosters.
 *
 * Credential minting (gate ruling Q6): sandboxes authenticate on the ONE
 * OSS credential lane — execution-scoped (runnerauth §6c). The token is
 * minted per execution at ensure time, so the cloud's stale-token refresh
 * arm degenerates to per-execution re-mint here; a disabled mint lane
 * launches the sandbox with no token and ExecutionContext decrypt falls
 * back to redaction (oss#535's posture), degraded but never dark.
 *
 * A provider with the mintSandboxCredential capability (C4, gate ruling
 * Q1) owns the mint instead: the ensure steps hand it the full
 * provisioning context and bake whatever it returns — the cloud's
 * session/workflow-scoped tokens ride this without the steps knowing any
 * lane vocabulary beyond their own identifiers.
 */
import type {
  RunnerCredentialProvider,
  SandboxCredentialRequest,
} from "../runnerauth/runner-credential-provider.js";
import { TOKEN_TYPE_EXECUTION_SCOPED } from "../runnerauth/runnerauth.js";
import type { Logger } from "../boot/logger.js";
import type { SandboxProvisioner } from "./provisioner.js";

/**
 * Sandbox credential TTL: 4 hours — the cloud edition's
 * SandboxTokenService TTL, kept identical so a sandbox outliving its
 * token behaves the same on both editions (the runner renews via
 * getRunnerScopedToken either way).
 */
export const SANDBOX_TOKEN_TTL_SECONDS = 4 * 60 * 60;

/** The lane: either disabled (the default) or a provisioner + its credential mint. */
export type SandboxLane =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly provisioner: SandboxProvisioner;
      readonly credentials: RunnerCredentialProvider;
    };

export function newSandboxLane(
  provisioner: SandboxProvisioner | undefined,
  credentials: RunnerCredentialProvider,
): SandboxLane {
  if (provisioner === undefined) {
    return { enabled: false };
  }
  return { enabled: true, provisioner, credentials };
}

/**
 * Mints the sandbox's STIGMER_TOKEN, or "" to launch tokenless (module
 * header). With the mintSandboxCredential capability composed, the
 * provider owns the whole decision from the provisioning context;
 * otherwise the OSS execution-scoped mint runs exactly as before. A mint
 * FAILURE on an enabled lane is a real fault and propagates to the
 * caller's failure posture — never swallowed into the no-token arm.
 */
export function mintSandboxToken(
  lane: Extract<SandboxLane, { enabled: true }>,
  request: SandboxCredentialRequest,
  logger: Logger,
): string {
  const mintSandboxCredential = lane.credentials.mintSandboxCredential?.bind(
    lane.credentials,
  );
  if (mintSandboxCredential !== undefined) {
    return mintSandboxCredential(request);
  }
  if (!lane.credentials.isEnabled(TOKEN_TYPE_EXECUTION_SCOPED)) {
    logger.warn(
      "Sandbox launching without a runner token (credential lane disabled) — ExecutionContext reads will be redacted",
      { executionId: request.executionId },
    );
    return "";
  }
  return lane.credentials.mint(
    TOKEN_TYPE_EXECUTION_SCOPED,
    request.executionId,
    SANDBOX_TOKEN_TTL_SECONDS,
  ).token;
}
