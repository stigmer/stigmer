// Platform-client enforcement conformance (entry 20260902.02 Stage 3).
//
// Pins the minting PlatformClient's contract on every serving-edge request
// bearing a PlatformClient-minted USER token — the two controls the Java
// PlatformClientEnforcementInterceptor has always enforced and the
// composition's platform-client caller guard ported (the F1 ruling's
// permanent posture):
//
//   - deletion-revocation (stigmer-cloud#342): deleting a platform client
//     revokes its outstanding user tokens on the NEXT request — refused
//     UNAUTHENTICATED, fail closed. Liveness runs unconditionally BEFORE
//     the origin skip, so revocation can never be sidestepped by omitting
//     an attacker-omittable header;
//   - Origin vs allowed_origins (stigmer/stigmer#375): a browser request
//     from an origin outside the client's allowlist is refused
//     PERMISSION_DENIED — the per-client compensating control for a
//     gateway whose CORS policy deliberately reflects all origins. Absence
//     never refuses on this arm: non-browser callers send no Origin and
//     liveness above is their control.
//
// Refusal copy is byte-pinned across editions (the arms assert exact
// rawMessage bytes) — integrators see identical refusals from the Java
// service and the TS composition. Coverage of both controls was ZERO before
// this suite; that gap is how the enforcement went silently missing from
// the composition through five green readouts (the entry's origin story).
//
// Cloud editions only (the platformClientTokens capability): the local OSS
// targets route no PlatformClient controllers and compose zero caller
// guards — there is no minting lane and no contract to pin, so every arm
// skips (the scheduleFiring posture).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createTransport, makeClients } from "../harness/clients";
import { mintCloudUserToken } from "../harness/cloud-env";
import { FixtureTracker } from "../harness/fixtures";
import { expectGrpcCode } from "../contract/errors";
import { createTarget, type TargetProfile } from "../targets";
import { uniqueName } from "../support/naming";
import {
  cloudGrpcBaseUrl,
  createEnforcementPlatformClient,
  deletePlatformClientById,
} from "../support/platformclients";

// The Java interceptor's UNAUTHENTICATED copy, byte-pinned on both editions
// (PlatformClientEnforcementInterceptor.java and the composition's
// platform-client guard assemble this exact string).
const DELETED_CLIENT_MESSAGE =
  "The platform client that minted this token has been deleted, " +
  "so the token is no longer accepted. Mint a new user token " +
  "from an active platform client.";

// The Java interceptor's PERMISSION_DENIED copy, byte-pinned likewise; the
// refused origin is interpolated raw (origins are public identifiers).
function originRefusalMessage(origin: string): string {
  return (
    `Request origin '${origin}' is not in this platform client's ` +
    "allowed_origins. Add it to the PlatformClient's allowed_origins to " +
    "permit browser requests from this origin."
  );
}

let target: TargetProfile;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function enforcementCapable(): boolean {
  return target.capabilities.platformClientTokens;
}

// Provisions an org (owned by the primary user), a PlatformClient inside it,
// and a fresh user token minted by that client — the complete lane every arm
// starts from. The org and (unless an arm deletes it itself) the client are
// cleaned up in reverse order.
async function provisionMintingLane(options: {
  allowedOrigins?: readonly string[];
  deferClientCleanup: boolean;
}): Promise<{ clientId: string; token: string }> {
  const context = await target.provisionTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  const client = await createEnforcementPlatformClient({
    org: context.org,
    name: uniqueName("enforcement-pc"),
    allowedOrigins: options.allowedOrigins,
  });
  if (options.deferClientCleanup) {
    fixtures.defer(() => deletePlatformClientById(client.id));
  }
  const token = await mintCloudUserToken(
    cloudGrpcBaseUrl(),
    client.credentials,
    uniqueName("enforcement-user"),
  );
  return { clientId: client.id, token };
}

describe("platform-client enforcement — the minting client's contract (cloud editions only)", () => {
  it("deleting the platform client revokes its outstanding user tokens on the next request", async (ctx) => {
    if (!enforcementCapable()) return ctx.skip();
    const lane = await provisionMintingLane({ deferClientCleanup: false });
    const minted = makeClients(
      createTransport(cloudGrpcBaseUrl(), { bearerToken: lane.token }),
    );

    // The token is live before the delete — the probe RPC succeeds for any
    // authenticated caller (findMyOrganizations skips authorization, so a
    // pass/refuse flip here isolates the enforcement, not grants).
    await minted.organizationQuery.findMyOrganizations({});

    await deletePlatformClientById(lane.clientId);

    const denied = await expectGrpcCode(
      () => minted.organizationQuery.findMyOrganizations({}),
      Code.Unauthenticated,
      "request with a deleted platform client's user token",
    );
    expect(denied.rawMessage).toBe(DELETED_CLIENT_MESSAGE);
  });

  it("a browser request from an origin outside allowed_origins is refused", async (ctx) => {
    if (!enforcementCapable()) return ctx.skip();
    const lane = await provisionMintingLane({
      allowedOrigins: ["https://allowed.example"],
      deferClientCleanup: true,
    });
    const foreignBrowser = makeClients(
      createTransport(cloudGrpcBaseUrl(), {
        bearerToken: lane.token,
        origin: "https://evil.example",
      }),
    );

    const denied = await expectGrpcCode(
      () => foreignBrowser.organizationQuery.findMyOrganizations({}),
      Code.PermissionDenied,
      "leaked-token replay from a foreign browser origin",
    );
    expect(denied.rawMessage).toBe(
      originRefusalMessage("https://evil.example"),
    );
  });

  it("a request without an Origin header passes an allowlisted client (absence never refuses)", async (ctx) => {
    if (!enforcementCapable()) return ctx.skip();
    const lane = await provisionMintingLane({
      allowedOrigins: ["https://allowed.example"],
      deferClientCleanup: true,
    });
    const nonBrowser = makeClients(
      createTransport(cloudGrpcBaseUrl(), { bearerToken: lane.token }),
    );

    // Same client, same token, no browser context: liveness ran (the client
    // exists) and the origin arm does not apply — the call must succeed even
    // though allowed_origins is non-empty.
    await nonBrowser.organizationQuery.findMyOrganizations({});
  });
});
