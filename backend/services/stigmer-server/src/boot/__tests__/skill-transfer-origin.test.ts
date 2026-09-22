/**
 * Pins the skill transfer origin verdict (boot/skill-transfer-origin.ts):
 * loopback on the relay is fine for a single-operator install and a
 * warning under the require-authentication posture; a public origin is
 * reachable whatever the posture; a bucket driver makes the base URL
 * unused; an unparseable base URL is not mistaken for loopback.
 */
import { describe, expect, it } from "vitest";

import { assessSkillTransferOrigin } from "../skill-transfer-origin.js";

describe("assessSkillTransferOrigin", () => {
  it("the default loopback on a single-operator install is correct", () => {
    expect(
      assessSkillTransferOrigin({
        baseUrl: "http://localhost:7234",
        relaysThroughServer: true,
        requireAuthentication: false,
      }),
    ).toEqual({ kind: "loopback-local" });
  });

  it.each([
    "http://localhost:7234",
    "http://127.0.0.1:7234",
    "http://[::1]:7234",
    "http://0.0.0.0:7234",
  ])(
    "loopback (%s) under the require-authentication posture is the warning, naming the URL",
    (baseUrl) => {
      expect(
        assessSkillTransferOrigin({
          baseUrl,
          relaysThroughServer: true,
          requireAuthentication: true,
        }),
      ).toEqual({ kind: "loopback-hosted", baseUrl });
    },
  );

  it("a public origin is reachable under either posture", () => {
    for (const requireAuthentication of [true, false]) {
      expect(
        assessSkillTransferOrigin({
          baseUrl: "https://api.example.com",
          relaysThroughServer: true,
          requireAuthentication,
        }),
      ).toEqual({ kind: "reachable" });
    }
  });

  it("a driver that signs its own URLs makes the base URL unused, loopback or not", () => {
    expect(
      assessSkillTransferOrigin({
        baseUrl: "http://localhost:7234",
        relaysThroughServer: false,
        requireAuthentication: true,
      }),
    ).toEqual({ kind: "unused" });
  });

  it("an unparseable base URL is not loopback; its failure is loud on the first mint instead", () => {
    expect(
      assessSkillTransferOrigin({
        baseUrl: "not a url",
        relaysThroughServer: true,
        requireAuthentication: true,
      }),
    ).toEqual({ kind: "reachable" });
  });
});
