"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

export type AgentGetsProps = React.HTMLAttributes<HTMLElement>;

/** What each customer's agent has, in the vocabulary's order, each with the page that shows it. */
const GETS: readonly {
  icon: IconName;
  title: string;
  description: string;
  cta: string;
  href: string;
}[] = [
  {
    icon: "cpu",
    title: "Its own computer",
    description: "A sandbox that keeps its files between turns, and hands back what it made.",
    cta: "Environments",
    href: "/docs/concepts/environments",
  },
  {
    icon: "shield",
    title: "It asks first",
    description:
      "Before a step your own tools mark as risky, it stops, shows what it wants to do, and waits for a yes.",
    cta: "Approval flows",
    href: "/docs/concepts/approval-flows",
  },
  {
    icon: "lock",
    title: "Walls between customers",
    description: "Each customer's agents, files and keys stay apart. The editions say how.",
    cta: "Give each customer their own organization",
    href: "/docs/getting-started/one-organization-per-customer",
  },
  {
    icon: "network",
    title: "Your keys, your servers",
    description:
      "Runs on your own model keys: Anthropic or Cursor anywhere, OpenAI too on Stigmer Cloud. On your servers or ours.",
    cta: "Open source, Enterprise and Cloud",
    href: "/docs/guides/self-hosting/cloud-vs-self-hosted",
  },
];

function AgentGets({ className, ...props }: AgentGetsProps) {
  return (
    <section
      id="what-each-agent-gets"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="what-each-agent-gets-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <h2
              id="what-each-agent-gets-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground"
            >
              What each customer&apos;s agent gets
            </h2>
          </div>
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden border border-border"
          staggerDelay={0.1}
          delayChildren={0.1}
        >
          {GETS.map((item) => (
            <StaggerItem key={item.title}>
              <div className="bg-background p-6 sm:p-8 h-full flex flex-col">
                <Icon name={item.icon} size="lg" className="text-foreground mb-4" />
                <h3 className="text-lg font-semibold text-foreground mb-3">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
                  {item.description}
                </p>
                <Link
                  href={item.href}
                  className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 transition-colors"
                >
                  {item.cta}
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

export { AgentGets };
