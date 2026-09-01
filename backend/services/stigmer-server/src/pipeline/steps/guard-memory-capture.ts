/**
 * GuardMemoryCapture — the memory create chain's capture-eligibility gate
 * (C2 Stage 3D; the Java MemoryCreateHandler's first gate, DD-002 D4 as
 * amended): memory may only be captured for a FIRST-PARTY HUMAN OPERATOR
 * — or the remember tool's SESSION-SCOPED sandbox credential acting as
 * its human subject (the Stage 3 decision, restored for compositions by
 * parity entry 20260830.05 / stigmer-cloud#564). Machine accounts and
 * every minted-credential lane — PlatformClient user tokens, guest
 * embeds, channel senders, schedule runs — stay refused; "the label is
 * not authorization; the server refuses."
 *
 * The credential class is read from the VERIFIED token's own claims
 * (position 1 verified it; decoding here is a read of trusted state):
 * every Stigmer-minted non-first-party credential carries the
 * `platform_client_id` claim (StigmerJwtIssuer stamps it on user, guest,
 * channel, and schedule tokens alike), so its presence IS the exclusion
 * the Java RequestCallerIdentity.isFirstPartyHumanOperator computes.
 *
 * RUNNER credentials carry neither the machine class nor that claim —
 * their eligibility is EDITION POLICY, so the gate consults the composed
 * RunnerCredentialProvider's authorizeMemoryCapture capability (the
 * token-type vocabulary that classifies a runner credential is the
 * provider's own; no caller class expresses it and OSS never learns
 * another edition's lane names). The capability's three verdicts:
 * `admit` (the session-scoped capture lane — the token's proved subject
 * and session id are stashed under MEMORY_CAPTURE_CREDENTIAL_KEY for
 * ResolveMemoryDefaults' Java-parity field derivation), `refuse` (a
 * runner credential outside the capture lane — the byte-pinned copy
 * below), `no-opinion` (not a credential the implementation classifies —
 * this gate's own logic applies). The capability throws its own
 * byte-pinned refusal for the org-mismatch arm. With no capability
 * composed the gate's logic is byte-identical to before the seam: OSS
 * trusted-local callers carry no token and OIDC console logins carry no
 * platform_client_id claim — the step admits both, so the single-user
 * posture is unchanged (proven by the rosters).
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import { metadataOf } from "./shapes.js";

/** The Java MemoryPolicy.MEMORY_CAPTURE_CALLER_MESSAGE, byte-pinned. */
export const MEMORY_CAPTURE_CALLER_MESSAGE =
  "memory can only be captured for a first-party human operator";

/**
 * Context key carrying an admitted capture credential's proved claims
 * (subjectIdentityAccountId + provedSessionId) from this gate to
 * ResolveMemoryDefaults — present exactly when the capability answered
 * `admit`, so the defaults step needs no second consult.
 */
export const MEMORY_CAPTURE_CREDENTIAL_KEY = "memoryCaptureCredential";

export function newGuardMemoryCaptureStep<Desc extends DescMessage>(
  provider?: RunnerCredentialProvider,
): PipelineStep<Desc> {
  return {
    name: "GuardMemoryCapture",
    execute(ctx: RequestContext<Desc>): void {
      const caller = ctx.callerIdentity;
      if (caller.callerClass === "internal" || caller.origin === "in-process") {
        // Server-composed traversals are not capture requests from a
        // credential; the entry-point request already passed the gate.
        return;
      }
      const decide = provider?.authorizeMemoryCapture;
      if (decide !== undefined) {
        // The org the capture addresses — the capability's org-mismatch
        // arm checks it against the token's own claim (and throws its
        // byte-pinned refusal itself). Empty when the request carries
        // none; Java requires metadata.org before its org-match arm, so
        // an empty value can only ever narrow.
        const org = metadataOf(ctx.newState)?.org ?? "";
        const decision = decide.call(provider, caller, org);
        switch (decision.verdict) {
          case "admit":
            ctx.set(MEMORY_CAPTURE_CREDENTIAL_KEY, {
              subjectIdentityAccountId: decision.subjectIdentityAccountId,
              provedSessionId: decision.provedSessionId,
            });
            return;
          case "refuse":
            throw new ConnectError(
              MEMORY_CAPTURE_CALLER_MESSAGE,
              Code.PermissionDenied,
            );
          case "no-opinion":
            break;
          default: {
            const exhaustive: never = decision;
            throw new Error(
              `unknown memory capture decision ${JSON.stringify(exhaustive)}`,
            );
          }
        }
      }
      if (
        caller.callerClass === "machine" ||
        carriesPlatformClientClaim(caller.rawToken)
      ) {
        throw new ConnectError(
          MEMORY_CAPTURE_CALLER_MESSAGE,
          Code.PermissionDenied,
        );
      }
    },
  };
}

/** An admitted capture credential's proved claims (the context payload). */
export interface MemoryCaptureCredential {
  readonly subjectIdentityAccountId: string;
  readonly provedSessionId: string;
}

/**
 * Reads the admitted capture credential stashed by this gate, if any —
 * ResolveMemoryDefaults' half of the handoff.
 */
export function memoryCaptureCredentialOf<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): MemoryCaptureCredential | undefined {
  const payload = ctx.get(MEMORY_CAPTURE_CREDENTIAL_KEY);
  if (
    typeof payload === "object" &&
    payload !== null &&
    "subjectIdentityAccountId" in payload &&
    "provedSessionId" in payload
  ) {
    return payload as MemoryCaptureCredential;
  }
  return undefined;
}

function carriesPlatformClientClaim(rawToken: string): boolean {
  const segments = rawToken.split(".");
  if (segments.length !== 3) {
    return false; // not a JWT — the trusted-local no-token posture
  }
  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as { platform_client_id?: unknown };
    return (
      typeof payload.platform_client_id === "string" &&
      payload.platform_client_id !== ""
    );
  } catch {
    return false;
  }
}
