"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Icon, type IconName } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

export type WhyItWorksProps = React.HTMLAttributes<HTMLElement>;

const FOUNDATIONS = [
  {
    icon: "activity" as IconName,
    title: "Durable execution",
    description:
      "Agents survive crashes and resume where they left off. Built on Temporal — automatic retries, crash recovery, long-running operations.",
  },
  {
    icon: "lock" as IconName,
    title: "Sandboxed tools",
    description:
      "Tool access uses the Model Context Protocol. Agents declare which tools they can use. Stigmer handles discovery, validation, and execution isolation.",
  },
  {
    icon: "code" as IconName,
    title: "Real API contracts",
    description:
      "gRPC services with public protobuf contracts. Generate type-safe clients in Go, Python, Java, TypeScript, and Rust. No proprietary protocols.",
  },
  {
    icon: "unlock" as IconName,
    title: "Open source",
    description:
      "Apache 2.0. Inspect every line of code. Self-host if you need to. Same API contracts whether you use cloud or run your own.",
  },
];

function WhyItWorks({ className, ...props }: WhyItWorksProps) {
  return (
    <section
      id="why-it-works"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="why-it-works-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              Built for production
            </p>
            <h2
              id="why-it-works-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4"
            >
              Why it works
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              You don&apos;t build your own database. You don&apos;t build your own auth layer.
              Why build your own agent infrastructure?
            </p>
          </div>
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 sm:grid-cols-2 gap-8 lg:gap-12"
          staggerDelay={0.1}
          delayChildren={0.1}
        >
          {FOUNDATIONS.map((f) => (
            <StaggerItem key={f.title}>
              <div className="flex items-start gap-4">
                <Icon
                  name={f.icon}
                  size="lg"
                  className="text-foreground shrink-0 mt-0.5"
                />
                <div>
                  <h3 className="text-base font-semibold text-foreground mb-2">
                    {f.title}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.description}
                  </p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>

        <FadeInUp delay={0.3}>
          <div className="flex flex-wrap items-center justify-center gap-4 mt-12">
            {/* TODO: Phase 4 — update to /docs/concepts/what-is-stigmer */}
            <Link
              href="/docs"
              className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 transition-colors"
            >
              Read the docs
              <Icon name="arrow-right" size="xs" />
            </Link>
            <a
              href={SITE_CONFIG.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Icon name="github" size="sm" />
              View on GitHub
            </a>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

export { WhyItWorks };
