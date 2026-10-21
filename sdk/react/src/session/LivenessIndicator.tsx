"use client";

import { useEffect, useState } from "react";
import type { TurnLiveness } from "@stigmer/client";
import { humanizeToolName } from "../run/tool-categories.js";

/**
 * How long the turn's oldest operation, or its wait on the model, must have
 * lasted before the strip shows it. Shorter work already shows in the thread
 * (a tool row's spinner, a message as it streams); the strip is for the long
 * stretch a person would otherwise read as nothing happening.
 */
export const LIVENESS_SHOW_AFTER_MS = 10_000;

/**
 * What a working turn is doing, in a few words: "Running Shell · 14 min" for
 * its oldest open operation ("and 2 more" when others run beside it), or
 * "Waiting on the model · 2 min". `sinceMs` is the time since the preview
 * arrived: its ages are the runner's, measured when it sent it, so they tick
 * on from the arrival on this clock, never from a comparison of the two
 * clocks. `undefined` while nothing has run for {@link LIVENESS_SHOW_AFTER_MS}.
 */
export function livenessLabel(liveness: TurnLiveness, sinceMs: number): string | undefined {
  const [oldest, ...others] = liveness.operations;
  if (oldest !== undefined) {
    const age = oldest.elapsedMs + sinceMs;
    if (age < LIVENESS_SHOW_AFTER_MS) return undefined;
    const more = others.length > 0 ? ` and ${others.length} more` : "";
    return `Running ${humanizeToolName(oldest.name)}${more} · ${spanWords(age)}`;
  }
  if (liveness.awaitingModelMs === undefined) return undefined;
  const age = liveness.awaitingModelMs + sinceMs;
  return age < LIVENESS_SHOW_AFTER_MS ? undefined : `Waiting on the model · ${spanWords(age)}`;
}

/** A span the way the strip says it: seconds under a minute, minutes under an hour, then hours and minutes. */
export function spanWords(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * The live turn's liveness strip, docked where the slow-stream hint sits: it
 * says what the turn is running and for how long while the turn's liveness
 * previews keep arriving (`stigmer.run.liveness`, every 30 s by default).
 * Ticks once a second from the newest preview's arrival. Renders nothing
 * until something has run for {@link LIVENESS_SHOW_AFTER_MS}.
 */
export function LivenessIndicator({ liveness }: { readonly liveness: TurnLiveness }) {
  const [arrivedAt, setArrivedAt] = useState(() => Date.now());
  const [now, setNow] = useState(arrivedAt);
  useEffect(() => {
    const at = Date.now();
    setArrivedAt(at);
    setNow(at);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [liveness]);
  const label = livenessLabel(liveness, Math.max(0, now - arrivedAt));
  if (label === undefined) return null;
  return (
    <div
      role="status"
      aria-live="off"
      className="stg:flex stg:items-center stg:gap-2 stg:border-t stg:border-border-muted stg:px-4 stg:py-1.5 stg:text-xs stg:text-muted-foreground"
    >
      <span className="stg:relative stg:flex stg:h-2 stg:w-2 stg:shrink-0" aria-hidden="true">
        <span className="stg:relative stg:inline-flex stg:h-2 stg:w-2 stg:rounded-full stg:bg-muted-foreground" />
      </span>
      <span className="stg:min-w-0 stg:flex-1 stg:truncate">{label}</span>
    </div>
  );
}
