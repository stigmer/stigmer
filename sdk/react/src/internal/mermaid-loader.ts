/**
 * Loads `mermaid` through the host's loader, isolated in its own module so
 * {@link file://./MermaidDiagram.tsx} stays a pure presentation component and
 * tests can mock the load outcome (resolve, reject) without touching module
 * registries.
 *
 * The kit never imports `mermaid` itself: a bundler resolves every import it
 * can reach, `import()` included, so naming it here would fail the build of
 * every app that has not installed it. The host passes the import instead
 * (`StigmerProvider`'s `loadMermaid`), and it stays off the synchronous
 * bundle path because the host's bundler splits it.
 */

import type { MermaidLoader, MermaidModule } from "../mermaid-loader-context.js";

/**
 * Holds the in-flight import promise so concurrent diagrams share one load.
 * A failed import clears the cache: rejections are often transient (a
 * chunk-load hiccup mid-deploy), and caching one would break every diagram
 * for the rest of the session.
 */
let mermaidImport: Promise<MermaidModule> | null = null;

/**
 * Runs the host's loader, sharing one in-flight import across callers.
 *
 * @param loader - The host's `loadMermaid`.
 * @returns The mermaid default export.
 * @throws If the loader rejects (the async chunk failed to load). Callers
 *   treat this as "diagrams unavailable" and render the fenced source as a
 *   plain code block.
 */
export function loadMermaid(loader: MermaidLoader): Promise<MermaidModule> {
  mermaidImport ??= loader().then(
    (module) => module.default,
    (error: unknown) => {
      mermaidImport = null;
      throw error;
    },
  );
  return mermaidImport;
}
