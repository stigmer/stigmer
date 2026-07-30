import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Config } from "../../config.js";
import type { PoolAttachTarget } from "../../pool-member.js";

/**
 * The activity factory constructs a real StigmerClient; mock the module so no
 * transport is opened and the exchange call is observable.
 */
const getRunnerScopedToken = vi.fn();
vi.mock("../../client/stigmer-client.js", () => ({
  StigmerClient: class {
    getRunnerScopedToken = getRunnerScopedToken;
  },
}));

import { createAttachSessionActivities } from "../attach-session.js";
import {
  registerPoolMemberContext,
  clearPoolMemberContext,
} from "../../pool-member.js";

const config = {
  stigmerBackendEndpoint: "http://localhost:7234",
  stigmerToken: "pool-tok",
} as unknown as Config;

function fakeManager(): PoolAttachTarget & {
  addSession: ReturnType<typeof vi.fn>;
  updateToken: ReturnType<typeof vi.fn>;
} {
  return {
    addSession: vi.fn().mockResolvedValue(undefined),
    updateToken: vi.fn(),
  };
}

describe("attach-session activities", () => {
  beforeEach(() => {
    getRunnerScopedToken.mockReset();
  });

  afterEach(() => {
    clearPoolMemberContext();
  });

  describe("outside a pool member (inert state)", () => {
    it("ProbePoolMember fails fast without a pool context", async () => {
      const { ProbePoolMember } = createAttachSessionActivities(config);
      await expect(ProbePoolMember()).rejects.toThrow(/outside a pool member/);
    });

    it("AttachSession fails fast without a pool context", async () => {
      const { AttachSession } = createAttachSessionActivities(config);
      await expect(AttachSession("ses_1")).rejects.toThrow(/outside a pool member/);
      expect(getRunnerScopedToken).not.toHaveBeenCalled();
    });
  });

  describe("ProbePoolMember", () => {
    it("returns the member id as proof of polling", async () => {
      registerPoolMemberContext({
        memberId: "pm_1", poolToken: "pool-tok", manager: fakeManager(),
      });
      const { ProbePoolMember } = createAttachSessionActivities(config);

      await expect(ProbePoolMember()).resolves.toBe("pm_1");
    });
  });

  describe("AttachSession", () => {
    it("exchanges with the pool credential, applies the session token, then adds the session", async () => {
      const manager = fakeManager();
      registerPoolMemberContext({ memberId: "pm_1", poolToken: "pool-tok", manager });
      getRunnerScopedToken.mockResolvedValue({ token: "session-tok", expiresInSeconds: 90000 });
      const { AttachSession } = createAttachSessionActivities(config);

      const ack = await AttachSession("ses_1");

      expect(ack).toBe("session:ses_1");
      expect(getRunnerScopedToken).toHaveBeenCalledWith(
        { poolClaimSessionId: "ses_1" },
        "pool-tok",
      );
      expect(manager.updateToken).toHaveBeenCalledWith("session-tok");
      expect(manager.addSession).toHaveBeenCalledWith("ses_1");
      // The session worker must poll with the session credential already in
      // place — a reversed order would serve the first activity with the
      // powerless pool token.
      expect(manager.updateToken.mock.invocationCallOrder[0]!)
        .toBeLessThan(manager.addSession.mock.invocationCallOrder[0]!);
    });

    it("rejects an empty session id", async () => {
      registerPoolMemberContext({
        memberId: "pm_1", poolToken: "pool-tok", manager: fakeManager(),
      });
      const { AttachSession } = createAttachSessionActivities(config);

      await expect(AttachSession("")).rejects.toThrow(/requires a session id/);
    });

    it("fails hard when the server mints nothing — a pool token cannot serve session work", async () => {
      const manager = fakeManager();
      registerPoolMemberContext({ memberId: "pm_1", poolToken: "pool-tok", manager });
      getRunnerScopedToken.mockResolvedValue(undefined);
      const { AttachSession } = createAttachSessionActivities(config);

      await expect(AttachSession("ses_1")).rejects.toThrow(/minted no session token/);
      expect(manager.updateToken).not.toHaveBeenCalled();
      expect(manager.addSession).not.toHaveBeenCalled();
    });

    it("propagates an exchange failure so the control plane discards the member", async () => {
      const manager = fakeManager();
      registerPoolMemberContext({ memberId: "pm_1", poolToken: "pool-tok", manager });
      getRunnerScopedToken.mockRejectedValue(new Error("claim not found"));
      const { AttachSession } = createAttachSessionActivities(config);

      await expect(AttachSession("ses_1")).rejects.toThrow("claim not found");
      expect(manager.addSession).not.toHaveBeenCalled();
    });

    it("propagates a session-worker failure after the token was applied", async () => {
      const manager = fakeManager();
      manager.addSession.mockRejectedValue(new Error("worker create failed"));
      registerPoolMemberContext({ memberId: "pm_1", poolToken: "pool-tok", manager });
      getRunnerScopedToken.mockResolvedValue({ token: "session-tok" });
      const { AttachSession } = createAttachSessionActivities(config);

      await expect(AttachSession("ses_1")).rejects.toThrow("worker create failed");
    });
  });
});
