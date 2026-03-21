"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { transitions } from "@/lib/animations";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import {
  FadeInUp,
  FadeIn,
  StaggerContainer,
  StaggerItem,
  useReducedMotion,
} from "@/components/ui/motion";

export type HeroProps = React.HTMLAttributes<HTMLElement>;

/**
 * Hero section with gradient background, headline, CTAs, and install command.
 *
 * Features:
 * - Full viewport height (minus header)
 * - Gradient background effects
 * - Animated badge chips
 * - Primary and secondary CTA buttons
 * - Copy-to-clipboard install command
 *
 * @example
 * <Hero />
 */
function Hero({ className, ...props }: HeroProps) {
  const [copied, setCopied] = React.useState(false);

  const installCommand = "brew install stigmer/tap/stigmer";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = installCommand;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section
      className={cn(
        "relative min-h-[calc(100vh-4rem)]",
        "flex flex-col items-center justify-center",
        "px-4 py-16 sm:py-24",
        "overflow-hidden",
        className
      )}
      aria-labelledby="hero-heading"
      {...props}
    >
      {/* Background Effects */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {/* Primary radial gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.15),transparent_60%)]" />
        {/* Secondary accent gradient */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.1),transparent_50%)]" />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto text-center">
        {/* Badges - Staggered entrance */}
        <StaggerContainer
          className="flex flex-wrap items-center justify-center gap-2 mb-6"
          staggerDelay={0.05}
          delayChildren={0}
        >
          <StaggerItem>
            <Badge variant="cyan" className="gap-1.5">
              <Icon name="terminal" size="xs" />
              Local-First
            </Badge>
          </StaggerItem>
          <StaggerItem>
            <Badge variant="emerald" className="gap-1.5">
              <Icon name="unlock" size="xs" />
              Open Source
            </Badge>
          </StaggerItem>
          <StaggerItem>
            <Badge variant="purple" className="gap-1.5">
              <Icon name="network" size="xs" />
              gRPC APIs
            </Badge>
          </StaggerItem>
        </StaggerContainer>

        {/* Headline - Fade in after badges */}
        <FadeInUp delay={0.2}>
          <h1
            id="hero-heading"
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight mb-6"
          >
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient">
              Build Agents. Skip the Infrastructure.
            </span>
          </h1>
        </FadeInUp>

        {/* Subheadline - Fade in after headline */}
        <FadeInUp delay={0.35}>
          <p className="text-lg sm:text-xl lg:text-2xl text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            We handle sandboxing, orchestration, and MCP security. You write 5 lines of YAML. Your agent runs anywhere.
          </p>
        </FadeInUp>

        {/* CTAs - Fade in after subheadline */}
        <FadeInUp delay={0.5}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Button asChild size="xl">
              <Link href="/docs/getting-started">
                Get Started
                <Icon name="chevron-right" size="sm" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="xl">
              <a
                href={SITE_CONFIG.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="github" />
                View on GitHub
              </a>
            </Button>
          </div>
        </FadeInUp>

        {/* Install Command - Fade in last */}
        <FadeIn delay={0.65}>
          <div className="max-w-xl mx-auto">
            <div className="flex items-center gap-2 p-1 rounded-lg bg-muted/50 border border-border">
              <code className="flex-1 px-4 py-3 text-sm sm:text-base font-mono text-muted-foreground overflow-x-auto scrollbar-thin">
                <span className="text-primary">$</span>{" "}
                <span className="text-foreground">{installCommand}</span>
                <span className="cursor-blink text-primary ml-0.5">|</span>
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleCopy}
                className="shrink-0 mr-1"
                aria-label={copied ? "Copied!" : "Copy install command"}
              >
                <Icon
                  name={copied ? "check" : "copy"}
                  size="sm"
                  className={cn(
                    "transition-colors",
                    copied && "text-green-500"
                  )}
                />
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Start building: <code className="text-foreground">stigmer server</code>
            </p>
          </div>
        </FadeIn>
      </div>

      {/* Scroll indicator - Enhanced with Framer Motion */}
      <ScrollIndicator />
    </section>
  );
}

/**
 * Animated scroll indicator with Framer Motion.
 * Respects reduced motion preference.
 */
function ScrollIndicator() {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    // Static fallback for reduced motion
    return (
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex items-start justify-center p-1">
          <div className="w-1.5 h-3 rounded-full bg-muted-foreground/50" />
        </div>
      </div>
    );
  }

  return (
    <motion.div
      className="absolute bottom-8 left-1/2 -translate-x-1/2"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1, ...transitions.smooth }}
    >
      <motion.div
        className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex items-start justify-center p-1"
        animate={{ y: [0, 8, 0] }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <motion.div
          className="w-1.5 h-3 rounded-full bg-muted-foreground/50"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </motion.div>
    </motion.div>
  );
}

export { Hero };
