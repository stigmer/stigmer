"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { JobPath } from "@/components/visuals/JobPath";

export type HeroProps = React.HTMLAttributes<HTMLElement>;

function Hero({ className, ...props }: HeroProps) {
  return (
    <section
      className={cn(
        "relative min-h-[calc(100vh-4rem)]",
        "flex flex-col items-center justify-center",
        "py-16 sm:py-24",
        "overflow-hidden",
        className
      )}
      aria-labelledby="hero-heading"
      {...props}
    >
      {/* Background vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, #111111 0%, #0a0a0a 70%)",
        }}
      />

      {/* Content */}
      <div className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8">
        {/* Side by side only from xl, where the picture's column is the 628px it
            was drawn at; below, the picture sits under the buttons. */}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-12 xl:gap-16 items-center">
          {/* Left: Copy */}
          <div>
            <StaggerContainer
              className="flex flex-wrap items-center gap-2 mb-6"
              staggerDelay={0.05}
              delayChildren={0}
            >
              <StaggerItem>
                <Badge variant="outline" className="gap-1.5">
                  <Icon name="unlock" size="xs" />
                  Open Source
                </Badge>
              </StaggerItem>
              <StaggerItem>
                <Badge variant="outline" className="gap-1.5">
                  <Icon name="shield" size="xs" />
                  Apache 2.0
                </Badge>
              </StaggerItem>
            </StaggerContainer>

            <FadeInUp delay={0.2}>
              <h1
                id="hero-heading"
                className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-foreground mb-6"
              >
                {SITE_CONFIG.headline}
              </h1>
            </FadeInUp>

            <FadeInUp delay={0.35}>
              <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mb-8 leading-relaxed">
                {SITE_CONFIG.subhead}
              </p>
            </FadeInUp>

            <FadeInUp delay={0.5}>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
                <Button asChild size="lg">
                  <a href={SITE_CONFIG.cloudSignupUrl}>
                    Start free
                    <Icon name="arrow-right" size="sm" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/docs/getting-started/quickstart">
                    Run the quickstart
                  </Link>
                </Button>
              </div>
            </FadeInUp>
          </div>

          {/* Right: the job, a customer's agent at work in its own computer */}
          <FadeInUp delay={0.4} className="min-w-0">
            <JobPath />
          </FadeInUp>
        </div>

        {/* Stats bar */}
        <FadeInUp delay={0.6}>
          <div className="mt-16 pt-8 border-t border-border">
            <div className="flex flex-wrap items-center gap-8 sm:gap-12">
              <StatItem label="License" value="Apache 2.0 core" />
              <StatItem label="Model keys" value="Your own" />
              <StatItem label="Runs" value="Your servers or ours" />
            </div>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-mono uppercase tracking-wider text-subtle mb-1">
        {label}
      </div>
      <div className="text-sm text-muted-foreground">{value}</div>
    </div>
  );
}

export { Hero };
