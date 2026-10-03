import { createServer, type Http2Session } from "node:http2";
import type { AddressInfo } from "node:net";

import { connectNodeAdapter } from "@connectrpc/connect-node";
import { describe, it, expect } from "vitest";

import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import type { MintUserTokenRequest } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";

import {
  createPlatformClientAuth,
  PlatformClientAuth,
} from "../platform-client-auth";

describe("createPlatformClientAuth", () => {
  it("throws when baseUrl is missing", () => {
    expect(() =>
      createPlatformClientAuth({
        baseUrl: "",
        clientId: "stgm_cid_abc",
        clientSecret: "stgm_cs_xyz",
      }),
    ).toThrow("baseUrl is required");
  });

  it("throws when clientId is missing", () => {
    expect(() =>
      createPlatformClientAuth({
        baseUrl: "https://api.stigmer.ai",
        clientId: "",
        clientSecret: "stgm_cs_xyz",
      }),
    ).toThrow("clientId is required — find it in the Stigmer Console under Settings > Platform Clients");
  });

  it("throws when clientSecret is missing", () => {
    expect(() =>
      createPlatformClientAuth({
        baseUrl: "https://api.stigmer.ai",
        clientId: "stgm_cid_abc",
        clientSecret: "",
      }),
    ).toThrow(/clientSecret is required.*rotate it in the Stigmer Console \(Settings > Platform Clients\)/);
  });

  it("returns a PlatformClientAuth instance with valid config", () => {
    const auth = createPlatformClientAuth({
      baseUrl: "https://api.stigmer.ai",
      clientId: "stgm_cid_abc",
      clientSecret: "stgm_cs_xyz",
    });
    expect(auth).toBeInstanceOf(PlatformClientAuth);
  });
});

describe("PlatformClientAuth.mintUserToken", () => {
  it("throws StigmerError when userId is empty", async () => {
    const auth = createPlatformClientAuth({
      baseUrl: "https://api.stigmer.ai",
      clientId: "stgm_cid_abc",
      clientSecret: "stgm_cs_xyz",
    });

    await expect(
      auth.mintUserToken({ userId: "" }),
    ).rejects.toThrow("userId is required");
  });

  it("throws StigmerError with invalid-argument code when userId is empty", async () => {
    const auth = createPlatformClientAuth({
      baseUrl: "https://api.stigmer.ai",
      clientId: "stgm_cid_abc",
      clientSecret: "stgm_cs_xyz",
    });

    try {
      await auth.mintUserToken({ userId: "" });
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect(e).toHaveProperty("code", "invalid-argument");
      expect(e).toHaveProperty("name", "StigmerError");
    }
  });
});

describe("PlatformClientAuth.mintUserToken on the wire", () => {
  /** A local gRPC-web server for the token service over cleartext HTTP/2 (the transport speaks HTTP/2), capturing the last request it received. */
  async function tokenServer(seen: { request?: MintUserTokenRequest }): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const handler = connectNodeAdapter({
      routes: (router) =>
        router.service(PlatformClientTokenController, {
          mintUserToken: (req) => {
            seen.request = req;
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

  it.each([
    ["names the organization the token is scoped to as org", { org: "acme" }, "acme"],
    ["sends an empty org when none is named (the client's own organization)", {}, ""],
  ] as const)("%s", async (_title, extra, expected) => {
    const seen: { request?: MintUserTokenRequest } = {};
    const server = await tokenServer(seen);
    try {
      const auth = createPlatformClientAuth({ baseUrl: server.baseUrl, clientId: "pc_1", clientSecret: "secret" });
      const token = await auth.mintUserToken({ userId: "user-1", ...extra });
      expect(token.accessToken).toBe("minted");
      expect(seen.request?.org).toBe(expected);
    } finally {
      await server.close();
    }
  });
});
