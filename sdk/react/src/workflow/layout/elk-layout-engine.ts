import type { LayoutEngine, LayoutInput, LayoutResult, ElkGraph, ElkLayoutResult } from "./types";
import { preprocessForElk } from "./workflow-preprocessor";
import { postprocessElkResult } from "./layout-postprocessor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ElkLayoutEngineOptions {
  /**
   * Factory function that creates a Web Worker for off-main-thread layout.
   * When provided, the engine uses `elkjs/lib/elk-api.js` (lightweight ~5KB)
   * and delegates computation to the worker.
   *
   * When omitted, the engine dynamically imports `elkjs/lib/elk.bundled.js`
   * which includes the full WASM layout algorithms (~1.5MB) and runs on
   * the main thread with an async API.
   *
   * Example (Next.js / Vite):
   * ```ts
   * const workerFactory = () =>
   *   new Worker(new URL('elkjs/lib/elk-worker.min.js', import.meta.url));
   * ```
   */
  workerFactory?: () => Worker;
  /**
   * Additional ELK layout options to merge with workflow defaults.
   * See: https://eclipse.dev/elk/reference/options.html
   */
  layoutOptions?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an ELK-based layout engine with optional Web Worker support.
 *
 * This function dynamically imports elkjs — the import is deferred so that
 * the ~1.5MB WASM module is only loaded when layout is first requested,
 * not at SDK initialization time.
 *
 * If elkjs is not installed (optional peer dependency), the import will
 * reject and the caller should fall back to the dagre engine.
 *
 * @throws If elkjs cannot be imported (not installed or bundler misconfiguration).
 */
export async function createElkLayoutEngine(
  options?: ElkLayoutEngineOptions,
): Promise<LayoutEngine> {
  const elk = await instantiateElk(options);
  return new ElkLayoutEngineImpl(elk, options?.layoutOptions);
}

// ---------------------------------------------------------------------------
// ELK Instantiation
// ---------------------------------------------------------------------------

interface ElkInstance {
  layout(graph: unknown): Promise<unknown>;
}

async function instantiateElk(options?: ElkLayoutEngineOptions): Promise<ElkInstance> {
  if (options?.workerFactory) {
    try {
      const module = await import("elkjs/lib/elk-api.js");
      const ELK = module.default ?? module;
      return new ELK({ workerFactory: options.workerFactory });
    } catch {
      // Worker path failed — fall through to bundled
    }
  }

  const module = await import("elkjs/lib/elk.bundled.js");
  const ELK = module.default ?? module;
  return new ELK();
}

// ---------------------------------------------------------------------------
// Engine Implementation
// ---------------------------------------------------------------------------

class ElkLayoutEngineImpl implements LayoutEngine {
  readonly name = "elk-layered";
  private readonly elk: ElkInstance;
  private readonly optionOverrides: Record<string, string> | undefined;
  private terminated = false;

  constructor(elk: ElkInstance, optionOverrides?: Record<string, string>) {
    this.elk = elk;
    this.optionOverrides = optionOverrides;
  }

  async layout(input: LayoutInput): Promise<LayoutResult> {
    if (this.terminated) {
      throw new Error("ELK layout engine has been terminated.");
    }

    const start = performance.now();

    const elkGraph: ElkGraph = preprocessForElk(input, this.optionOverrides);
    const rawResult = await this.elk.layout(elkGraph as unknown);
    const elkResult = rawResult as ElkLayoutResult;

    const durationMs = performance.now() - start;

    return postprocessElkResult(
      elkResult,
      input.scope,
      input.graph,
      durationMs,
      this.name,
    );
  }

  terminate(): void {
    this.terminated = true;
    if ("terminateWorker" in this.elk && typeof (this.elk as Record<string, unknown>).terminateWorker === "function") {
      (this.elk as { terminateWorker: () => void }).terminateWorker();
    }
  }
}
