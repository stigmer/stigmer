"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

export type UseCasesProps = React.HTMLAttributes<HTMLElement>;

const USE_CASES = [
  {
    industry: "Healthcare",
    description:
      "Patient agents that triage by your protocols and escalate to physicians when it matters.",
  },
  {
    industry: "HR & People",
    description:
      "Onboarding agents that guide new hires through every step — policies, access, training — across all your client companies.",
  },
  {
    industry: "FinTech",
    description:
      "Compliance agents that monitor transactions against each client's regulatory rules and flag what needs human review.",
  },
  {
    industry: "Education",
    description:
      "Tutoring agents that remember every student's progress and adapt to each course's content and policies.",
  },
  {
    industry: "Legal",
    description:
      "Contract agents that analyze clauses against your precedent library and pause for attorney review on high-stakes decisions.",
  },
];

function UseCases({ className, ...props }: UseCasesProps) {
  return (
    <section
      id="use-cases"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="use-cases-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              Use cases
            </p>
            <h2
              id="use-cases-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground"
            >
              What you can build
            </h2>
          </div>
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border"
          staggerDelay={0.08}
          delayChildren={0.1}
        >
          {USE_CASES.map((uc) => (
            <StaggerItem key={uc.industry}>
              <div className="bg-background p-6 sm:p-8 h-full flex flex-col">
                <h3 className="text-sm font-mono uppercase tracking-wider text-subtle mb-3">
                  {uc.industry}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                  {uc.description}
                </p>
                <Link
                  href="/use-cases"
                  className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 transition-colors mt-4"
                >
                  Learn more
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

export { UseCases };
