"use client";

import * as React from "react";
import Link from "next/link";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
} from "framer-motion";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
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
                {SITE_CONFIG.tagline}
              </h1>
            </FadeInUp>

            <FadeInUp delay={0.35}>
              <p className="text-lg sm:text-xl text-muted-foreground max-w-xl mb-8 leading-relaxed">
                Teach them your domain. Connect your tools. Set your rules.
              </p>
            </FadeInUp>

            <FadeInUp delay={0.5}>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
                <Button asChild size="lg">
                  <a href={SITE_CONFIG.cloudSignupUrl}>
                    Start Free
                    <Icon name="arrow-right" size="sm" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/docs/getting-started/quickstart">
                    Read the Docs
                  </Link>
                </Button>
              </div>
            </FadeInUp>
          </div>

          {/* Right: Code preview */}
          <FadeInUp delay={0.4}>
            <CodePreview />
          </FadeInUp>
        </div>

        {/* Stats bar */}
        <FadeInUp delay={0.6}>
          <div className="mt-16 pt-8 border-t border-border">
            <div className="flex flex-wrap items-center gap-8 sm:gap-12">
              <StatItem label="License" value="Apache 2.0" />
              <StatItem label="SDKs" value="Go · TS · Python · Java" />
              <StatItem label="API" value="gRPC + Protobuf" />
              <StatItem label="Execution" value="Durable via Temporal" />
            </div>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

const TILT_DEGREES = 8;
const SPRING_CONFIG = { stiffness: 200, damping: 20, mass: 0.5 };

function CodePreview() {
  const ref = React.useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const mouseX = useMotionValue(0.5);
  const mouseY = useMotionValue(0.5);

  const rotateX = useSpring(
    useTransform(mouseY, [0, 1], [TILT_DEGREES, -TILT_DEGREES]),
    SPRING_CONFIG,
  );
  const rotateY = useSpring(
    useTransform(mouseX, [0, 1], [-TILT_DEGREES, TILT_DEGREES]),
    SPRING_CONFIG,
  );

  const glowX = useTransform(mouseX, [0, 1], [0, 100]);
  const glowY = useTransform(mouseY, [0, 1], [0, 100]);
  const glowBackground = useTransform(
    [glowX, glowY],
    ([x, y]) =>
      `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.06) 0%, transparent 60%)`,
  );

  const [isHovered, setIsHovered] = React.useState(false);

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      mouseX.set((e.clientX - rect.left) / rect.width);
      mouseY.set((e.clientY - rect.top) / rect.height);
    },
    [mouseX, mouseY],
  );

  const handleMouseEnter = React.useCallback(() => setIsHovered(true), []);

  const handleMouseLeave = React.useCallback(() => {
    mouseX.set(0.5);
    mouseY.set(0.5);
    setIsHovered(false);
  }, [mouseX, mouseY]);

  if (prefersReducedMotion) {
    return <CodePreviewCard />;
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        rotateX,
        rotateY,
        transformPerspective: 800,
        transformStyle: "preserve-3d",
      }}
      whileHover={{ scale: 1.02 }}
      transition={{ scale: { duration: 0.25, ease: "easeOut" } }}
      className="relative will-change-transform"
    >
      <motion.div
        className="absolute -inset-px rounded-lg pointer-events-none"
        animate={{ opacity: isHovered ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        style={{ background: glowBackground }}
      />
      <CodePreviewCard />
    </motion.div>
  );
}

function CodePreviewCard() {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Terminal title bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <div className="flex gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="text-xs font-mono text-subtle ml-2">agent.yaml</span>
      </div>
      {/* Code content */}
      <div className="p-4 sm:p-6 font-mono text-sm leading-relaxed overflow-x-auto">
        <CodeLine comment="# Define your agent" />
        <CodeLine>
          <Keyword>kind</Keyword>: Agent
        </CodeLine>
        <CodeLine>
          <Keyword>name</Keyword>: support-agent
        </CodeLine>
        <CodeLine>
          <Keyword>model</Keyword>: claude-sonnet
        </CodeLine>
        <CodeLine />
        <CodeLine comment="# Teach it your domain" />
        <CodeLine>
          <Keyword>skills</Keyword>:
        </CodeLine>
        <CodeLine indent={1}>
          - return-policy
        </CodeLine>
        <CodeLine indent={1}>
          - product-catalog
        </CodeLine>
        <CodeLine />
        <CodeLine comment="# Connect your tools" />
        <CodeLine>
          <Keyword>tools</Keyword>:
        </CodeLine>
        <CodeLine indent={1}>
          - order-management
        </CodeLine>
        <CodeLine />
        <CodeLine comment="# Set your rules" />
        <CodeLine>
          <Keyword>approvals</Keyword>:
        </CodeLine>
        <CodeLine indent={1}>
          - process-refund
        </CodeLine>
      </div>
    </div>
  );
}

function CodeLine({
  children,
  comment,
  indent = 0,
}: {
  children?: React.ReactNode;
  comment?: string;
  indent?: number;
}) {
  const padding = indent > 0 ? `${indent * 1.5}rem` : undefined;

  if (comment) {
    return (
      <div className="text-subtle" style={{ paddingLeft: padding }}>
        {comment}
      </div>
    );
  }

  if (!children) {
    return <div className="h-5" />;
  }

  return (
    <div className="text-muted-foreground" style={{ paddingLeft: padding }}>
      {children}
    </div>
  );
}

function Keyword({ children }: { children: React.ReactNode }) {
  return <span className="text-foreground">{children}</span>;
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
