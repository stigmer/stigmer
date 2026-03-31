"use client";

import * as React from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { transitions } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import {
  FadeInUp,
  StaggerContainer,
  StaggerItem,
  useReducedMotion,
} from "@/components/ui/motion";

export type HeroProps = React.HTMLAttributes<HTMLElement>;

function Hero({ className, ...props }: HeroProps) {
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
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.15),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.1),transparent_50%)]" />
        <div
          className="absolute inset-0 opacity-[0.06] dark:opacity-[0.02]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23888888' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-4xl mx-auto text-center">
        <StaggerContainer
          className="flex flex-wrap items-center justify-center gap-2 mb-6"
          staggerDelay={0.05}
          delayChildren={0}
        >
          <StaggerItem>
            <Badge variant="emerald" className="gap-1.5">
              <Icon name="unlock" size="xs" />
              Open Source
            </Badge>
          </StaggerItem>
          <StaggerItem>
            <Badge variant="purple" className="gap-1.5">
              <Icon name="shield" size="xs" />
              Apache 2.0
            </Badge>
          </StaggerItem>
        </StaggerContainer>

        <FadeInUp delay={0.2}>
          <h1
            id="hero-heading"
            className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight mb-6"
          >
            <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient">
              {SITE_CONFIG.tagline}
            </span>
          </h1>
        </FadeInUp>

        <FadeInUp delay={0.35}>
          <p className="text-lg sm:text-xl lg:text-2xl text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            {SITE_CONFIG.description}
          </p>
        </FadeInUp>

        <FadeInUp delay={0.5}>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button asChild size="xl">
              <Link href="/docs">
                Documentation
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
      </div>

      <ScrollIndicator />
    </section>
  );
}

function ScrollIndicator() {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
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
