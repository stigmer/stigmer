import * as React from "react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";

export type IntegrationProps = React.HTMLAttributes<HTMLElement>;

/**
 * Integration section showcasing platform vs framework approach.
 *
 * Features:
 * - Section heading with gradient text
 * - Two-column comparison table
 * - "Platform for Platforms" callout box
 * - Responsive: 2 cols desktop, 1 col mobile
 *
 * @example
 * <Integration />
 */
function Integration({ className, ...props }: IntegrationProps) {
  return (
    <section
      id="integration"
      className={cn("py-24 sm:py-32", className)}
      aria-labelledby="integration-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center mb-16">
          <h2
            id="integration-heading"
            className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
          >
            <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              Platform, Not Framework
            </span>
          </h2>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto">
            Agents run as independent microservices with gRPC APIs. Your apps don&apos;t import libraries; they call services. Update agents independently—all consumers benefit instantly. All with standard protocols and public contracts.
          </p>
        </div>

        {/* Comparison Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Framework Approach */}
          <Card variant="feature">
            <CardHeader className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center">
                  <Icon name="package" size="lg" className="text-muted-foreground" />
                </div>
                <CardTitle className="text-xl">Framework Approach</CardTitle>
              </div>
              <ul className="space-y-3">
                <ComparisonItem text="Import agent library into each app" />
                <ComparisonItem text="Tightly coupled to app code" />
                <ComparisonItem text="Redeploy all apps to update agent" />
                <ComparisonItem text="Custom integration per language" />
                <ComparisonItem text="Agent runs in app process" />
              </ul>
            </CardHeader>
          </Card>

          {/* Stigmer Approach */}
          <Card variant="feature" className="border-primary/20 bg-primary/5">
            <CardHeader className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20 flex items-center justify-center">
                  <Icon name="network" size="lg" className="text-primary" />
                </div>
                <CardTitle className="text-xl">Stigmer Approach</CardTitle>
              </div>
              <ul className="space-y-3">
                <ComparisonItem text="Create agent once (YAML or SDK)" highlight />
                <ComparisonItem text="Loosely coupled via gRPC" highlight />
                <ComparisonItem text="Update agent, all consumers benefit instantly" highlight />
                <ComparisonItem text="Standard gRPC (Go, Python, Java, TypeScript, Rust)" highlight />
                <ComparisonItem text="Agent runs in isolated sandbox" highlight />
              </ul>
            </CardHeader>
          </Card>
        </div>

        {/* Platform for Platforms Callout */}
        <div className="max-w-4xl mx-auto">
          <div className="relative p-6 sm:p-8 rounded-lg border-2 border-primary/10 bg-gradient-to-br from-primary/5 to-accent/5">
            {/* Icon */}
            <div className="absolute top-6 left-6 sm:top-8 sm:left-8">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20 flex items-center justify-center">
                <Icon name="lightbulb" size="lg" className="text-primary" />
              </div>
            </div>

            {/* Content */}
            <div className="pl-16 sm:pl-20">
              <h3 className="text-xl sm:text-2xl font-bold text-foreground mb-3">
                Platform for Platforms
              </h3>
              <p className="text-base sm:text-lg text-muted-foreground leading-relaxed">
                <strong className="text-foreground">The marketplace opportunity:</strong> Because agents are gRPC services, 
                you can build agent marketplaces. Create a catalog in Stigmer, expose via API, let users call agents like Twilio calls. Infrastructure disappears. APIs scale.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Individual comparison item component.
 */
interface ComparisonItemProps {
  text: string;
  highlight?: boolean;
}

function ComparisonItem({ text, highlight }: ComparisonItemProps) {
  return (
    <li className="flex items-start gap-2">
      <span className={cn(
        "shrink-0 mt-1",
        highlight ? "text-primary" : "text-muted-foreground"
      )}>
        •
      </span>
      <span className={cn(
        "text-sm leading-relaxed",
        highlight ? "text-foreground" : "text-muted-foreground"
      )}>
        {text}
      </span>
    </li>
  );
}

export { Integration };
