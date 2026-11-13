// How the sign-in asks the server it targets (auth/login.ts, the default
// readServerSignIn): through the backend client with no credential, waiting
// for the server to answer, then reading `authenticationRequired` and
// `native_sign_in` as the CLI's own shape; a server with no native client
// answers none.

import { describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ info: {} as Record<string, unknown>, connect: vi.fn(async () => undefined), tokens: [] as unknown[] }));
vi.mock("../../client/index.js", () => ({
  createBackendClient: (options: { getAccessToken: () => Promise<unknown> }) => {
    backend.tokens.push(options.getAccessToken());
    return { connect: backend.connect, serverInfo: async () => backend.info };
  },
}));

import { defaultLoginDeps } from "../login.js";

const config = { backend: {}, current_backend: "acme", backends: { acme: { type: "selfhost" as const, endpoint: "acme:443" } } };

describe("readServerSignIn", () => {
  it("reads the announced issuer, audience and client, asking with no credential", async () => {
    backend.info = { authenticationRequired: true, nativeSignIn: { issuer: "https://id.acme.test/", audience: "https://api.acme.test/", clientId: "native" } };
    expect(await defaultLoginDeps.readServerSignIn(config)).toEqual({
      authenticationRequired: true,
      nativeSignIn: { issuer: "https://id.acme.test/", audience: "https://api.acme.test/", clientId: "native" },
    });
    expect(backend.connect).toHaveBeenCalled();
    expect(await backend.tokens[0]).toBeNull();
  });

  it("answers no native client when the server announces none", async () => {
    backend.info = { authenticationRequired: false };
    expect(await defaultLoginDeps.readServerSignIn(config)).toEqual({ authenticationRequired: false, nativeSignIn: undefined });
  });
});
