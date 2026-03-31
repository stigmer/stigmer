"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

export type CapabilitiesProps = React.HTMLAttributes<HTMLElement>;

const CAPABILITIES = [
  {
    icon: "lightbulb" as IconName,
    title: "Knows Your Business",
    claim: "Teach your agent what generic AI doesn't know.",
    description:
      "Upload domain knowledge — product docs, policies, procedures. The agent uses it to answer questions specific to your business. No vector database. No embedding pipeline.",
    cta: "Teach your agent",
    // TODO: Phase 3 — update to /docs/getting-started/first-skill
    href: "/docs",
  },
  {
    icon: "network" as IconName,
    title: "Uses Your Tools",
    claim: "Agents that can act, not just talk.",
    description:
      "Connect your agent to your systems. It checks inventory, creates tickets, updates records — with the same APIs your team already uses. Tool access uses the Model Context Protocol.",
    cta: "Connect your tools",
    // TODO: Phase 6 — update to /docs/tutorials/give-your-agent-tools
    href: "/docs",
  },
  {
    icon: "shield" as IconName,
    title: "Asks Before Acting",
    claim: "Human oversight built in, not bolted on.",
    description:
      "Define which actions require human approval. The agent pauses, presents its reasoning, and waits. Routine requests are handled automatically. Sensitive actions — humans stay in control.",
    cta: "Set your rules",
    // TODO: Phase 6 — update to /docs/tutorials/add-approval-flows
    href: "/docs",
  },
];

function Capabilities({ className, ...props }: CapabilitiesProps) {
  return (
    <section
      id="capabilities"
      className={cn("py-24 sm:py-32", className)}
      aria-labelledby="capabilities-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              Three pillars
            </p>
            <h2
              id="capabilities-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground"
            >
              What makes Stigmer different
            </h2>
          </div>
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border"
          staggerDelay={0.1}
          delayChildren={0.1}
        >
          {CAPABILITIES.map((cap) => (
            <StaggerItem key={cap.title}>
              <div className="bg-background p-6 sm:p-8 h-full flex flex-col">
                <Icon
                  name={cap.icon}
                  size="lg"
                  className="text-foreground mb-4"
                />
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {cap.title}
                </h3>
                <p className="text-sm font-serif italic text-muted-foreground mb-4">
                  {cap.claim}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
                  {cap.description}
                </p>
                <Link
                  href={cap.href}
                  className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 transition-colors"
                >
                  {cap.cta}
                  <Icon name="arrow-right" size="xs" />
                </Link>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}

export { Capabilities };
