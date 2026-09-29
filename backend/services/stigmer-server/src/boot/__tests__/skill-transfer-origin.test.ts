/**
 * Pins the skill transfer lane's origin (boot/skill-transfer-origin.ts).
 *
 * The base: a configured value wins over any port; a known unified port
 * renders the loopback origin every fixed-port install has always had; an
 * ephemeral one reads the port the listener bound, and a read before the
 * bind throws instead of minting a URL for a port nothing listens on
 * (stigmer#1386).
 *
 * The verdict: loopback on the relay is fine for a single-operator install
 * and a warning under the require-authentication posture, an unset base
 * counting as loopback; a public origin is reachable whatever the posture;
 * a bucket driver makes the base URL unused; an unparseable base URL is
 * not mistaken for loopback.
 */
import { describe, expect, it } from "vitest";

import {
  assessSkillTransferOrigin,
  resolveSkillTransferBaseUrl,
  UNSET_BASE_URL_NOTE,
} from "../skill-transfer-origin.js";

describe("resolveSkillTransferBaseUrl", () => {
  const neverBound = (): number | undefined => undefined;

  it.each([0, 7234])(
    "a configured base wins over a unified port of %d, as given",
    (unifiedPort) => {
      expect(
        resolveSkillTransferBaseUrl({
          configured: "https://api.example.com/",
          unifiedPort,
          boundPort: neverBound,
        }),
      ).toBe("https://api.example.com/");
    },
  );

  it("a known unified port renders the loopback origin once, byte-identical to the retired config default", () => {
    expect(
      resolveSkillTransferBaseUrl({
        configured: "",
        unifiedPort: 7234,
        boundPort: neverBound,
      }),
    ).toBe("http://localhost:7234");
  });

  it("an ephemeral unified port reads the bound port, and throws before the bind", () => {
    let bound: number | undefined;
    const base = resolveSkillTransferBaseUrl({
      configured: "",
      unifiedPort: 0,
      boundPort: () => bound,
    });
    if (typeof base !== "function") {
      throw new Error("an ephemeral unified port must resolve per mint");
    }
    expect(() => base()).toThrow(
      "skill transfer URL requested before the unified port bound",
    );
    bound = 49152;
    expect(base()).toBe("http://localhost:49152");
  });
});

describe("assessSkillTransferOrigin", () => {
  it.each(["", "http://localhost:7234"])(
    "loopback (%j) on a single-operator install is correct",
    (configured) => {
      expect(
        assessSkillTransferOrigin({
          configured,
          relaysThroughServer: true,
          requireAuthentication: false,
        }),
      ).toEqual({ kind: "loopback-local" });
    },
  );

  it.each([
    "http://localhost:7234",
    "http://127.0.0.1:7234",
    "http://[::1]:7234",
    "http://0.0.0.0:7234",
  ])(
    "loopback (%s) under the require-authentication posture is the warning, naming the URL",
    (configured) => {
      expect(
        assessSkillTransferOrigin({
          configured,
          relaysThroughServer: true,
          requireAuthentication: true,
        }),
      ).toEqual({ kind: "loopback-hosted", baseUrl: configured });
    },
  );

  it("an unset base under the require-authentication posture is the warning, naming it unset", () => {
    expect(
      assessSkillTransferOrigin({
        configured: "",
        relaysThroughServer: true,
        requireAuthentication: true,
      }),
    ).toEqual({ kind: "loopback-hosted", baseUrl: UNSET_BASE_URL_NOTE });
  });

  it("a public origin is reachable under either posture", () => {
    for (const requireAuthentication of [true, false]) {
      expect(
        assessSkillTransferOrigin({
          configured: "https://api.example.com",
          relaysThroughServer: true,
          requireAuthentication,
        }),
      ).toEqual({ kind: "reachable" });
    }
  });

  it("a driver that signs its own URLs makes the base URL unused, loopback or not", () => {
    for (const configured of ["", "http://localhost:7234"]) {
      expect(
        assessSkillTransferOrigin({
          configured,
          relaysThroughServer: false,
          requireAuthentication: true,
        }),
      ).toEqual({ kind: "unused" });
    }
  });

  it("an unparseable base URL is not loopback; its failure is loud on the first mint instead", () => {
    expect(
      assessSkillTransferOrigin({
        configured: "not a url",
        relaysThroughServer: true,
        requireAuthentication: true,
      }),
    ).toEqual({ kind: "reachable" });
  });
});
