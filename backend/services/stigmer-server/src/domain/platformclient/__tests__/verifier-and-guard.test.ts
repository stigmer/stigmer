/**
 * Pins the PlatformClient user-token verifier and the origin guard, the two
 * halves of the minting client's contract on every request a token bears:
 *   - the verifier claims only an untyped platform token, passes a foreign
 *     or typed one, refuses a bad one with the envelope's copy, refuses a
 *     token naming no client, refuses a deleted client's token with the
 *     cloud's liveness copy, lets a store fault propagate (never a
 *     revocation), and stamps the account from `sub` as a `user`;
 *   - the guard reads no client for a request without an Origin, passes an
 *     open allowlist and a listed origin case-insensitively, refuses an
 *     unlisted origin and the opaque "null" with the cloud's copy, and
 *     passes every credential that is not an untyped platform user token.
 */
import { generateKeyPairSync } from "node:crypto";

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientQueryController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/query_pb";

import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { signPlatformToken } from "../../../platformtoken/envelope.js";
import { platformTokenKeyRingFromPem } from "../../../platformtoken/key-ring.js";
import type { SigningPlatformTokenKeyRing } from "../../../platformtoken/key-ring.js";
import { DELETED_CLIENT_MESSAGE, originRefusalMessage } from "../constants.js";
import { newPlatformClientOriginGuard } from "../origin-guard.js";
import { newPlatformClientTokenVerifier } from "../verifier.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const built = platformTokenKeyRingFromPem({
  privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [publicKey.export({ format: "pem", type: "spki" }).toString()],
});
if (built.signer === undefined) throw new Error("fixture ring must sign");
const ring: SigningPlatformTokenKeyRing = { ...built, signer: built.signer };

const silent = silentLogger;

function client(allowedOrigins: string[] = []): PlatformClient {
  return create(PlatformClientSchema, {
    metadata: { id: "pcl_dashboard", org: "acme", slug: "dashboard" },
    spec: { clientId: "stgm_cid_x", allowedOrigins },
  });
}

function storeOf(found: PlatformClient | undefined) {
  return { findById: vi.fn(async () => found) };
}

function userToken(claims: Record<string, string> = {}): string {
  return signPlatformToken(ring, {
    sub: "ida_pat",
    email: "pat@example.com",
    name: "Pat",
    platform_client_id: "pcl_dashboard",
    ...claims,
  });
}

function callerWith(rawToken: string): CallerIdentity {
  return { identityId: "ida_pat", callerClass: "user", issuer: "stigmer", rawToken };
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) return error;
    throw error;
  }
  throw new Error("expected a ConnectError refusal");
}

describe("the PlatformClient user-token verifier", () => {
  it("stamps the account the token was minted for as a user, with the asserted profile", async () => {
    const token = userToken();
    const identity = await newPlatformClientTokenVerifier({ keys: ring, clients: storeOf(client()) }).verify(token);
    expect(identity).toEqual({
      identityId: "ida_pat",
      callerClass: "user",
      issuer: "stigmer",
      rawToken: token,
      email: "pat@example.com",
      displayName: "Pat",
    });
  });

  it("passes a foreign token and a typed platform token to the next verifier", async () => {
    const verifier = newPlatformClientTokenVerifier({ keys: ring, clients: storeOf(client()) });
    expect(await verifier.verify("stk_api_key")).toBeNull();
    expect(await verifier.verify(userToken({ token_type: "guest" }))).toBeNull();
  });

  it("refuses a deleted client's token with the liveness copy, and a token naming no client", async () => {
    const gone = await refusal(
      newPlatformClientTokenVerifier({ keys: ring, clients: storeOf(undefined) }).verify(userToken()),
    );
    expect(gone.code).toBe(Code.Unauthenticated);
    expect(gone.rawMessage).toBe(DELETED_CLIENT_MESSAGE);

    const unnamed = await refusal(
      newPlatformClientTokenVerifier({ keys: ring, clients: storeOf(client()) }).verify(
        signPlatformToken(ring, { sub: "ida_pat" }),
      ),
    );
    expect(unnamed.code).toBe(Code.Unauthenticated);
  });

  it("lets a store fault propagate instead of reading it as a revocation", async () => {
    const failing = { findById: vi.fn(async () => { throw new Error("database down"); }) };
    await expect(
      newPlatformClientTokenVerifier({ keys: ring, clients: failing }).verify(userToken()),
    ).rejects.toThrow("database down");
  });
});

describe("the PlatformClient origin guard", () => {
  const method = PlatformClientQueryController.method.get;

  it("reads no client for a request without an Origin header", async () => {
    const clients = storeOf(client(["https://app.example"]));
    const guard = newPlatformClientOriginGuard({ clients, logger: silent });
    await guard.guard(callerWith(userToken()), method, new Headers());
    await guard.guard(callerWith(userToken()), method, new Headers({ origin: "  " }));
    expect(clients.findById).not.toHaveBeenCalled();
  });

  it("passes an open allowlist and a listed origin, compared case-insensitively", async () => {
    await newPlatformClientOriginGuard({ clients: storeOf(client()), logger: silent }).guard(
      callerWith(userToken()),
      method,
      new Headers({ origin: "https://anywhere.example" }),
    );
    await newPlatformClientOriginGuard({
      clients: storeOf(client(["https://app.example"])),
      logger: silent,
    }).guard(callerWith(userToken()), method, new Headers({ origin: "https://APP.example" }));
  });

  it("refuses an unlisted origin and the opaque origin with the cloud's copy", async () => {
    const guard = newPlatformClientOriginGuard({
      clients: storeOf(client(["https://app.example"])),
      logger: silent,
    });
    for (const origin of ["https://evil.example", "null"]) {
      const denied = await refusal(
        guard.guard(callerWith(userToken()), method, new Headers({ origin })),
      );
      expect(denied.code).toBe(Code.PermissionDenied);
      expect(denied.rawMessage).toBe(originRefusalMessage(origin));
    }
  });

  it("passes every credential that is not an untyped platform user token", async () => {
    const clients = storeOf(client(["https://app.example"]));
    const guard = newPlatformClientOriginGuard({ clients, logger: silent });
    const foreign = new Headers({ origin: "https://evil.example" });
    await guard.guard(callerWith("stk_api_key"), method, foreign);
    await guard.guard(callerWith(""), method, foreign);
    await guard.guard(callerWith(userToken({ token_type: "guest" })), method, foreign);
    expect(clients.findById).not.toHaveBeenCalled();
  });
});
