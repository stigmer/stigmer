// Authentication posture conformance (entry 20260904.02).
// Pins the serving edge's position-1 contract — what a request gets BEFORE
// any handler runs, as a function of the credential it presents:
//   - NO credential on a non-public method: refused UNAUTHENTICATED
//     "authentication token missing" where the target requires
//     authentication (the Java GrpcSecurityConfigBase copy, byte-pinned; the
//     TS chassis reproduces it under the OIDC-issuer arm and under the
//     require-authentication registry point the cloud composition declares);
//     admitted as the single operator where it does not (the OSS
//     trusted-local posture — a contract too, pinned so the TS server keeps
//     it);
//   - NO credential on an is_public method: answers on EVERY target (the
//     Java isPublic skip; getServerInfo is what consoles and CLIs read
//     before login);
//   - NO credential on the standard gRPC health service: SERVING on EVERY
//     target (the Java by-name skip — the health proto cannot carry our
//     option, and a Kubernetes `grpc:` probe is exactly this call; a
//     refused probe is a pod that never becomes Ready, stigmer#974);
//   - a credential NOTHING claims: refused UNAUTHENTICATED where a verifier
//     is composed (code only — Java's classifyAuthError copy and the TS
//     chassis's differ by design); admitted as the operator on the
//     verifier-less local targets (the O2 ruling-Q6 fall-through).
// Coverage of the absent-token arm was ZERO before this suite: every
// conformance RPC carried the primary credential, so a composition that
// admitted anonymous callers as `system` passed five green readouts
// (the entry's origin story). The arms below drive credential-less and
// garbage-credential clients through the TARGET's own seams
// (anonymousClients / clientsPresenting), never a hand-built transport.
//
// One environment cannot show the contract: the hermetic cloud launcher
// boots Java in test security mode, where no edge authentication is loaded
// and a synthetic caller stands in for every request. The two credential
// arms skip VISIBLY there, carrying the target's stated reason
// (edgeAuthenticationBypass) — never asserting admission, which would pin
// a harness artifact as a contract (D-S1, entry 20260904.02). The
// is_public and health arms hold on every environment regardless.
import { Code } from "@connectrpc/connect";
import { HealthCheckResponse_ServingStatus } from "@stigmer/protos/grpc/health/v1/health_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import { createTarget, type TargetProfile } from "../targets";

// The Java interceptor's refusal copy, byte-pinned on both editions
// (GrpcSecurityConfigBase.java; the TS chassis's
// AUTHENTICATION_TOKEN_MISSING_MESSAGE is the same bytes by contract).
const TOKEN_MISSING_MESSAGE = "authentication token missing";

// Shaped like nothing any verifier issues — not a JWT, not an API key
// prefix — so the arm exercises the unclaimed path on every target rather
// than a verifier's own malformed-token rejection.
const UNCLAIMABLE_CREDENTIAL = "conformance-unclaimable-credential";

let target: TargetProfile;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
});

afterAll(async () => {
  await target?.teardown();
});

// Skips the credential arm, with the target's own reason, where the
// environment's edge is declared bypassed — a visible skip in the roster,
// never a silent pass.
function skipIfEdgeBypassed(ctx: { skip: (note?: string) => never }): void {
  const reason = target.edgeAuthenticationBypass?.();
  if (reason !== undefined) {
    ctx.skip(reason);
  }
}

describe("authentication posture: a request with no credential", () => {
  it("is refused on a non-public method with the byte-pinned copy where authentication is required, admitted as the operator where it is not", async (ctx) => {
    skipIfEdgeBypassed(ctx);
    const anonymous = target.anonymousClients();
    // findMyOrganizations takes Empty and runs no validation — a pure
    // position-1 probe (the same reason the readiness gate uses it).
    if (target.capabilities.requiresAuthentication) {
      const error = await expectGrpcCode(
        () => anonymous.organizationQuery.findMyOrganizations({}),
        Code.Unauthenticated,
        "tokenless findMyOrganizations under the require-authentication posture",
      );
      expect(
        error.rawMessage,
        "the refusal copy is a cross-edition wire constant — clients branch on it",
      ).toBe(TOKEN_MISSING_MESSAGE);
      return;
    }
    const response = await anonymous.organizationQuery.findMyOrganizations({});
    expect(
      Array.isArray(response.entries),
      "trusted-local posture: the tokenless caller IS the operator and the read answers",
    ).toBe(true);
  });

  it("still reaches an is_public method on every target (getServerInfo, the pre-login read)", async () => {
    const info = await target.anonymousClients().platformQuery.getServerInfo({});
    expect(info.edition, "getServerInfo answers the edition without a credential").not.toBe(0);
  });

  it("still reaches the gRPC health service on every target (the Kubernetes grpc-probe contract)", async () => {
    // service "" = the server's overall health, the grpc-go convention
    // Kubernetes probes use when no service name is configured.
    const response = await target.anonymousClients().health.check({ service: "" });
    expect(
      response.status,
      "a tokenless Health/Check must answer SERVING or every grpc probe fails and the pod never becomes Ready",
    ).toBe(HealthCheckResponse_ServingStatus.SERVING);
  });
});

describe("authentication posture: a request with a credential nothing claims", () => {
  it("is refused UNAUTHENTICATED where a verifier is composed, admitted as the operator on verifier-less targets", async (ctx) => {
    skipIfEdgeBypassed(ctx);
    const presenting = target.clientsPresenting(UNCLAIMABLE_CREDENTIAL);
    if (target.capabilities.requiresAuthentication) {
      // Code only: the two editions word this refusal differently by
      // design (Java classifies the parse failure; the TS chassis names the
      // verifier walk). Both refuse — that is the contract.
      await expectGrpcCode(
        () => presenting.organizationQuery.findMyOrganizations({}),
        Code.Unauthenticated,
        "an unclaimable credential under the require-authentication posture",
      );
      return;
    }
    // Zero verifiers: nothing can claim the token, and the O2 ruling-Q6
    // contract falls through SILENTLY to the trusted-local operator — the
    // runner presents a proxy bearer on every control-plane RPC and the
    // single-operator server must keep admitting it.
    const response = await presenting.organizationQuery.findMyOrganizations({});
    expect(
      Array.isArray(response.entries),
      "verifier-less posture: an unclaimed credential falls through to the operator",
    ).toBe(true);
  });
});
