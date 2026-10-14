/**
 * Pins the token client (../tokens.ts): an empty organization or user id
 * is refused before any request, as a StigmerError; on the wire the
 * request carries the organization and the person, and the answer comes
 * back with its absolute expiry; a server refusal surfaces as a
 * StigmerError with its code.
 */
import { createServer, type Http2Session } from "node:http2";
import type { AddressInfo } from "node:net";

import { Code, ConnectError } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcWebTransport } from "@connectrpc/connect-node";
import { describe, expect, it } from "vitest";

import { TokenService } from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";
import type { MintUserTokenRequest } from "@stigmer/protos/ai/stigmer/iam/token/v1/token_pb";

import { TokenClient } from "../tokens";

/** A local gRPC-web server for the token service over cleartext HTTP/2, capturing the last request it received. */
async function tokenServer(
  seen: { request?: MintUserTokenRequest },
  refuse = false,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const handler = connectNodeAdapter({
    routes: (router) =>
      router.service(TokenService, {
        mintUserToken: (req) => {
          seen.request = req;
          if (refuse) {
            throw new ConnectError("not a service account", Code.PermissionDenied);
          }
          return { accessToken: "minted", tokenType: "Bearer", expiresIn: 60 };
        },
      }),
  });
  const server = createServer(handler);
  const sessions = new Set<Http2Session>();
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    // The client keeps its HTTP/2 session open; close it, or the server never finishes closing.
    close: () =>
      new Promise<void>((resolve) => {
        for (const session of sessions) session.close();
        server.close(() => resolve());
      }),
  };
}

function clientFor(baseUrl: string): TokenClient {
  return new TokenClient(createGrpcWebTransport({ baseUrl, httpVersion: "2" }));
}

describe("TokenClient.mintUserToken", () => {
  it.each([
    ["an empty org", { org: "", userId: "user-1" }, /org is required/],
    ["an empty userId", { org: "acme", userId: "" }, /userId is required/],
  ] as const)("refuses %s before any request", async (_title, input, message) => {
    const seen: { request?: MintUserTokenRequest } = {};
    const server = await tokenServer(seen);
    try {
      await expect(clientFor(server.baseUrl).mintUserToken(input)).rejects.toMatchObject({
        name: "StigmerError",
        code: "invalid-argument",
        message: expect.stringMatching(message),
      });
      expect(seen.request).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("sends the organization and the person, and answers the token with its expiry", async () => {
    const seen: { request?: MintUserTokenRequest } = {};
    const server = await tokenServer(seen);
    try {
      const before = Date.now();
      const token = await clientFor(server.baseUrl).mintUserToken({
        org: "acme",
        userId: "user-1",
        userEmail: "pat@example.com",
        userName: "Pat Lee",
      });
      expect(token).toMatchObject({ accessToken: "minted", tokenType: "Bearer", expiresIn: 60 });
      expect(token.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
      expect(seen.request).toMatchObject({
        org: "acme",
        userId: "user-1",
        userEmail: "pat@example.com",
        userName: "Pat Lee",
      });
    } finally {
      await server.close();
    }
  });

  it("surfaces a server refusal as a StigmerError with its code", async () => {
    const server = await tokenServer({}, true);
    try {
      await expect(
        clientFor(server.baseUrl).mintUserToken({ org: "acme", userId: "user-1" }),
      ).rejects.toMatchObject({ name: "StigmerError", code: "permission-denied" });
    } finally {
      await server.close();
    }
  });
});
