"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";

export type FinalCTAProps = React.HTMLAttributes<HTMLElement>;

/**
 * The quickstart's own commands, in its order, for the "On your machine" tab.
 * The Getting Started smoke runs them on every change, and
 * sections/__tests__/snippets.test.tsx fails when one stops being one of its
 * steps.
 */
const QUICKSTART_COMMANDS = [
  "brew install stigmer/tap/stigmer",
  "export ANTHROPIC_API_KEY=<your Anthropic API key>",
  "stigmer up",
  "stigmer apply -f variance-reporter.yaml",
  'stigmer run variance-reporter --attach ledger.csv --download ./out -m "Review this quarter\'s ledger."',
];

function FinalCTA({ className, ...props }: FinalCTAProps) {
  return (
    <section
      id="final-cta"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="final-cta-heading"
      {...props}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <FadeInUp>
            <h2
              id="final-cta-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4"
            >
              Put your first agent to work
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
              Give an agent a ledger on your own machine. It hands back a report.
            </p>
          </FadeInUp>

          <FadeInUp delay={0.1}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button asChild size="lg">
                <a href={SITE_CONFIG.cloudSignupUrl}>
                  Start free
                  <Icon name="arrow-right" size="sm" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/docs/getting-started/quickstart">Run the quickstart</Link>
              </Button>
            </div>
          </FadeInUp>
        </div>

        <FadeInUp delay={0.2}>
          <div className="rounded-lg border border-border overflow-hidden bg-card">
            <div className="px-4 sm:px-6 py-3 border-b border-border">
              <span className="text-xs font-mono text-subtle">Terminal</span>
            </div>
            <pre className="p-4 sm:p-6 text-xs sm:text-sm font-mono leading-relaxed overflow-x-auto">
              <code>
                {QUICKSTART_COMMANDS.map((command) => (
                  <div key={command}>
                    <span className="text-subtle select-none" aria-hidden="true">
                      ${" "}
                    </span>
                    <span data-code-line="" className="text-muted-foreground">
                      {command}
                    </span>
                  </div>
                ))}
              </code>
            </pre>
          </div>
          <p className="mt-4 text-sm text-subtle text-center">
            The Agent&apos;s file and the ledger are in the{" "}
            <Link
              href="/docs/getting-started/quickstart"
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              quickstart
            </Link>
            .
          </p>
        </FadeInUp>
      </div>
    </section>
  );
}

export { FinalCTA };
