import { describe, it, expect, vi, afterEach } from "vitest";
import {
  StreamingUpdateScheduler,
  UpdateReason,
  loadStreamingConfig,
  type StreamingConfig,
} from "../streaming-scheduler.js";

const BASE_CONFIG: StreamingConfig = {
  minIntervalMs: 500,
  maxIntervalMs: 5000,
  burstThreshold: 50,
};

describe("StreamingUpdateScheduler", () => {
  describe("first update", () => {
    it("always sends on first event", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      expect(s.shouldSendUpdate(1, 0)).toBe(true);
      expect(s.updateReason).toBe(UpdateReason.FIRST_UPDATE);
    });

    it("does not send if zero events processed", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      expect(s.shouldSendUpdate(0, 0)).toBe(false);
    });
  });

  describe("time threshold", () => {
    it("sends after minInterval with at least 1 event", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(0, 0);

      expect(s.shouldSendUpdate(1, 500)).toBe(true);
      expect(s.updateReason).toBe(UpdateReason.TIME_THRESHOLD);
    });

    it("does not send before minInterval", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(0, 0);

      expect(s.shouldSendUpdate(1, 499)).toBe(false);
      expect(s.updateReason).toBe(UpdateReason.NONE);
    });

    it("does not send after minInterval with zero new events", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(5, 0);

      expect(s.shouldSendUpdate(5, 600)).toBe(false);
    });
  });

  describe("burst protection", () => {
    it("sends when burst threshold reached even if time is short", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(0, 0);

      expect(s.shouldSendUpdate(50, 100)).toBe(true);
      expect(s.updateReason).toBe(UpdateReason.BURST_PROTECTION);
    });

    it("does not send at threshold - 1", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(0, 0);

      expect(s.shouldSendUpdate(49, 100)).toBe(false);
    });
  });

  describe("keepalive", () => {
    it("sends after maxInterval even with zero new events", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(10, 0);

      expect(s.shouldSendUpdate(10, 5000)).toBe(true);
      expect(s.updateReason).toBe(UpdateReason.KEEPALIVE);
    });

    it("does not send keepalive before maxInterval", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(10, 0);

      expect(s.shouldSendUpdate(10, 4999)).toBe(false);
    });
  });

  describe("markUpdateSent", () => {
    it("resets time and event counters", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(10, 1000);

      expect(s.shouldSendUpdate(11, 1500)).toBe(true);
      expect(s.updateReason).toBe(UpdateReason.TIME_THRESHOLD);

      s.markUpdateSent(11, 1500);

      expect(s.shouldSendUpdate(12, 1600)).toBe(false);
    });

    it("clears firstCheck flag", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(0, 0);

      // After marking first update sent, subsequent events need time threshold
      expect(s.shouldSendUpdate(1, 100)).toBe(false);
    });
  });

  describe("helper methods", () => {
    it("timeSinceLastUpdateMs returns correct elapsed time", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 100);
      expect(s.timeSinceLastUpdateMs(350)).toBe(250);
    });

    it("eventsSinceLastUpdate returns correct delta", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(10, 0);
      expect(s.eventsSinceLastUpdate(25)).toBe(15);
    });
  });

  describe("priority order", () => {
    it("first_update takes priority over time_threshold", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      // First check with event and enough time — should be FIRST_UPDATE, not TIME_THRESHOLD
      expect(s.shouldSendUpdate(1, 600)).toBe(true);
      expect(s.updateReason).toBe(UpdateReason.FIRST_UPDATE);
    });

    it("time_threshold takes priority over burst_protection", () => {
      const s = new StreamingUpdateScheduler(BASE_CONFIG, 0);
      s.markUpdateSent(0, 0);

      // Both time and burst conditions met — time wins
      expect(s.shouldSendUpdate(50, 500)).toBe(true);
      expect(s.updateReason).toBe(UpdateReason.TIME_THRESHOLD);
    });
  });
});

describe("loadStreamingConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns defaults when no env vars set", () => {
    delete process.env.STREAMING_MIN_INTERVAL_MS;
    delete process.env.STREAMING_MAX_INTERVAL_MS;
    delete process.env.STREAMING_BURST_THRESHOLD;

    const config = loadStreamingConfig();
    expect(config.minIntervalMs).toBe(500);
    expect(config.maxIntervalMs).toBe(5000);
    expect(config.burstThreshold).toBe(50);
  });

  it("reads from environment variables", () => {
    process.env.STREAMING_MIN_INTERVAL_MS = "200";
    process.env.STREAMING_MAX_INTERVAL_MS = "3000";
    process.env.STREAMING_BURST_THRESHOLD = "25";

    const config = loadStreamingConfig();
    expect(config.minIntervalMs).toBe(200);
    expect(config.maxIntervalMs).toBe(3000);
    expect(config.burstThreshold).toBe(25);
  });

  it("falls back to default on invalid values", () => {
    process.env.STREAMING_MIN_INTERVAL_MS = "not-a-number";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadStreamingConfig();
    expect(config.minIntervalMs).toBe(500);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("rejects zero and negative values", () => {
    process.env.STREAMING_BURST_THRESHOLD = "0";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadStreamingConfig();
    expect(config.burstThreshold).toBe(50);
    warnSpy.mockRestore();
  });

  it("clamps max to min when max < min", () => {
    process.env.STREAMING_MIN_INTERVAL_MS = "1000";
    process.env.STREAMING_MAX_INTERVAL_MS = "500";

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const config = loadStreamingConfig();
    expect(config.maxIntervalMs).toBe(1000);
    warnSpy.mockRestore();
  });
});
