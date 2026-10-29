"use client";

import { createContext } from "react";

/**
 * The part of the `mermaid` library the kit calls, written out so the kit
 * names no `mermaid` import: `mermaid`'s own default export satisfies it.
 */
export interface MermaidModule {
  /** Configures the next render (theme, security level). */
  initialize(config: {
    readonly startOnLoad: boolean;
    readonly securityLevel: "strict";
    readonly theme: "default" | "dark";
    readonly themeCSS: string;
    readonly fontFamily: string;
  }): void;
  /** Renders diagram source to an SVG string. */
  render(id: string, text: string): Promise<{ readonly svg: string }>;
}

/**
 * Loads `mermaid` for the kit's diagrams, passed to `StigmerProvider` as
 * `loadMermaid`. Pass `() => import("mermaid")`: the host installs
 * `mermaid` and its bundler splits it into a chunk fetched on the first
 * diagram.
 */
export type MermaidLoader = () => Promise<{ readonly default: MermaidModule }>;

/**
 * React context for the host's {@link MermaidLoader}, supplied through
 * `StigmerProvider`'s `loadMermaid`. Separated from the provider, as
 * `PublicBaseUrlContext` is, to avoid circular imports.
 *
 * `null` means the host passed no loader: a ```mermaid fence then shows as
 * its source.
 */
export const MermaidLoaderContext = createContext<MermaidLoader | null>(null);
