/**
 * Pins the runner-token contract: mint/verify round-trip with the exact
 * claim names (wire contract with the runner's token-claims.ts), the
 * single-error fail-closed verify (every failure = InvalidTokenError, no
 * reason leakage), alg-confusion refusal via the encoded-header pin,
 * constant-time signature comparison including the Node length-mismatch
 * guard, and the `now >= exp` expiry boundary. Ports
 * pkg/runnerauth/runnerauth_test.go plus the T01 plan's adversarial arms.
 */
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_TTL_SECONDS,
  InvalidTokenError,
  MintingDisabledError,
  RunnerAuthService,
  TOKEN_TYPE_EXECUTION_SCOPED,
} from "../runnerauth.js";

const KEY = Buffer.alloc(32, 9);
const OTHER_KEY = Buffer.alloc(32, 10);

function service(): RunnerAuthService {
  return RunnerAuthService.create(KEY);
}

afterEach(() => {
  vi.useRealTimers();
});

describe("mint", () => {
  it("round-trips: a minted token verifies to its execution id", () => {
    const svc = service();
    const { token, ttlSeconds } = svc.mint("agx_01exec");
    expect(ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
    expect(svc.verify(token)).toBe("agx_01exec");
  });

  it("carries the exact wire-contract claim names and values", () => {
    const { token } = service().mint("wfx_01exec", 120);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    const header = JSON.parse(
      Buffer.from(parts[0] as string, "base64url").toString("utf8"),
    ) as Record<string, string>;
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    const claims = JSON.parse(
      Buffer.from(parts[1] as string, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(claims["token_type"]).toBe(TOKEN_TYPE_EXECUTION_SCOPED);
    expect(claims["execution_id"]).toBe("wfx_01exec");
    expect(claims["exp"]).toBe((claims["iat"] as number) + 120);
  });

  it("applies the default TTL when ttl <= 0", () => {
    expect(service().mint("id", 0).ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
    expect(service().mint("id", -5).ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
  });

  it("requires a non-empty execution id", () => {
    expect(() => service().mint("")).toThrow(
      "execution id is required to mint a runner token",
    );
  });

  it("fails with MintingDisabledError on a keyless service", () => {
    expect(() => RunnerAuthService.create(undefined).mint("id")).toThrow(
      MintingDisabledError,
    );
  });
});

describe("verify (every failure collapses to InvalidTokenError)", () => {
  it("rejects everything on a keyless service (fail closed)", () => {
    const token = service().mint("id").token;
    expect(() => RunnerAuthService.create(undefined).verify(token)).toThrow(
      InvalidTokenError,
    );
  });

  it("rejects malformed tokens (wrong part count)", () => {
    const svc = service();
    for (const bad of ["", "a", "a.b", "a.b.c.d"]) {
      expect(() => svc.verify(bad)).toThrow(InvalidTokenError);
    }
  });

  it("refuses alg confusion via the encoded-header pin (alg:none)", () => {
    const svc = service();
    const { token } = svc.mint("id");
    const [, payload, sig] = token.split(".");
    const noneHeader = Buffer.from('{"alg":"none","typ":"JWT"}').toString(
      "base64url",
    );
    expect(() => svc.verify(`${noneHeader}.${payload}.${sig}`)).toThrow(
      InvalidTokenError,
    );
    // Even a semantically identical header with different key order is
    // refused — the compare is on the ENCODED form, never parsed JSON.
    const reordered = Buffer.from('{"typ":"JWT","alg":"HS256"}').toString(
      "base64url",
    );
    expect(() => svc.verify(`${reordered}.${payload}.${sig}`)).toThrow(
      InvalidTokenError,
    );
  });

  it("rejects a token signed with a different key", () => {
    const foreign = RunnerAuthService.create(OTHER_KEY).mint("id").token;
    expect(() => service().verify(foreign)).toThrow(InvalidTokenError);
  });

  it("rejects a tampered payload (signature binds the exact bytes)", () => {
    const svc = service();
    const { token } = svc.mint("id");
    const [header, , sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        token_type: TOKEN_TYPE_EXECUTION_SCOPED,
        execution_id: "someone-elses-execution",
        iat: 0,
        exp: 9999999999,
      }),
    ).toString("base64url");
    expect(() => svc.verify(`${header}.${forged}.${sig}`)).toThrow(
      InvalidTokenError,
    );
  });

  it("survives a length-mismatched signature (Node timingSafeEqual guard)", () => {
    const svc = service();
    const { token } = svc.mint("id");
    const [header, payload] = token.split(".");
    // Without the length guard this would THROW a RangeError out of
    // timingSafeEqual instead of the contract's InvalidTokenError.
    expect(() => svc.verify(`${header}.${payload}.abc`)).toThrow(
      InvalidTokenError,
    );
  });

  it("rejects a wrong token_type and an empty execution_id", () => {
    const svc = service();
    // Forge claims and re-sign with the REAL key via a same-key service —
    // only the claim checks can reject these.
    const forge = (claims: Record<string, unknown>): string => {
      const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString(
        "base64url",
      );
      const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
      const sig = createHmac("sha256", KEY)
        .update(`${header}.${payload}`)
        .digest("base64url");
      return `${header}.${payload}.${sig}`;
    };
    const now = Math.floor(Date.now() / 1000);
    expect(() =>
      svc.verify(
        forge({ token_type: "sandbox", execution_id: "id", iat: now, exp: now + 60 }),
      ),
    ).toThrow(InvalidTokenError);
    expect(() =>
      svc.verify(
        forge({
          token_type: TOKEN_TYPE_EXECUTION_SCOPED,
          execution_id: "",
          iat: now,
          exp: now + 60,
        }),
      ),
    ).toThrow(InvalidTokenError);
  });

  it("expires at the boundary: now >= exp is invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00Z"));
    const svc = service();
    const { token } = svc.mint("id", 60);

    vi.setSystemTime(new Date("2026-08-23T12:00:59Z"));
    expect(svc.verify(token)).toBe("id"); // one second before exp — valid

    vi.setSystemTime(new Date("2026-08-23T12:01:00Z"));
    expect(() => svc.verify(token)).toThrow(InvalidTokenError); // exp second — invalid
  });
});
