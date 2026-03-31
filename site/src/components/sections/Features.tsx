"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/constants";
import { transitions } from "@/lib/animations";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

export type FeaturesProps = React.HTMLAttributes<HTMLElement>;

/**
 * Features section displaying capability cards in a responsive grid.
 *
 * Features:
 * - Section heading with gradient text
 * - 6-card grid from FEATURES constant
 * - Icon + title + description per card
 * - Hover effects with subtle glow
 * - Responsive: 1 col mobile, 2 col tablet, 3 col desktop
 *
 * @example
 * <Features />
 */
function Features({ className, ...props }: FeaturesProps) {
  if (FEATURES.length === 0) return null;

  return (
    <section
      id="features"
      className={cn(
        "py-24 sm:py-32",
        "bg-muted/30",
        className
      )}
      aria-labelledby="features-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <h2
              id="features-heading"
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
            >
              <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                What We Handle So You Don&apos;t Have To
              </span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
              Stigmer solves the infrastructure challenges that derail agent projects. Sandboxing, orchestration, MCP security—all handled. You focus on agent logic, not plumbing.
            </p>
          </div>
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8"
          staggerDelay={0.1}
          delayChildren={0.1}
        >
          {FEATURES.map((feature, index) => (
            <StaggerItem key={feature.title}>
              <FeatureCard
                title={feature.title}
                description={feature.description}
                icon={feature.icon as IconName}
                index={index}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}

/**
 * Individual feature card component.
 */
interface FeatureCardProps {
  title: string;
  description: string;
  icon: IconName;
  index: number;
}

function FeatureCard({ title, description, icon }: FeatureCardProps) {
  return (
    <Card variant="glass" className="group h-full">
      <CardHeader className="space-y-4">
        {/* Icon Container - with hover scale animation */}
        <motion.div
          className={cn(
            "w-12 h-12 rounded-lg",
            "bg-gradient-to-br from-primary/20 to-accent/20",
            "border border-primary/20",
            "flex items-center justify-center",
            "transition-colors duration-300",
            "group-hover:from-primary/30 group-hover:to-accent/30",
            "group-hover:border-primary/40"
          )}
          whileHover={{ scale: 1.1 }}
          transition={transitions.spring}
        >
          <Icon
            name={icon}
            size="lg"
            className="text-primary"
          />
        </motion.div>

        {/* Title */}
        <CardTitle className="text-lg group-hover:text-foreground transition-colors">
          {title}
        </CardTitle>

        {/* Description */}
        <CardDescription className="leading-relaxed">
          {description}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

export { Features };
