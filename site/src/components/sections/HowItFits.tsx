"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { WhereItSits } from "@/components/visuals/WhereItSits";

export type HowItFitsProps = React.HTMLAttributes<HTMLElement>;

/** The three steps of Getting Started, each with its page. */
const STEPS = [
  {
    number: "01",
    title: "Describe the job",
    description: "An Agent is a short file: what it does and what it may use.",
    cta: "Your first agent job",
    href: "/docs/getting-started/quickstart",
  },
  {
    number: "02",
    title: "Call it from your backend",
    description:
      "Your backend starts a conversation, sends the customer's file, and gets the agent's files back.",
    cta: "Do the same job from your app",
    href: "/docs/getting-started/call-from-your-app",
  },
  {
    number: "03",
    title: "Put it in front of your users",
    description: "Your signed-in users reach their agent inside your app.",
    cta: "Put the agent in your app",
    href: "/docs/getting-started/embed-agent",
  },
];

function HowItFits({ className, ...props }: HowItFitsProps) {
  return (
    <section
      id="how-it-fits"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="how-it-fits-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              How it fits
            </p>
            <h2
              id="how-it-fits-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground"
            >
              {SITE_CONFIG.whereItRuns}
            </h2>
          </div>
        </FadeInUp>

        <FadeInUp className="mb-16">
          <WhereItSits />
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 md:grid-cols-3 gap-12"
          staggerDelay={0.1}
          delayChildren={0.1}
        >
          {STEPS.map((step) => (
            <StaggerItem key={step.number}>
              <div className="h-full flex flex-col">
                <span className="text-xs font-mono text-subtle">{step.number}</span>
                <h3 className="text-xl font-semibold text-foreground mt-2 mb-3">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
                  {step.description}
                </p>
                <Link
                  href={step.href}
                  className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 transition-colors"
                >
                  {step.cta}
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

export { HowItFits };
