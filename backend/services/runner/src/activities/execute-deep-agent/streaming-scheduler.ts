/**
 * Hybrid time + event threshold scheduler for streaming status updates.
 *
 * Addresses the limitations of naive event-count approaches:
 * - Slow operations (30s tool): no update for 30s — user thinks stuck
 * - Fast operations (100 events/sec): 10 updates/sec — wasteful
 *
 * Algorithm:
 *   shouldSendUpdate =
 *     (timeSinceLast >= minInterval AND eventsSinceLast >= 1)
 *     OR (eventsSinceLast >= burstThreshold)
 *     OR (timeSinceLast >= maxInterval)
 *     OR firstUpdate
 *
 * Ported from Python StreamingUpdateScheduler.
 */

export enum UpdateReason {
  TIME_THRESHOLD = "time_threshold",
  BURST_PROTECTION = "burst_protection",
  KEEPALIVE = "keepalive",
  FIRST_UPDATE = "first_update",
  NONE = "none",
}

export interface StreamingConfig {
  /** Minimum time between updates (ms). Rate limit: max ~2 updates/second. */
  readonly minIntervalMs: number;
  /** Maximum time before forced update (ms). Keepalive during long tools. */
  readonly maxIntervalMs: number;
  /** Number of events that triggers immediate update. Burst protection. */
  readonly burstThreshold: number;
}

const DEFAULT_CONFIG: StreamingConfig = {
  minIntervalMs: 500,
  maxIntervalMs: 5000,
  burstThreshold: 50,
};

/**
 * Load streaming config from environment variables with validation.
 * Invalid values fall back to defaults with a console warning.
 */
export function loadStreamingConfig(): StreamingConfig {
  const minIntervalMs = parsePositiveInt(
    process.env.STREAMING_MIN_INTERVAL_MS,
    DEFAULT_CONFIG.minIntervalMs,
    "STREAMING_MIN_INTERVAL_MS",
  );
  let maxIntervalMs = parsePositiveInt(
    process.env.STREAMING_MAX_INTERVAL_MS,
    DEFAULT_CONFIG.maxIntervalMs,
    "STREAMING_MAX_INTERVAL_MS",
  );
  const burstThreshold = parsePositiveInt(
    process.env.STREAMING_BURST_THRESHOLD,
    DEFAULT_CONFIG.burstThreshold,
    "STREAMING_BURST_THRESHOLD",
  );

  if (maxIntervalMs < minIntervalMs) {
    console.warn(
      `STREAMING_MAX_INTERVAL_MS (${maxIntervalMs}) < ` +
      `STREAMING_MIN_INTERVAL_MS (${minIntervalMs}). Setting max to min value.`,
    );
    maxIntervalMs = minIntervalMs;
  }

  return { minIntervalMs, maxIntervalMs, burstThreshold };
}

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  envName: string,
): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    console.warn(
      `Invalid ${envName}='${raw}'. Using default: ${fallback}`,
    );
    return fallback;
  }
  return parsed;
}

export class StreamingUpdateScheduler {
  readonly config: StreamingConfig;

  private lastUpdateTime: number;
  private lastUpdateEvents = 0;
  private lastReason: UpdateReason = UpdateReason.NONE;
  private firstCheck = true;

  /**
   * @param config Scheduling parameters. Defaults to 500ms/5s/50.
   * @param nowMs Injectable clock for testing. Defaults to performance.now().
   */
  constructor(config?: StreamingConfig, nowMs?: number) {
    this.config = config ?? DEFAULT_CONFIG;
    this.lastUpdateTime = nowMs ?? performance.now();
  }

  /**
   * Determine whether a status update should be sent now.
   *
   * Call after processing each event. If this returns true, send the
   * update and then call {@link markUpdateSent}.
   */
  shouldSendUpdate(eventsProcessed: number, nowMs?: number): boolean {
    const now = nowMs ?? performance.now();
    const timeSinceLastMs = now - this.lastUpdateTime;
    const eventsSinceLast = eventsProcessed - this.lastUpdateEvents;

    if (this.firstCheck && eventsSinceLast >= 1) {
      this.lastReason = UpdateReason.FIRST_UPDATE;
      return true;
    }

    if (timeSinceLastMs >= this.config.minIntervalMs && eventsSinceLast >= 1) {
      this.lastReason = UpdateReason.TIME_THRESHOLD;
      return true;
    }

    if (eventsSinceLast >= this.config.burstThreshold) {
      this.lastReason = UpdateReason.BURST_PROTECTION;
      return true;
    }

    if (timeSinceLastMs >= this.config.maxIntervalMs) {
      this.lastReason = UpdateReason.KEEPALIVE;
      return true;
    }

    this.lastReason = UpdateReason.NONE;
    return false;
  }

  /** Reset tracking state after an update was sent. */
  markUpdateSent(eventsProcessed: number, nowMs?: number): void {
    this.lastUpdateTime = nowMs ?? performance.now();
    this.lastUpdateEvents = eventsProcessed;
    this.firstCheck = false;
  }

  get updateReason(): UpdateReason {
    return this.lastReason;
  }

  timeSinceLastUpdateMs(nowMs?: number): number {
    return (nowMs ?? performance.now()) - this.lastUpdateTime;
  }

  eventsSinceLastUpdate(eventsProcessed: number): number {
    return eventsProcessed - this.lastUpdateEvents;
  }
}
