/**
 * GuardMemoryCapture — the memory create chain's capture-eligibility gate
 * (C2 Stage 3D; the Java MemoryCreateHandler's first gate, DD-002 D4 as
 * amended): memory may only be captured for a FIRST-PARTY HUMAN OPERATOR.
 * Machine accounts and every minted-credential lane — PlatformClient user
 * tokens, guest embeds, channel senders, schedule runs — stay refused;
 * "the label is not authorization; the server refuses."
 *
 * The credential class is read from the VERIFIED token's own claims
 * (position 1 verified it; decoding here is a read of trusted state):
 * every Stigmer-minted non-first-party credential carries the
 * `platform_client_id` claim (StigmerJwtIssuer stamps it on user, guest,
 * channel, and schedule tokens alike), so its presence IS the exclusion
 * the Java RequestCallerIdentity.isFirstPartyHumanOperator computes.
 *
 * OSS byte-identity: trusted-local callers carry no token and OIDC
 * console logins carry no platform_client_id claim — the step admits
 * both, so the single-user posture is unchanged (proven by the rosters).
 *
 * Known refinement, recorded: Java additionally admits the remember
 * tool's SESSION-SCOPED sandbox credential. Runner credentials verify
 * through their own lane and carry no platform_client_id, so they pass
 * this gate; the session-bound-only narrowing rides the sandbox
 * credential work (C4's lane) where the session binding is expressible.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";

/** The Java MemoryPolicy.MEMORY_CAPTURE_CALLER_MESSAGE, byte-pinned. */
export const MEMORY_CAPTURE_CALLER_MESSAGE =
  "memory can only be captured for a first-party human operator";

export function newGuardMemoryCaptureStep<
  Desc extends DescMessage,
>(): PipelineStep<Desc> {
  return {
    name: "GuardMemoryCapture",
    execute(ctx: RequestContext<Desc>): void {
      const caller = ctx.callerIdentity;
      if (caller.callerClass === "internal" || caller.origin === "in-process") {
        // Server-composed traversals are not capture requests from a
        // credential; the entry-point request already passed the gate.
        return;
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
