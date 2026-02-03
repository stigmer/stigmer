"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";

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
        {/* Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
          <Badge variant="outline" className="gap-1">
            <Icon name="network" size="xs" />
            gRPC APIs
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Icon name="file-code" size="xs" />
            YAML + SDK
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Icon name="unlock" size="xs" />
            Open Source
          </Badge>
        </div>

        {/* Headline */}
        <h1
          id="hero-heading"
          className="text-4xl sm:text-5xl lg:text-6xl xl:text-7xl font-bold tracking-tight mb-6"
        >
          <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent bg-[length:200%_auto] animate-gradient">
            Agents as Microservices
          </span>
        </h1>

        {/* Subheadline */}
        <p className="text-lg sm:text-xl lg:text-2xl text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
          Build agents in YAML or Go. Deploy once. Call from everywhere via gRPC. Update agents independently—all consumers benefit instantly.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
          <Button asChild size="xl">
            <a href="/docs/getting-started">
              Get Started
              <Icon name="chevron-right" size="sm" />
            </a>
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

        {/* Install Command */}
        <div className="max-w-xl mx-auto">
          <div className="flex items-center gap-2 p-1 rounded-lg bg-muted/50 border border-border">
            <code className="flex-1 px-4 py-3 text-sm sm:text-base font-mono text-muted-foreground overflow-x-auto scrollbar-thin">
              <span className="text-primary">$</span>{" "}
              <span className="text-foreground">{installCommand}</span>
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
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
        <div className="w-6 h-10 rounded-full border-2 border-muted-foreground/30 flex items-start justify-center p-1">
          <div className="w-1.5 h-3 rounded-full bg-muted-foreground/50 animate-pulse" />
        </div>
      </div>
    </section>
  );
}

export { Hero };
