"use client";

import { useEffect, useState } from "react";
import { useIsCodeFenceIncomplete } from "streamdown";
import { useColorMode } from "../color-mode.js";
import { loadMermaid } from "./mermaid-loader.js";
import { MERMAID_THEME_CSS } from "./mermaid-theme-css.js";

/**
 * `mermaid.render` requires a DOM id for its scratch element. Ids must be
 * unique per render call — theme switches and streaming updates can overlap
 * renders within one component — so a module counter is the simplest
 * collision-free source.
 */
let renderSequence = 0;

/** Props for {@link MermaidDiagram}. */
export interface MermaidDiagramProps {
  /** The raw Mermaid source from the fenced code block. */
  readonly chart: string;
}

type RenderState =
  | { readonly status: "pending" }
  | { readonly status: "rendered"; readonly svg: string }
  | { readonly status: "failed"; readonly message: string };

/**
 * Renders a fenced ```mermaid block as an inline SVG diagram.
 *
 * Mounted by the shared `pre` override in
 * {@link file://./markdown-components.tsx} whenever a fenced block carries the
 * explicit `mermaid` info string — which means every SDK markdown surface
 * (chat via Streamdown, artifacts/skills via react-markdown) renders diagrams
 * identically. Detection is deliberately limited to the explicit language tag;
 * guessing diagram intent from fence bodies (e.g. a bare fence starting with
 * `flowchart`) is the kind of fuzzy heuristic this codebase avoids.
 *
 * Every failure mode degrades to the exact code block the fence rendered as
 * before this component existed:
 *
 * - **Streaming** — while the fence is still open (`useIsCodeFenceIncomplete`,
 *   a safe no-op under react-markdown where the context defaults to `false`),
 *   the source renders as a code block; the diagram appears once the fence
 *   closes. No half-parsed error flashing mid-stream.
 * - **Library unavailable** — `mermaid` is an optional peer dependency; if the
 *   dynamic import fails the source stays a code block.
 * - **Parse error** — invalid diagram source falls back to the code block plus
 *   a screen-reader-announced note, so the agent's output is never hidden.
 *
 * Security: agent output is untrusted and this SDK renders inside host
 * applications, so mermaid runs with `securityLevel: "strict"` (sanitized
 * labels, no `click` interactivity) — deliberately stricter than the
 * docs-site renderer, which only ever shows first-party content.
 *
 * Theming: the container chrome is fully `--stgm-*` token-driven, and so is
 * the SVG interior. The built-in `default`/`dark` theme (selected via
 * {@link useColorMode}) is the base; on top of it we inject
 * {@link MERMAID_THEME_CSS}, a token-driven stylesheet whose `var(--stgm-*)`
 * references the browser resolves against the `.stgm` scope. Interiors
 * therefore track the active preset *and* color mode live — no color is read
 * in JS, and a preset switch needs no re-render. Feeding tokens through
 * mermaid's `themeVariables` is not possible: they are authored in `oklch()`,
 * which mermaid's color engine (khroma) cannot parse. Any element or diagram
 * type the CSS does not target falls back to the built-in theme, so a diagram
 * is never blank or mis-colored.
 */
export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const isIncomplete = useIsCodeFenceIncomplete();
  const colorMode = useColorMode();
  const [state, setState] = useState<RenderState>({ status: "pending" });

  // Markdown parsers hand the fence body over with its trailing newline;
  // mermaid treats leading/trailing blank lines as part of the diagram.
  const source = chart.trim();

  useEffect(() => {
    if (isIncomplete || source.length === 0) return;

    let cancelled = false;

    void (async () => {
      const renderId = `stgm-mermaid-${++renderSequence}`;
      try {
        const mermaid = await loadMermaid();
        // initialize() mutates a global singleton, so it runs before every
        // render call — all diagrams under one provider share a color mode,
        // and re-initializing keeps a theme switch from bleeding stale config
        // into the next render.
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: colorMode === "dark" ? "dark" : "default",
          themeCSS: MERMAID_THEME_CSS,
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(renderId, source);
        if (!cancelled) setState({ status: "rendered", svg });
      } catch (error: unknown) {
        // Mermaid has historically leaked its scratch element into the
        // document on parse failure; removing it defensively costs nothing.
        document.getElementById(renderId)?.remove();
        if (!cancelled) {
          setState({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // A previously rendered diagram stays visible while a re-render (theme
    // switch) is in flight — swapping to a blank pending state would flash.
  }, [source, colorMode, isIncomplete]);

  if (state.status === "rendered") {
    return (
      <div
        role="img"
        aria-label="Mermaid diagram"
        className="stg:mb-3 stg:last:mb-0 stg:flex stg:justify-center stg:overflow-x-auto stg:rounded-md stg:border stg:border-border stg:bg-card stg:p-3 stg:[&_svg]:max-w-full"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  return (
    <MermaidSourceFallback
      chart={chart}
      failureMessage={state.status === "failed" ? state.message : null}
    />
  );
}

/**
 * The pre-diagram presentation of a mermaid fence: the same styled code block
 * the shared `pre`/`code` overrides in `markdown-components.tsx` would have
 * produced (classes mirrored from there — importing them would create a
 * module cycle, since that file mounts this component). Shown while the fence
 * streams, while mermaid loads, and permanently when rendering fails.
 */
function MermaidSourceFallback({
  chart,
  failureMessage,
}: {
  chart: string;
  failureMessage: string | null;
}) {
  return (
    <div className="stg:mb-3 stg:last:mb-0">
      <pre className="stg:overflow-x-auto stg:rounded-md stg:bg-muted stg:p-3">
        <code className="stg:font-mono stg:text-xs stg:text-foreground">{chart}</code>
      </pre>
      {failureMessage !== null && (
        <p role="status" className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
          Mermaid diagram failed to render; showing source. ({failureMessage})
        </p>
      )}
    </div>
  );
}
