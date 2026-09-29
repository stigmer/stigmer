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
 * Who counts as that operator is stated ONCE, in
 * `isFirstPartyHumanOperator` (extensions/identity.ts), the same
 * allow-list recall and the person's declared preferences read on
 * execution create, so the two halves of the memory loop cannot disagree
 * about who a person is (stigmer#1406): a wire `user` that is not
 * server-composed and whose bearer is not a PlatformClient token. Being
 * an allow-list, it refuses a caller class this gate has never heard of
 * — the half that must fail closed is capture (CheckMemoryEnablement's
 * header). The PlatformClient arm reads the VERIFIED token's own claims,
 * and only on a platform token (stigmer#1312, the predicate's own doc).
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
 * composed only the allow-list runs: the OSS trusted-local identity and
 * OIDC console logins are wire `user`s with no platform token, so the
 * single-user posture is unchanged (proven by the rosters).
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  isFirstPartyHumanOperator,
  isServerComposedRequest,
} from "../../extensions/identity.js";
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
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const caller = ctx.callerIdentity;
      if (isServerComposedRequest(caller)) {
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
        // an empty value can only ever narrow. Awaited because the
        // built-in provider reads the bound execution's row for the
        // session and org the cloud's token carries as claims.
        const org = metadataOf(ctx.newState)?.org ?? "";
        const decision = await decide.call(provider, caller, org);
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
      if (!isFirstPartyHumanOperator(caller)) {
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
