"use client";

/**
 * The homepage's first screen: the headline over the five hard parts, as
 * tabs above a picture of the product that shows a real moment of each,
 * with the worry it answers and what it proves
 * (components/visuals/HeroMoments.tsx).
 *
 * It opens on the ask: an integrator's ledger screen for its customer
 * Northwind Books, with Stigmer's chat panel docked beside it at the moment
 * the ledger agent asks before it posts a correction. That picture is the
 * page's largest paint, so it loads first and does not fade in, and it is
 * where a visitor who asked for less motion stays; the copy above keeps its
 * reveal. The five names sit above the picture, so a visitor sees all five
 * on the first screen, and each moment links to its row in the section
 * below, which says it with its proof.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { HeroMoments } from "@/components/visuals/HeroMoments";

export type HeroProps = React.HTMLAttributes<HTMLElement>;

function Hero({ className, ...props }: HeroProps) {
  return (
    <section
      className={cn("relative pt-8 pb-16 sm:pt-12 sm:pb-24", "overflow-hidden", className)}
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

      <div className="relative z-10 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <StaggerContainer
            className="flex flex-wrap items-center justify-center gap-2 mb-6"
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
              className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold tracking-tight text-foreground mb-6"
            >
              {SITE_CONFIG.headline}
            </h1>
          </FadeInUp>

          <FadeInUp delay={0.35}>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
              {SITE_CONFIG.subhead}
            </p>
          </FadeInUp>

          <FadeInUp delay={0.5}>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-start justify-center gap-3">
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

        {/* The five, and the product with Stigmer in it: the ask is the largest paint, so no entrance fade. */}
        <HeroMoments className="mt-10 sm:mt-12" />

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
