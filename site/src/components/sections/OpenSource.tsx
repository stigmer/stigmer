"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";

export type OpenSourceProps = React.HTMLAttributes<HTMLElement>;

function OpenSource({ className, ...props }: OpenSourceProps) {
  return (
    <section
      id="open-source"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="open-source-heading"
      {...props}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <FadeInUp>
          <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
            Open source
          </p>
          <h2
            id="open-source-heading"
            className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6"
          >
            Inspect every line of code
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            Stigmer is Apache 2.0. Public protobuf contracts. Self-host if you need to.
            No vendor lock-in. The fastest path is cloud, but you always have the option
            to run everything yourself.
          </p>
        </FadeInUp>

        <FadeInUp delay={0.1}>
          <div className="flex flex-wrap items-center justify-center gap-6 mb-12">
            <Signal label="License" value="Apache 2.0" />
            <Signal label="Contracts" value="Public Protobuf" />
            <Signal label="Deploy" value="Cloud or Self-Hosted" />
          </div>
        </FadeInUp>

        <FadeInUp delay={0.2}>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <a
              href={SITE_CONFIG.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-foreground hover:text-foreground/80 transition-colors"
            >
              <Icon name="github" size="sm" />
              View source
            </a>
            <Link
              href="/docs/getting-started/local"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Run locally
              <Icon name="arrow-right" size="xs" />
            </Link>
            <Link
              href="/docs/guides/self-hosting/cloud-vs-self-hosted"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cloud vs self-hosted
              <Icon name="arrow-right" size="xs" />
            </Link>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2 rounded border border-border">
      <div className="text-xs font-mono uppercase tracking-wider text-subtle mb-0.5">
        {label}
      </div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

export { OpenSource };
