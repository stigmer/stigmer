"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FadeInUp } from "@/components/ui/motion";

export type BuiltForPlantonProps = React.HTMLAttributes<HTMLElement>;

/** Why Stigmer exists: the team needed agents in its own product first. */
function BuiltForPlanton({ className, ...props }: BuiltForPlantonProps) {
  return (
    <section
      id="built-for-planton"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="built-for-planton-heading"
      {...props}
    >
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <FadeInUp>
          <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
            Why we built it
          </p>
          <h2
            id="built-for-planton-heading"
            className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6"
          >
            Built for Planton first
          </h2>
          <p className="text-lg text-muted-foreground leading-relaxed">
            We also build Planton, a DevOps product. Its customers wanted to ask for a change to
            their cloud setup instead of finding the right screen, and an assistant that only
            answers questions wasn&apos;t worth shipping. So we built agents that do the work and
            ask before they apply anything, and made the backend they run on open source.
          </p>
          <p className="mt-6 text-lg">
            <Link
              href="/blog/how-we-put-agents-into-planton"
              className="text-foreground underline underline-offset-4 hover:text-foreground/80"
            >
              How we put agents into Planton
            </Link>
          </p>
        </FadeInUp>
      </div>
    </section>
  );
}

export { BuiltForPlanton };
