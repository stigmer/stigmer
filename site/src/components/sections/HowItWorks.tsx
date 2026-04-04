"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

export type HowItWorksProps = React.HTMLAttributes<HTMLElement>;

const STEPS = [
  {
    number: "01",
    title: "Teach",
    description:
      "Upload your domain knowledge — product docs, policies, procedures. Each agent gets the specific context it needs. No ML pipeline required.",
  },
  {
    number: "02",
    title: "Connect",
    description:
      "Give your agent access to your systems via the Model Context Protocol. It can query data, create records, and take actions through your existing APIs.",
  },
  {
    number: "03",
    title: "Deploy",
    description:
      "Call your agent from any application via gRPC or SDK. Stigmer handles durable execution, state management, and crash recovery.",
  },
];

function HowItWorks({ className, ...props }: HowItWorksProps) {
  return (
    <section
      id="how-it-works"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="how-it-works-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              How it works
            </p>
            <h2
              id="how-it-works-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground"
            >
              Three steps to production
            </h2>
          </div>
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 md:grid-cols-3 gap-12"
          staggerDelay={0.1}
          delayChildren={0.1}
        >
          {STEPS.map((step) => (
            <StaggerItem key={step.number}>
              <div>
                <span className="text-xs font-mono text-subtle">
                  {step.number}
                </span>
                <h3 className="text-xl font-semibold text-foreground mt-2 mb-3">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>

        <FadeInUp delay={0.3}>
          <div className="text-center mt-12">
            <Button asChild variant="outline" size="lg">
              <Link href="/docs/getting-started/quickstart">
                Get Started
                <Icon name="arrow-right" size="sm" />
              </Link>
            </Button>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

export { HowItWorks };
