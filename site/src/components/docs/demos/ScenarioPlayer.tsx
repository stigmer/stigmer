"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * A single step in a scenario timeline.
 *
 * @typeParam T - The data shape passed to the render function at this step.
 */
export interface ScenarioStep<T> {
  /** Milliseconds to wait before revealing this step. */
  delayMs: number;
  /** Data snapshot at this point in the timeline. */
  data: T;
}

interface ScenarioPlayerProps<T> {
  /** Ordered steps in the playback timeline. */
  steps: ScenarioStep<T>[];
  /** Render function — receives current step data and step index. */
  children: (data: T, stepIndex: number) => ReactNode;
  /** Auto-play when visible in viewport (default: true). */
  autoPlay?: boolean;
  /** Additional CSS class names for the outer container. */
  className?: string;
}

/**
 * Generic playback engine for timed scenario animations.
 *
 * Manages step timing, viewport-triggered auto-play, and progress indication.
 * Plays through all steps once when the component scrolls into view, then
 * holds on the final state. Resets when scrolled out of view so the
 * animation replays on re-entry.
 *
 * Renders content via a children render prop — the engine knows nothing
 * about what is being displayed.
 *
 * Respects `prefers-reduced-motion` by skipping directly to the final step.
 */
export function ScenarioPlayer<T>({
  steps,
  children,
  autoPlay = true,
  className,
}: ScenarioPlayerProps<T>) {
  const prefersReducedMotion = useReducedMotion();
  const lastIndex = steps.length - 1;

  const [stepIndex, setStepIndex] = useState(() =>
    prefersReducedMotion ? lastIndex : -1,
  );
  const [playing, setPlaying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoPlay || prefersReducedMotion) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStepIndex(-1);
          setPlaying(true);
        } else {
          setPlaying(false);
          setStepIndex(-1);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoPlay, prefersReducedMotion]);

  useEffect(() => {
    if (!playing || prefersReducedMotion || stepIndex >= lastIndex) return;

    const nextIndex = stepIndex + 1;
    const delay = steps[nextIndex].delayMs;
    const timer = setTimeout(() => setStepIndex(nextIndex), delay);
    return () => clearTimeout(timer);
  }, [playing, stepIndex, steps, lastIndex, prefersReducedMotion]);

  const isStarted = stepIndex >= 0;

  return (
    <div ref={containerRef} className={className}>
      {isStarted && children(steps[stepIndex].data, stepIndex)}

      <div className="mt-3 flex items-center px-1">
        <div
          className="flex gap-1.5"
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
        >
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                i <= stepIndex ? "bg-foreground/60" : "bg-foreground/15"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
