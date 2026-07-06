/**
 * Lazy loader for the `mermaid` library, isolated in its own module — the
 * same seam pattern as `workflow/layout/elk-layout-engine.ts` — so
 * {@link file://./MermaidDiagram.tsx} stays a pure presentation component and
 * tests can mock the load outcome (resolve, reject) without touching module
 * registries.
 *
 * `mermaid` is an optional peer dependency (DD-013): it is large, so it must
 * never sit on the synchronous bundle path, and a host that has not installed
 * it must degrade gracefully (the caller falls back to a code block).
 */

/**
 * The mermaid API surface the SDK consumes, typed from the package itself so
 * it stays in lockstep with the installed version.
 */
export type MermaidModule = typeof import("mermaid").default;

/**
 * Holds the in-flight import promise so concurrent diagrams share one load.
 * A failed import clears the cache: rejections are often transient (a
 * chunk-load hiccup mid-deploy), and caching one would break every diagram
 * for the rest of the session.
 */
let mermaidImport: Promise<MermaidModule> | null = null;

/**
 * Dynamically imports `mermaid`, sharing one in-flight import across callers.
 *
 * @returns The mermaid default export.
 * @throws If `mermaid` cannot be imported (not installed, or the async chunk
 *   failed to load). Callers treat this as "diagrams unavailable" and render
 *   the fenced source as a plain code block.
 */
export function loadMermaid(): Promise<MermaidModule> {
  mermaidImport ??= import("mermaid").then(
    (module) => module.default,
    (error: unknown) => {
      mermaidImport = null;
      throw error;
    },
  );
  return mermaidImport;
}
