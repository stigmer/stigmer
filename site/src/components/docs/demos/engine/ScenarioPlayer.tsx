"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

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
  /** Short label shown below the demo content describing the current action. */
  caption?: string;
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
  /** Fires when the active step changes (after the step is rendered). */
  onStepChange?: (data: T, index: number) => void;
}

/**
 * Generic playback engine for timed scenario animations.
 *
 * Manages step timing, viewport-triggered auto-play, progress indication,
 * and interactive playback controls (pause/play, step forward/backward,
 * clickable progress dots).
 *
 * When the user interacts with controls, auto-play pauses and the user
 * has full manual control. Pressing play resumes auto-advance from the
 * current position.
 *
 * Pauses when scrolled out of view and resumes from the same step on
 * re-entry — content is always rendered so the container height is
 * stable and never causes layout shifts.
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
  onStepChange,
}: ScenarioPlayerProps<T>) {
  const prefersReducedMotion = useReducedMotion();
  const lastIndex = steps.length - 1;

  const [stepIndex, setStepIndex] = useState(() =>
    prefersReducedMotion ? lastIndex : 0,
  );
  const [playing, setPlaying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoPlay || prefersReducedMotion) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setPlaying(entry.isIntersecting);
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

  useEffect(() => {
    onStepChange?.(steps[stepIndex].data, stepIndex);
  }, [stepIndex, steps, onStepChange]);

  const goTo = useCallback(
    (index: number) => {
      setPlaying(false);
      setStepIndex(Math.max(0, Math.min(index, lastIndex)));
    },
    [lastIndex],
  );

  const prev = useCallback(() => {
    if (stepIndex > 0) goTo(stepIndex - 1);
  }, [stepIndex, goTo]);

  const next = useCallback(() => {
    if (stepIndex < lastIndex) goTo(stepIndex + 1);
  }, [stepIndex, lastIndex, goTo]);

  const togglePlay = useCallback(() => {
    if (playing) {
      setPlaying(false);
    } else {
      if (stepIndex >= lastIndex) setStepIndex(0);
      setPlaying(true);
    }
  }, [playing, stepIndex, lastIndex]);

  const caption = steps[stepIndex].caption;

  return (
    <div ref={containerRef} className={className}>
      {children(steps[stepIndex].data, stepIndex)}

      {/* Step caption */}
      <div className="mt-2 flex h-6 items-center justify-center">
        <AnimatePresence mode="wait">
          {caption && (
            <motion.p
              key={caption}
              className="text-sm font-medium text-foreground/70"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {caption}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-1 flex items-center justify-between px-1">
        {/* Playback controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={prev}
            disabled={stepIndex <= 0}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
            aria-label="Previous step"
          >
            <ChevronLeft size={14} />
          </button>

          <button
            onClick={togglePlay}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={12} /> : <Play size={12} />}
          </button>

          <button
            onClick={next}
            disabled={stepIndex >= lastIndex}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
            aria-label="Next step"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Progress dots */}
        <div
          className="flex gap-1.5"
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={steps.length}
        >
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                i <= stepIndex ? "bg-foreground/60" : "bg-foreground/15"
              } hover:bg-foreground/40`}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
