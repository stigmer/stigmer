import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeRetryDelay } from "../retry.js";
import type { RetryConfig } from "../types.js";

describe("computeRetryDelay", () => {
  describe("basic delay", () => {
    it("returns zero delay when no delay or backoff is configured", () => {
      const config: RetryConfig = {};
      expect(computeRetryDelay(1, config, 0)).toBe(0);
    });

    it("returns the configured delay in milliseconds", () => {
      const config: RetryConfig = { delay: { seconds: 2 } };
      expect(computeRetryDelay(1, config, 0)).toBe(2_000);
    });

    it("sums all duration fields additively", () => {
      const config: RetryConfig = {
        delay: { seconds: 1, milliseconds: 500 },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_500);
    });

    it("returns the same delay on every attempt when no backoff is configured", () => {
      const config: RetryConfig = { delay: { seconds: 3 } };
      expect(computeRetryDelay(1, config, 0)).toBe(3_000);
      expect(computeRetryDelay(2, config, 3_000)).toBe(3_000);
      expect(computeRetryDelay(3, config, 6_000)).toBe(3_000);
    });
  });

  describe("constant backoff", () => {
    it("keeps the delay constant across attempts", () => {
      const config: RetryConfig = {
        delay: { seconds: 2 },
        backoff: { constant: {} },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(2_000);
      expect(computeRetryDelay(2, config, 2_000)).toBe(2_000);
      expect(computeRetryDelay(5, config, 8_000)).toBe(2_000);
    });

    it("defaults to 1s base delay when backoff is specified without delay", () => {
      const config: RetryConfig = { backoff: { constant: {} } };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
    });
  });

  describe("exponential backoff", () => {
    it("doubles the delay on each attempt", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        backoff: { exponential: {} },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(2, config, 1_000)).toBe(2_000);
      expect(computeRetryDelay(3, config, 3_000)).toBe(4_000);
      expect(computeRetryDelay(4, config, 7_000)).toBe(8_000);
    });

    it("defaults to 1s base delay when no delay is specified", () => {
      const config: RetryConfig = { backoff: { exponential: {} } };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(2, config, 1_000)).toBe(2_000);
    });
  });

  describe("linear backoff", () => {
    it("increases the delay linearly with each attempt", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        backoff: { linear: {} },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(2, config, 1_000)).toBe(2_000);
      expect(computeRetryDelay(3, config, 3_000)).toBe(3_000);
      expect(computeRetryDelay(4, config, 6_000)).toBe(4_000);
    });

    it("defaults to 1s base delay when no delay is specified", () => {
      const config: RetryConfig = { backoff: { linear: {} } };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(3, config, 3_000)).toBe(3_000);
    });
  });

  describe("jitter", () => {
    beforeEach(() => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("adds jitter in the configured range", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        jitter: {
          from: { milliseconds: 100 },
          to: { milliseconds: 500 },
        },
      };
      // delay = 1000 + (100 + 0.5 * (500 - 100)) = 1000 + 300 = 1300
      expect(computeRetryDelay(1, config, 0)).toBe(1_300);
    });

    it("uses from as fixed jitter when to equals from", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        jitter: {
          from: { milliseconds: 200 },
          to: { milliseconds: 200 },
        },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_200);
    });

    it("uses from as fixed jitter when to is less than from", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        jitter: {
          from: { milliseconds: 300 },
          to: { milliseconds: 100 },
        },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_300);
    });

    it("handles jitter with zero from", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        jitter: {
          from: { milliseconds: 0 },
          to: { milliseconds: 1000 },
        },
      };
      // delay = 1000 + (0 + 0.5 * 1000) = 1500
      expect(computeRetryDelay(1, config, 0)).toBe(1_500);
    });

    it("applies jitter on top of backoff", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        backoff: { exponential: {} },
        jitter: {
          from: { milliseconds: 0 },
          to: { milliseconds: 200 },
        },
      };
      // attempt 2: delay = 2000 + (0 + 0.5 * 200) = 2100
      expect(computeRetryDelay(2, config, 1_000)).toBe(2_100);
    });

    it("handles missing from (defaults to zero)", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        jitter: { to: { milliseconds: 400 } },
      };
      // delay = 1000 + (0 + 0.5 * 400) = 1200
      expect(computeRetryDelay(1, config, 0)).toBe(1_200);
    });

    it("handles missing to (uses from as fixed value)", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        jitter: { from: { milliseconds: 150 } },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_150);
    });
  });

  describe("attempt count limit", () => {
    it("allows retries up to the configured count", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        limit: { attempt: { count: 3 } },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(2, config, 1_000)).toBe(1_000);
      expect(computeRetryDelay(3, config, 2_000)).toBe(1_000);
    });

    it("returns null when attempt count is exceeded", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        limit: { attempt: { count: 3 } },
      };
      expect(computeRetryDelay(4, config, 3_000)).toBeNull();
    });

    it("returns null for attempt count of 1 on second attempt", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        limit: { attempt: { count: 1 } },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(2, config, 1_000)).toBeNull();
    });
  });

  describe("total duration limit", () => {
    it("allows retries within the duration budget", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        limit: { duration: { seconds: 5 } },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(2, config, 1_000)).toBe(1_000);
      expect(computeRetryDelay(4, config, 3_000)).toBe(1_000);
    });

    it("returns null when next delay would exceed duration limit", () => {
      const config: RetryConfig = {
        delay: { seconds: 2 },
        limit: { duration: { seconds: 5 } },
      };
      // elapsed=4000, next delay=2000, total would be 6000 > 5000
      expect(computeRetryDelay(3, config, 4_000)).toBeNull();
    });

    it("returns null when already at the duration limit", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        limit: { duration: { seconds: 3 } },
      };
      // elapsed=3000, next delay=1000, total=4000 > 3000
      expect(computeRetryDelay(4, config, 3_000)).toBeNull();
    });
  });

  describe("combined limits", () => {
    it("respects attempt limit before duration limit", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        limit: {
          attempt: { count: 2 },
          duration: { seconds: 10 },
        },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(2, config, 1_000)).toBe(1_000);
      expect(computeRetryDelay(3, config, 2_000)).toBeNull();
    });

    it("respects duration limit before attempt limit", () => {
      const config: RetryConfig = {
        delay: { seconds: 3 },
        limit: {
          attempt: { count: 10 },
          duration: { seconds: 5 },
        },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(3_000);
      expect(computeRetryDelay(2, config, 3_000)).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("never returns a negative delay", () => {
      const config: RetryConfig = { delay: { milliseconds: 0 } };
      expect(computeRetryDelay(1, config, 0)).toBe(0);
    });

    it("handles empty backoff object (no strategy specified)", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        backoff: {},
      };
      expect(computeRetryDelay(1, config, 0)).toBe(1_000);
      expect(computeRetryDelay(2, config, 1_000)).toBe(1_000);
    });

    it("handles config with only limit (no delay)", () => {
      const config: RetryConfig = {
        limit: { attempt: { count: 3 } },
      };
      expect(computeRetryDelay(1, config, 0)).toBe(0);
      expect(computeRetryDelay(3, config, 0)).toBe(0);
      expect(computeRetryDelay(4, config, 0)).toBeNull();
    });

    it("handles large exponential backoff values", () => {
      const config: RetryConfig = {
        delay: { seconds: 1 },
        backoff: { exponential: {} },
      };
      // attempt 10: 2^9 = 512 seconds
      expect(computeRetryDelay(10, config, 0)).toBe(512_000);
    });

    it("rounds fractional jitter to nearest integer", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.33);
      const config: RetryConfig = {
        delay: { seconds: 1 },
        jitter: {
          from: { milliseconds: 0 },
          to: { milliseconds: 100 },
        },
      };
      // 1000 + 0.33 * 100 = 1033
      expect(computeRetryDelay(1, config, 0)).toBe(1_033);
      vi.restoreAllMocks();
    });
  });
});
