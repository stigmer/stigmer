import { useRef } from "react";
import { isPerfLoggingEnabled } from "./enabled.js";

/** Rolling window size for interval statistics. */
const WINDOW_SIZE = 30;

/** Log a sampled line every Nth tick. */
const LOG_EVERY = 10;

/** Mutable state tracked across stream ticks. */
interface StreamRateState {
  tickCount: number;
  /** Timestamps (ms) of recent ticks for interval stats. */
  timestamps: number[];
  /** Message count from the previous tick, for delta calculation. */
  prevMessageCount: number;
}

/**
 * Imperative tracker returned by {@link useStreamRate}.
 *
 * Call `tick()` on each stream snapshot inside the `for await` loop.
 * Call `summary()` when the stream ends to log aggregate stats.
 */
export interface StreamRateTracker {
  /** Record a stream snapshot arrival. */
  tick(messageCount: number): void;
  /** Log aggregate statistics for the completed stream. */
  summary(): void;
}

const NOOP_TRACKER: StreamRateTracker = {
  tick() {},
  summary() {},
};

/**
 * Dev-only hook that returns an imperative {@link StreamRateTracker}.
 *
 * The tracker is designed to be called inside a `useEffect` async
 * loop (not during render), so it uses a ref-backed mutable object
 * rather than React state.
 *
 * Returns a no-op tracker unless perf logging is explicitly enabled
 * (see {@link isPerfLoggingEnabled}) — off by default in every environment.
 */
export function useStreamRate(): StreamRateTracker {
  const stateRef = useRef<StreamRateState | null>(null);

  if (!isPerfLoggingEnabled()) return NOOP_TRACKER;

  if (!stateRef.current) {
    stateRef.current = {
      tickCount: 0,
      timestamps: [],
      prevMessageCount: 0,
    };
  }

  const state = stateRef.current;

  const tracker: StreamRateTracker = {
    tick(messageCount: number) {
      const now = performance.now();
      state.tickCount += 1;
      state.timestamps.push(now);
      if (state.timestamps.length > WINDOW_SIZE) {
        state.timestamps.shift();
      }

      const delta = messageCount - state.prevMessageCount;
      state.prevMessageCount = messageCount;

      if (state.tickCount % LOG_EVERY === 0 || state.tickCount === 1) {
        const intervals = computeIntervals(state.timestamps);
        const parts = [
          `[stgm:perf:stream] tick #${state.tickCount}`,
          `messages=${messageCount}`,
          `delta=+${delta}`,
        ];
        if (intervals) {
          parts.push(
            `interval=${intervals.avg.toFixed(0)}ms`,
            `rate=${intervals.rate.toFixed(1)}/s`,
          );
        }
        console.debug(parts.join("  "));
      }
    },

    summary() {
      if (state.tickCount === 0) return;

      const intervals = computeIntervals(state.timestamps);
      const parts = [
        `[stgm:perf:stream] ✓ stream complete`,
        `totalTicks=${state.tickCount}`,
        `finalMessages=${state.prevMessageCount}`,
      ];
      if (intervals) {
        parts.push(
          `avgInterval=${intervals.avg.toFixed(0)}ms`,
          `minInterval=${intervals.min.toFixed(0)}ms`,
          `maxInterval=${intervals.max.toFixed(0)}ms`,
          `avgRate=${intervals.rate.toFixed(1)}/s`,
        );
      }
      console.debug(parts.join("  "));

      state.tickCount = 0;
      state.timestamps.length = 0;
      state.prevMessageCount = 0;
    },
  };

  return tracker;
}

function computeIntervals(timestamps: number[]) {
  if (timestamps.length < 2) return null;

  let min = Infinity;
  let max = 0;
  let sum = 0;
  const count = timestamps.length - 1;

  for (let i = 1; i < timestamps.length; i++) {
    const dt = timestamps[i] - timestamps[i - 1];
    sum += dt;
    if (dt < min) min = dt;
    if (dt > max) max = dt;
  }

  const avg = sum / count;
  const rate = avg > 0 ? 1000 / avg : 0;

  return { min, max, avg, rate };
}
