"use client";

import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { isPerfLoggingEnabled } from "./enabled.js";

/** Log every Nth commit to avoid console flood during streaming. */
const LOG_EVERY = 10;

let commitCount = 0;

const onRender: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
) => {
  commitCount += 1;
  if (commitCount % LOG_EVERY === 0 || commitCount === 1) {
    console.debug(
      `[stgm:perf:profiler] ${id}  phase=${phase}  ` +
        `actualDuration=${actualDuration.toFixed(1)}ms  ` +
        `baseDuration=${baseDuration.toFixed(1)}ms`,
    );
  }
};

/**
 * Thin wrapper around React's `<Profiler>`.
 *
 * In dev mode, logs commit-level timing (`actualDuration`,
 * `baseDuration`, mount vs update phase) with sampled output.
 *
 * Off by default in every environment (and always in production) — enable via
 * {@link isPerfLoggingEnabled}'s opt-in flags. When disabled, children render
 * with zero Profiler overhead.
 */
export function DevProfiler({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}) {
  if (!isPerfLoggingEnabled()) return children;

  return (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  );
}
