"use client";

/**
 * The homepage's first screen: the headline over a picture of Stigmer at
 * work inside a product.
 *
 * The picture is the visual suite's drawing of an integrator's ledger
 * screen for its customer Northwind Books, with Stigmer's chat panel docked
 * beside it at the moment the ledger agent asks before it posts a
 * correction (test/visual/src/shown.ts, "in-product"). On a large screen it
 * spans the container; below `CROP_BREAKPOINT` the whole screen would be
 * too small to read, so the page shows the panel's crop of the same
 * drawing instead. It is the page's largest paint, so it loads first and
 * does not fade in; the copy above it keeps its reveal.
 *
 * Pins point at the parts of the drawing that prove a claim, only where
 * the drawing shows one (the suite checks where each part is drawn), and
 * the list under the picture says what each pin is and links to its proof
 * further down.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { CROP_BREAKPOINT, ScreenPicture } from "@/components/visuals/ScreenPicture";
import { PinRail, ScreenPins } from "@/components/visuals/ScreenPins";

export type HeroProps = React.HTMLAttributes<HTMLElement>;

/** The shown picture of the whole screen, and its crop of the panel alone. */
export const HERO_SCREEN = { whole: "in-product", panel: "in-product-panel" } as const;

/** What the picture shows, for a reader who cannot see it; true of both crops. */
export const HERO_ALT =
  "Stigmer's chat panel inside a product, open beside Northwind Books' ledger. The ledger agent has read the ledger, found the Figma annual plan filed under office supplies, and waits for Approve or Deny before it posts the correction.";

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

        {/* The product with Stigmer in it: the largest paint, so no entrance fade. */}
        <div className="mt-10 sm:mt-12">
          <ScreenPicture
            name={HERO_SCREEN.whole}
            narrow={HERO_SCREEN.panel}
            alt={HERO_ALT}
            sizes="(width >= 80rem) 1216px, calc(100vw - 4rem)"
            priority
          >
            <ScreenPins source={HERO_SCREEN.whole} on={HERO_SCREEN.panel} className={CROP_BREAKPOINT.narrowOnly} />
            <ScreenPins source={HERO_SCREEN.whole} className={CROP_BREAKPOINT.wideOnly} />
          </ScreenPicture>
          <PinRail source={HERO_SCREEN.whole} on={HERO_SCREEN.panel} className={cn("mt-6", CROP_BREAKPOINT.narrowOnly)} />
          <PinRail source={HERO_SCREEN.whole} className={cn("mt-6", CROP_BREAKPOINT.wideOnly)} />
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
