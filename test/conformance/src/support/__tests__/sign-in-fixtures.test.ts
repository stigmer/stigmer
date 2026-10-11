// Unit arms for the sign-in fixture builders the suites create login apps
// with.
// - A login app lists one address of its own by default, unique per app
//   name, so two apps of one organization never claim the same address;
//   given addresses and an account endpoint replace the defaults.
// Pure: hand-built shapes, no target.
// Domain: conformance support (sign-in).
import { describe, expect, it } from "vitest";

import { defaultOAuthAppAddress, makeOAuthApp } from "../oauthapps";

describe("makeOAuthApp", () => {
  it("lists one address of its own by default, unique per app name", () => {
    expect(makeOAuthApp("acme", "Slack App").spec?.addresses).toEqual([defaultOAuthAppAddress("Slack App")]);
    expect(defaultOAuthAppAddress("Slack App")).not.toBe(defaultOAuthAppAddress("Figma App"));
    expect(makeOAuthApp("acme", "Slack App").spec?.userinfoUrl).toBeUndefined();
  });

  it("takes the addresses and the account endpoint a test gives", () => {
    const app = makeOAuthApp("acme", "GitHub", { addresses: ["github.com"], userinfoUrl: "https://api.github.test/user" });
    expect(app.spec?.addresses).toEqual(["github.com"]);
    expect(app.spec?.userinfoUrl).toBe("https://api.github.test/user");
  });
});
