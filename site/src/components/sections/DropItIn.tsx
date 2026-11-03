"use client";

/**
 * "Drop it in": the lines of React that put the panel the hero opens on
 * into an app.
 *
 * The code is the embed guide's own `src/App.tsx`
 * (docs/getting-started/embed-agent.mdx), quoted as runs of its consecutive
 * lines with every gap marked `// …`, the rule the README's copy follows
 * too. The Getting Started smoke runs that page, and
 * sections/__tests__/snippets.test.tsx fails when a line here stops being
 * one of its lines or a gap goes unmarked. One sentence names the three
 * frames the component comes in; the hero's moments inside a product are
 * what these lines render, so the section shows no picture of its own.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FadeInUp } from "@/components/ui/motion";

export type DropItInProps = React.HTMLAttributes<HTMLElement>;

/** The line that marks lines left out (test/install/lib/doc-steps.mjs's `ELISION`). */
const ELISION = "// …";

/** The embed guide's `src/App.tsx`, quoted: the imports, the token cache, the provider and the chat. */
export const APP_EXCERPT = [
  'import { Stigmer, createTokenCache } from "@stigmer/client";',
  'import { AgentChat, StigmerProvider } from "@stigmer/react-sdk/chat";',
  'import "@stigmer/react-sdk/styles.css";',
  ELISION,
  "const tokens = createTokenCache(async () => {",
  '  const res = await fetch("/api/stigmer-token");',
  "  return res.json();",
  "});",
  ELISION,
  "export default function App() {",
  "  return (",
  "    <StigmerProvider client={stigmer}>",
  '      <main style={{ height: "100vh" }}>',
  "        <AgentChat agent={`${org}/variance-reporter`} />",
  "      </main>",
  "    </StigmerProvider>",
  "  );",
  "}",
];

const LINK = "text-foreground underline underline-offset-4 hover:text-foreground/80";

function DropItIn({ className, ...props }: DropItInProps) {
  return (
    <section
      id="drop-it-in"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="drop-it-in-heading"
      {...props}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        <FadeInUp className="lg:col-span-5">
          <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">Drop it in</p>
          <h2
            id="drop-it-in-heading"
            className="text-3xl sm:text-4xl font-display font-bold tracking-tight text-foreground mb-6"
          >
            It drops into your app in a few lines of React.
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            The same <code className="font-mono text-base text-foreground">AgentChat</code> docks beside your
            page as a panel, fills a page of its own, or waits behind a button in the corner.{" "}
            <Link href="/docs/getting-started/embed-agent" className={LINK}>
              Put the agent in your app
            </Link>{" "}
            has the rest, with the backend route that hands the page its token.
          </p>
        </FadeInUp>

        <FadeInUp delay={0.1} className="lg:col-span-7 min-w-0">
          <div className="rounded-lg border border-border overflow-hidden bg-card">
            <div className="px-4 sm:px-6 py-3 border-b border-border">
              <span className="text-xs font-mono text-subtle">src/App.tsx</span>
            </div>
            <pre className="p-4 sm:p-6 text-xs sm:text-sm font-mono leading-relaxed overflow-x-auto">
              <code>
                {APP_EXCERPT.map((line, index) => (
                  <div
                    key={index}
                    data-code-line=""
                    className={line === ELISION ? "text-subtle" : "text-muted-foreground"}
                  >
                    {line}
                  </div>
                ))}
              </code>
            </pre>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

export { DropItIn };
