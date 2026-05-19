import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEnsureThreadActivities } from "../ensure-thread.js";

vi.mock("../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
}));

describe("EnsureThread activity", () => {
  let EnsureThread: ReturnType<typeof createEnsureThreadActivities>["EnsureThread"];

  beforeEach(() => {
    ({ EnsureThread } = createEnsureThreadActivities());
  });

  describe("factory registration", () => {
    it("exports an activity keyed as 'EnsureThread'", () => {
      const activities = createEnsureThreadActivities();
      expect(activities).toHaveProperty("EnsureThread");
      expect(typeof activities.EnsureThread).toBe("function");
    });

    it("does not export unexpected activity names", () => {
      const activities = createEnsureThreadActivities();
      expect(Object.keys(activities)).toEqual(["EnsureThread"]);
    });
  });

  describe("session-based thread ID", () => {
    it("returns 'thread-{sessionId}' when sessionId is provided", async () => {
      const threadId = await EnsureThread("sess-abc-123", "agent-1");
      expect(threadId).toBe("thread-sess-abc-123");
    });

    it("is deterministic — same sessionId always yields the same threadId", async () => {
      const first = await EnsureThread("sess-xyz", "agent-1");
      const second = await EnsureThread("sess-xyz", "agent-2");
      expect(first).toBe(second);
      expect(first).toBe("thread-sess-xyz");
    });

    it("ignores agentId for session-based threads", async () => {
      const a = await EnsureThread("sess-1", "agent-a");
      const b = await EnsureThread("sess-1", "agent-b");
      expect(a).toBe(b);
    });
  });

  describe("ephemeral thread ID", () => {
    it("returns 'ephemeral-{agentId}-{8hex}' when sessionId is empty", async () => {
      const threadId = await EnsureThread("", "agent-42");
      expect(threadId).toMatch(/^ephemeral-agent-42-[0-9a-f]{8}$/);
    });

    it("generates unique thread IDs across invocations", async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        ids.add(await EnsureThread("", "agent-1"));
      }
      expect(ids.size).toBe(20);
    });

    it("uses the agentId in the ephemeral prefix", async () => {
      const threadId = await EnsureThread("", "my-special-agent");
      expect(threadId).toMatch(/^ephemeral-my-special-agent-[0-9a-f]{8}$/);
    });
  });

  describe("idle watchdog integration", () => {
    it("calls activityStarted and activityFinished", async () => {
      const { activityStarted, activityFinished } = await import("../../idle-watchdog.js");
      await EnsureThread("sess-1", "agent-1");
      expect(activityStarted).toHaveBeenCalled();
      expect(activityFinished).toHaveBeenCalled();
    });

    it("calls activityFinished even on the success path", async () => {
      const { activityStarted, activityFinished } = await import("../../idle-watchdog.js");
      vi.mocked(activityStarted).mockClear();
      vi.mocked(activityFinished).mockClear();

      await EnsureThread("", "agent-1");

      expect(activityStarted).toHaveBeenCalledTimes(1);
      expect(activityFinished).toHaveBeenCalledTimes(1);
    });
  });

  describe("proxy authorization compatibility", () => {
    it("produces thread IDs that match the 'thread-' prefix convention", async () => {
      const threadId = await EnsureThread("session-id-123", "agent-1");
      expect(threadId.startsWith("thread-")).toBe(true);
      expect(threadId.substring("thread-".length)).toBe("session-id-123");
    });
  });
});
