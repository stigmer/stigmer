"use client";

import { useEffect, useRef, useState } from "react";
import type { LayoutEngine } from "./types.js";
import { createElkLayoutEngine } from "./elk-layout-engine.js";
import type { ElkLayoutEngineOptions } from "./elk-layout-engine.js";

/**
 * Options for {@link useElkLayoutEngine}.
 */
export interface UseElkLayoutEngineOptions {
  /**
   * Factory function that creates a Web Worker for off-main-thread layout.
   *
   * When provided, ELK uses the lightweight ~5KB API stub on the main thread
   * and delegates the ~1.5MB WASM computation to the worker.
   *
   * When omitted, ELK loads the full bundled WASM on the main thread
   * (async but blocking during computation).
   *
   * @example
   * ```ts
   * const workerFactory = () =>
   *   new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url));
   * ```
   */
  readonly workerFactory?: () => Worker;
  /**
   * Additional ELK layout options to merge with workflow defaults.
   * @see https://eclipse.dev/elk/reference/options.html
   */
  readonly layoutOptions?: Record<string, string>;
  /**
   * When `false`, skip engine creation entirely and return `null`.
   * Useful for conditional activation (e.g., feature flags).
   * @default true
   */
  readonly enabled?: boolean;
}

/**
 * Behavior hook (DD-003 layer 2) that asynchronously creates an ELK layout
 * engine and manages its lifecycle.
 *
 * Returns the engine once ready, or `null` while loading / if `elkjs` is
 * not installed. The caller can pass the return value directly to
 * `WorkflowCanvasEditor`'s `layoutEngine` prop — `null` is safe and causes
 * the canvas to use the default dagre engine.
 *
 * The engine (and its Web Worker, if any) is terminated on unmount.
 *
 * @example
 * ```tsx
 * const workerFactory = () =>
 *   new Worker(new URL("elkjs/lib/elk-worker.min.js", import.meta.url));
 *
 * function MyEditor({ yaml }: { yaml: string }) {
 *   const elkEngine = useElkLayoutEngine({ workerFactory });
 *   return <WorkflowCanvasEditor yaml={yaml} layoutEngine={elkEngine} />;
 * }
 * ```
 */
export function useElkLayoutEngine(
  options?: UseElkLayoutEngineOptions,
): LayoutEngine | null {
  const [engine, setEngine] = useState<LayoutEngine | null>(null);
  const engineRef = useRef<LayoutEngine | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const opts: ElkLayoutEngineOptions = {};
    if (optionsRef.current?.workerFactory) {
      opts.workerFactory = optionsRef.current.workerFactory;
    }
    if (optionsRef.current?.layoutOptions) {
      opts.layoutOptions = optionsRef.current.layoutOptions;
    }

    createElkLayoutEngine(opts).then(
      (created) => {
        if (cancelled) {
          created.terminate?.();
          return;
        }
        engineRef.current = created;
        setEngine(created);
      },
      () => {
        // elkjs not installed or import failed — return null,
        // callers fall back to dagre via useWorkflowLayout.
      },
    );

    return () => {
      cancelled = true;
      engineRef.current?.terminate?.();
      engineRef.current = null;
      setEngine(null);
    };
  }, [enabled]);

  return engine;
}
