// Unit tests for `stigmer auth login`'s result (commands/auth/login.ts):
// after the browser flow persists the tokens, the command
// runs the SDK's ensureMyIdentityAccount — the console's first-sign-in flow —
// so a CLI-only user is provisioned. loginResult is the pure half: given how
// the account setup went, the CommandResult a person reads.
//
// The tokens are saved BEFORE the account step runs, so a setup failure is a
// warning that says the login itself succeeded and how to finish, never an
// error that makes the person log in again.

import { describe, expect, it } from "vitest";

import { loginResult, serverLabel } from "../login.js";

const CLOUD = { backendName: "cloud", type: "cloud", address: "api.stigmer.ai:443" } as const;
const CLOUD_HINTS = [
  'Run commands against backend "cloud", e.g.:',
  "  stigmer list agents",
];

describe("serverLabel", () => {
  it("names Stigmer Cloud at its own address, and any other server by its host", () => {
    expect(serverLabel(CLOUD)).toBe("Stigmer Cloud");
    expect(serverLabel({ backendName: "dev", type: "cloud", address: "api.dev.stigmer.ai:443" })).toBe(
      "api.dev.stigmer.ai",
    );
    expect(serverLabel({ backendName: "acme", type: "selfhost", address: "stigmer.acme.test:7234" })).toBe(
      "stigmer.acme.test:7234",
    );
  });
});

describe("loginResult", () => {
  it("an existing account: authenticated, with the cloud usage hints", () => {
    const result = loginResult(CLOUD, { status: "ensured", created: false });
    expect(result.status).toBe("success");
    expect(result.message).toBe("Authenticated with Stigmer Cloud");
    expect(result.hints).toEqual(CLOUD_HINTS);
  });

  it("a self-hosted server's sign-in names its host and its backend", () => {
    const result = loginResult(
      { backendName: "acme", type: "selfhost", address: "stigmer.acme.test:7234" },
      { status: "ensured", created: false },
    );
    expect(result.message).toBe("Authenticated with stigmer.acme.test:7234");
    expect(result.hints).toEqual(['Run commands against backend "acme", e.g.:', "  stigmer list agents"]);
  });

  it("a first sign-in says the account was created — visible, never silent", () => {
    const result = loginResult(CLOUD, { status: "ensured", created: true });
    expect(result.status).toBe("success");
    expect(result.message).toBe(
      "Authenticated with Stigmer Cloud — your account was created on this first sign-in",
    );
    expect(result.hints).toEqual(CLOUD_HINTS);
  });

  it("a setup failure is a warning: the login stood, and whoami is the way to finish", () => {
    const result = loginResult(CLOUD, {
      status: "failed",
      message:
        "Failed to fetch user profile from identity provider: userinfo answered 503",
    });
    expect(result.status).toBe("warning");
    expect(result.message).toBe(
      "Authenticated with Stigmer Cloud, but your account could not be set up: " +
        "Failed to fetch user profile from identity provider: userinfo answered 503",
    );
    expect(result.hints).toEqual([
      "Run 'stigmer auth whoami' to finish setting up your account.",
    ]);
  });
});
