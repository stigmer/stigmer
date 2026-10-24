"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { AGENT_GET_IDS, AGENT_GETS } from "@/lib/agent-gets";

export type AgentGetsProps = React.HTMLAttributes<HTMLElement>;

/**
 * Where a card sits in the grid, from its place in the list: two columns on small
 * screens with an odd last card across both, and on large ones three cards over
 * the rest on six columns. No width leaves an empty cell, where the grid's
 * border colour would show as a grey block.
 */
function cardSpan(index: number): string {
  return cn(
    index === AGENT_GET_IDS.length - 1 && AGENT_GET_IDS.length % 2 === 1 && "sm:col-span-2",
    index < 3 ? "lg:col-span-2" : "lg:col-span-3",
  );
}

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
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-px bg-border rounded-lg overflow-hidden border border-border"
          staggerDelay={0.1}
          delayChildren={0.1}
        >
          {AGENT_GET_IDS.map((id) => AGENT_GETS[id]).map((item, index) => (
            <StaggerItem key={item.title} className={cardSpan(index)}>
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
