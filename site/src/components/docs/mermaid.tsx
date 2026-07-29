"use client";

import { useEffect, useId, useRef, useState } from "react";

interface MermaidProps {
  chart: string;
}

/**
 * Client-side Mermaid diagram renderer, pinned to Mermaid's dark theme
 * (the site is dark-only, so there is no theme to react to).
 *
 * Used transparently via standard fenced code blocks in MDX:
 *
 * @example
 * ~~~mdx
 * ```mermaid
 * flowchart TB
 *     A[Agent] --> B[Agent Instance]
 *     B --> C[Session]
 *     C --> D[Agent Execution]
 * ```
 * ~~~
 *
 * A remark plugin in source.config.ts converts fenced mermaid blocks
 * into `<Mermaid chart="..." />` before Shiki processes them.
 */
export function Mermaid({ chart }: MermaidProps) {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;

        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          fontFamily: "inherit",
          securityLevel: "loose",
        });

        const stableId = `mermaid-${id.replace(/:/g, "")}`;
        const { svg: rendered } = await mermaid.render(stableId, chart);
        if (!cancelled) {
          setSvg(rendered);
          setError("");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSvg("");
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);

  if (error) {
    return (
      <div className="my-4 rounded-lg border border-fd-border bg-fd-card p-4">
        <p className="mb-2 text-sm font-medium text-red-500">
          Mermaid diagram error
        </p>
        <pre className="text-xs text-fd-muted-foreground">{error}</pre>
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-fd-muted-foreground">
            Show source
          </summary>
          <pre className="mt-1 text-xs text-fd-muted-foreground">{chart}</pre>
        </details>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 flex items-center justify-center rounded-lg border border-fd-border bg-fd-card p-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-fd-muted-foreground border-t-transparent" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center overflow-x-auto rounded-lg border border-fd-border bg-fd-card p-4 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
