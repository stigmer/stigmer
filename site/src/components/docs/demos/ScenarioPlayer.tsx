"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "framer-motion";
import { RotateCcw } from "lucide-react";

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
 * Manages step timing, viewport-triggered auto-play, progress indication,
 * and replay. Renders content via a children render prop — the engine
 * knows nothing about what is being displayed.
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
  const observedRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoPlay || observedRef.current || prefersReducedMotion) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observedRef.current = true;
          setPlaying(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [autoPlay, prefersReducedMotion]);

  useEffect(() => {
    if (!playing || stepIndex >= lastIndex) {
      if (stepIndex >= lastIndex) setPlaying(false);
      return;
    }

    const nextIndex = stepIndex + 1;
    const delay = steps[nextIndex].delayMs;
    const timer = setTimeout(() => setStepIndex(nextIndex), delay);
    return () => clearTimeout(timer);
  }, [playing, stepIndex, steps, lastIndex]);

  const replay = useCallback(() => {
    setStepIndex(-1);
    setPlaying(true);
  }, []);

  const isComplete = stepIndex >= lastIndex;
  const isStarted = stepIndex >= 0;

  return (
    <div ref={containerRef} className={className}>
      {isStarted && children(steps[stepIndex].data, stepIndex)}

      <div className="mt-3 flex items-center justify-between px-1">
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
        {isComplete && (
          <button
            onClick={replay}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Replay scenario"
          >
            <RotateCcw size={12} />
            Replay
          </button>
        )}
      </div>
    </div>
  );
}
