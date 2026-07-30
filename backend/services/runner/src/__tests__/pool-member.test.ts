import { describe, it, expect, afterEach } from "vitest";
import {
  decidePoolBoot,
  registerPoolMemberContext,
  getPoolMemberContext,
  clearPoolMemberContext,
  type PoolAttachTarget,
} from "../pool-member.js";

/** Build an unsigned JWT-shaped token with the given payload. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

const noopManager: PoolAttachTarget = {
  addSession: async () => {},
  updateToken: () => {},
};

describe("decidePoolBoot", () => {
  it("polls the control queue with a fresh pool_sandbox credential", () => {
    const intent = decidePoolBoot(fakeJwt({ token_type: "pool_sandbox", pool_member_id: "pm_1" }));
    expect(intent).toEqual({ kind: "pool-control" });
  });

  it("resumes the claimed session when the Secret already holds a session token (post-claim restart)", () => {
    const intent = decidePoolBoot(fakeJwt({ token_type: "sandbox", session_id: "ses_9" }));
    expect(intent).toEqual({ kind: "claimed-session", sessionId: "ses_9" });
  });

  it("rejects a session token without a session_id claim", () => {
    const intent = decidePoolBoot(fakeJwt({ token_type: "sandbox" }));
    expect(intent.kind).toBe("invalid");
  });

  it("rejects every other credential class rather than guessing", () => {
    // Booting a pool member with the wrong token class is a provisioning bug;
    // serving anything on a guess would hand the pod a scope it must not have.
    expect(decidePoolBoot(fakeJwt({ token_type: "embedded_runner" })).kind).toBe("invalid");
    expect(decidePoolBoot(fakeJwt({ token_type: "workflow_sandbox" })).kind).toBe("invalid");
    expect(decidePoolBoot(fakeJwt({ sub: "user-1" })).kind).toBe("invalid");
    expect(decidePoolBoot(null).kind).toBe("invalid");
    expect(decidePoolBoot("not-a-jwt").kind).toBe("invalid");
  });

  it("names the offending token_type in the rejection reason", () => {
    const intent = decidePoolBoot(fakeJwt({ token_type: "embedded_runner" }));
    expect(intent.kind === "invalid" && intent.reason).toContain("embedded_runner");
  });
});

describe("pool member context registry", () => {
  afterEach(() => {
    clearPoolMemberContext();
  });

  it("is undefined outside a pool member (the inert default)", () => {
    expect(getPoolMemberContext()).toBeUndefined();
  });

  it("returns the registered context after pool boot", () => {
    registerPoolMemberContext({ memberId: "pm_1", poolToken: "tok", manager: noopManager });

    const ctx = getPoolMemberContext();
    expect(ctx?.memberId).toBe("pm_1");
    expect(ctx?.poolToken).toBe("tok");
  });

  it("clears for test isolation", () => {
    registerPoolMemberContext({ memberId: "pm_1", poolToken: "tok", manager: noopManager });
    clearPoolMemberContext();
    expect(getPoolMemberContext()).toBeUndefined();
  });
});
