import * as React from "react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/constants";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";

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
        {/* Section Header */}
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

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature, index) => (
            <FeatureCard
              key={feature.title}
              title={feature.title}
              description={feature.description}
              icon={feature.icon as IconName}
              index={index}
            />
          ))}
        </div>
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
    <Card variant="feature" className="group">
      <CardHeader className="space-y-4">
        {/* Icon Container */}
        <div
          className={cn(
            "w-12 h-12 rounded-lg",
            "bg-gradient-to-br from-primary/20 to-accent/20",
            "border border-primary/20",
            "flex items-center justify-center",
            "transition-all duration-300",
            "group-hover:from-primary/30 group-hover:to-accent/30",
            "group-hover:border-primary/40",
            "group-hover:shadow-lg group-hover:shadow-primary/10"
          )}
        >
          <Icon
            name={icon}
            size="lg"
            className="text-primary transition-colors group-hover:text-primary"
          />
        </div>

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
