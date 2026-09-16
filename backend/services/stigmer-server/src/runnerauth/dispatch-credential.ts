/**
 * The one reader of the provider's `mintRunCredential` capability for the
 * two dispatch paths (temporal/agentexecution/engine-client.ts and
 * temporal/workflowexecution/engine-client.ts). Both engines put the
 * answer on the invoke workflow input as `execution_context_token` — the
 * connect lane's key for the same token type (domain/mcpserver/engine.ts)
 * — and omit the key when the answer is "".
 *
 * Three answers, one rule each:
 *
 *   - the capability is absent: "" — this edition's runner is
 *     credentialed another way (the cloud bakes a sandbox credential at
 *     provision; runner-credential-provider.ts). Nothing to log: it is
 *     the composition's shape, not a condition.
 *   - the capability answers "": "" — the lane cannot mint (keyless, the
 *     modeled disabled state). The composition root makes a keyless
 *     server boot-fatal, so this is a test-only arm in practice.
 *   - the capability THROWS: one warning naming the execution, then "" —
 *     a dispatch never fails because a credential could not be minted
 *     (the connect lane's precedent, ruled 2026-09-16). The runner then
 *     falls back to the platform exchange and, refused there for a run
 *     that is not the key-holder's, reads redacted and fails the run
 *     loudly at its first read — attributable, never silent. The default
 *     provider throws only for an empty execution id (a programming
 *     error), so this arm exists to be pinned, not expected.
 *
 * The credential is never logged: the warning carries the execution id
 * and the error's message, and the engines' own "Started …" lines carry
 * ids and queues (a test pins the field names). A run credential in a log
 * line would let anyone who reads the log act as the run's human for as
 * long as the run lives.
 */
import type { Logger } from "../boot/logger.js";
import type { RunnerCredentialProvider } from "./runner-credential-provider.js";

/** The dispatch's view of the seam: the one capability it reads. */
export type RunCredentialMint = Pick<
  RunnerCredentialProvider,
  "mintRunCredential"
>;

export function runCredentialForDispatch(
  credentials: RunCredentialMint,
  executionId: string,
  logger: Logger,
): string {
  const mintRunCredential = credentials.mintRunCredential?.bind(credentials);
  if (mintRunCredential === undefined) {
    return "";
  }
  try {
    return mintRunCredential(executionId);
  } catch (error) {
    logger.warn(
      "Failed to mint the run credential — dispatching without it; the runner will fall back to the platform exchange",
      {
        execution_id: executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return "";
  }
}
