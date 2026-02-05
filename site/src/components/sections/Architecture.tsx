"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { transitions, viewportSettings } from "@/lib/animations";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { CodeSnippet } from "@/components/ui/code-block";
import {
  FadeInUp,
  StaggerContainer,
  StaggerItem,
  useReducedMotion,
} from "@/components/ui/motion";

export type ArchitectureProps = React.HTMLAttributes<HTMLElement>;

/**
 * Architecture section showcasing Stigmer's platform approach.
 *
 * Features:
 * - Three-column hero diagram (You Write → Stigmer Handles → You Integrate)
 * - Platform vs Framework comparison visual
 * - Developer journey timeline
 * - Custom SVG flow arrows
 * - Responsive design with mobile optimization
 *
 * @example
 * <Architecture />
 */
function Architecture({ className, ...props }: ArchitectureProps) {
  return (
    <section
      id="architecture"
      className={cn("py-24 sm:py-32 bg-muted/30", className)}
      aria-labelledby="architecture-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header - Animated */}
        <FadeInUp>
          <div className="text-center mb-16">
            <h2
              id="architecture-heading"
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
            >
              <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                How It Works
              </span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto">
              From YAML to production-ready gRPC service. The infrastructure you don&apos;t have to build.
            </p>
          </div>
        </FadeInUp>

        {/* Hero Architecture Diagram */}
        <ArchitectureDiagram />

        {/* Platform vs Framework Comparison - Animated */}
        <FadeInUp className="mt-24">
          <PlatformComparisonVisual />
        </FadeInUp>

        {/* Developer Journey - Animated */}
        <FadeInUp className="mt-24">
          <DeveloperJourneyFlow />
        </FadeInUp>
      </div>
    </section>
  );
}

/**
 * Three-column hero architecture diagram.
 * Shows: You Write → Stigmer Handles → You Integrate
 */
function ArchitectureDiagram() {
  return (
    <div className="relative">
      {/* Desktop: 3-column layout with arrows - Sequential animation */}
      <div className="hidden lg:flex lg:items-start lg:gap-8">
        {/* Column 1: You Write */}
        <FadeInUp delay={0} className="flex flex-col flex-1 min-w-0">
          <ColumnHeader
            title="You Write"
            subtitle="YAML for speed, SDK for production"
            variant="input"
          />
          <CodeTabViewer />
        </FadeInUp>

        {/* Column 2: Stigmer Handles */}
        <FadeInUp delay={0.2} className="flex flex-col flex-1 min-w-0">
          <ColumnHeader
            title="Stigmer Handles"
            subtitle="The infrastructure layer you skip"
            variant="platform"
          />
          <PlatformLayerStack />
        </FadeInUp>

        {/* Column 3: You Integrate */}
        <FadeInUp delay={0.4} className="flex flex-col flex-1 min-w-0">
          <ColumnHeader
            title="You Integrate"
            subtitle="Call your agents from any application"
            variant="output"
          />
          <IntegrationCard />
        </FadeInUp>
      </div>

      {/* Tablet: 2-column layout */}
      <div className="hidden md:grid md:grid-cols-2 md:gap-8 lg:hidden">
        <StaggerContainer className="space-y-8" staggerDelay={0.15}>
          <StaggerItem>
            <ColumnHeader
              title="You Write"
              subtitle="YAML for speed, SDK for production"
              variant="input"
            />
            <CodeTabViewer />
          </StaggerItem>
          <StaggerItem>
            <ColumnHeader
              title="Stigmer Handles"
              subtitle="The infrastructure layer you skip"
              variant="platform"
            />
            <PlatformLayerStack />
          </StaggerItem>
        </StaggerContainer>
        <FadeInUp delay={0.2}>
          <ColumnHeader
            title="You Integrate"
            subtitle="Call your agents from any application"
            variant="output"
          />
          <IntegrationCard />
        </FadeInUp>
      </div>

      {/* Mobile: Single column */}
      <StaggerContainer className="md:hidden space-y-8" staggerDelay={0.1}>
        <StaggerItem>
          <ColumnHeader
            title="You Write"
            subtitle="YAML for speed, SDK for production"
            variant="input"
          />
          <CodeTabViewer />
        </StaggerItem>

        <StaggerItem>
          <div className="flex justify-center py-4">
            <AnimatedVerticalArrow />
          </div>
        </StaggerItem>

        <StaggerItem>
          <ColumnHeader
            title="Stigmer Handles"
            subtitle="The infrastructure layer you skip"
            variant="platform"
          />
          <PlatformLayerStack />
        </StaggerItem>

        <StaggerItem>
          <div className="flex justify-center py-4">
            <AnimatedVerticalArrow />
          </div>
        </StaggerItem>

        <StaggerItem>
          <ColumnHeader
            title="You Integrate"
            subtitle="Call your agents from any application"
            variant="output"
          />
          <IntegrationCard />
        </StaggerItem>
      </StaggerContainer>
    </div>
  );
}

/**
 * Column header component for architecture diagram sections.
 */
interface ColumnHeaderProps {
  title: string;
  subtitle: string;
  variant: "input" | "platform" | "output";
}

function ColumnHeader({ title, subtitle, variant }: ColumnHeaderProps) {
  const variantStyles = {
    input: "from-foreground to-foreground",
    platform: "from-primary via-accent to-primary bg-[length:200%_auto]",
    output: "from-foreground to-muted-foreground",
  };

  return (
    <div className="mb-6 text-center lg:text-left">
      <h3 className={cn(
        "text-2xl font-bold mb-2 bg-gradient-to-r bg-clip-text text-transparent",
        variantStyles[variant]
      )}>
        {title}
      </h3>
      <p className="text-base text-muted-foreground">
        {subtitle}
      </p>
    </div>
  );
}

/**
 * Animated vertical arrow for mobile layout.
 */
function AnimatedVerticalArrow() {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return (
      <svg width="24" height="48" viewBox="0 0 24 48" fill="none" className="text-primary">
        <path d="M12 0 L12 42 M6 36 L12 42 L18 36" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }

  return (
    <motion.svg
      width="24"
      height="48"
      viewBox="0 0 24 48"
      fill="none"
      className="text-primary"
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={viewportSettings.standard}
      transition={{ duration: 0.3 }}
    >
      <motion.path
        d="M12 0 L12 42 M6 36 L12 42 L18 36"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={viewportSettings.standard}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </motion.svg>
  );
}

/**
 * Code snippet card with syntax highlighting.
 */
interface CodeSnippetCardProps {
  language: string;
  code: string;
}

function CodeSnippetCard({ language, code }: CodeSnippetCardProps) {
  return (
    <Card variant="feature" className="overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 border-b border-border">
        <span className="text-xs font-mono text-muted-foreground uppercase">
          {language}
        </span>
      </div>
      <div className="p-4">
        <CodeSnippet code={code} language={language} size="sm" />
      </div>
    </Card>
  );
}

/**
 * Code viewer showing YAML example with SDK option.
 */
function CodeTabViewer() {
  const [showSDK, setShowSDK] = React.useState(false);
  
  const yamlCode = `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
spec:
  instructions: "Review code"
  mcpServers: [github]`;

  const goCode = `stigmer.Run(func(ctx *stigmer.Context) error {
  a, _ := agent.New(ctx, "code-reviewer", 
    &agent.AgentArgs{
      Instructions: "Review code",
    })
  a.UseMCP("stigmer/github")
  return nil
})`;

  return (
    <div className="space-y-4">
      {/* Toggle buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => setShowSDK(false)}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
            !showSDK
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          )}
        >
          YAML
        </button>
        <button
          onClick={() => setShowSDK(true)}
          className={cn(
            "px-3 py-1.5 rounded-md text-xs font-medium transition-all",
            showSDK
              ? "bg-primary text-primary-foreground"
              : "bg-muted/50 text-muted-foreground hover:bg-muted"
          )}
        >
          Go SDK
        </button>
      </div>

      {/* Code display */}
      <CodeSnippetCard 
        language={showSDK ? "go" : "yaml"} 
        code={showSDK ? goCode : yamlCode} 
      />

      {/* Context note */}
      <p className="text-xs text-muted-foreground mb-4">
        {showSDK 
          ? "Type-safe SDK for complex agents with conditionals and state"
          : "Simple YAML for rapid prototyping and quick iteration"
        }
      </p>

      {/* Feature badges */}
      <div className="space-y-3">
        {(showSDK ? [
          { label: "Type Safety", desc: "Compile-time validation" },
          { label: "Conditionals", desc: "If/else, loops, state" },
          { label: "Testable", desc: "Unit test your agents" },
        ] : [
          { label: "No Build Step", desc: "Edit and run instantly" },
          { label: "Git-Friendly", desc: "Version control ready" },
          { label: "IDE Support", desc: "YAML schema validation" },
        ]).map((item) => (
          <div 
            key={item.label}
            className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-muted/30 border border-border"
          >
            <span className="text-sm font-medium">{item.label}</span>
            <span className="text-xs text-muted-foreground">{item.desc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Platform layer stack showing infrastructure components.
 */
function PlatformLayerStack() {
  const layers = [
    {
      icon: "network" as IconName,
      title: "Invoke Agents via API",
      description: "Call any agent from your apps using standard gRPC",
    },
    {
      icon: "shield" as IconName,
      title: "Sandbox Isolation",
      description: "Isolated file system, controlled process execution",
    },
    {
      icon: "cpu" as IconName,
      title: "Temporal Orchestration",
      description: "Automatic retries, durable state",
    },
    {
      icon: "lock" as IconName,
      title: "MCP Security",
      description: "Tool filtering, environment secrets",
    },
    {
      icon: "terminal" as IconName,
      title: "Local Runtime",
      description: "SQLite + Ollama, zero Docker required",
    },
  ];

  return (
    <StaggerContainer className="space-y-4" staggerDelay={0.08} delayChildren={0.1}>
      {layers.map((layer) => (
        <StaggerItem key={layer.title}>
          <Card
            variant="feature"
            className={cn(
              "p-5 transition-all duration-300 hover:scale-[1.02]",
              layer.highlight && "border-2 border-primary/30 bg-gradient-to-br from-primary/10 to-accent/10"
            )}
          >
            <div className="flex items-start gap-3">
              <motion.div
                className={cn(
                  "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                  layer.highlight
                    ? "bg-gradient-to-br from-primary/30 to-accent/30 border-2 border-primary/40"
                    : "bg-muted border border-border"
                )}
                whileHover={{ scale: 1.1 }}
                transition={transitions.spring}
              >
                <Icon
                  name={layer.icon}
                  size="sm"
                  className={layer.highlight ? "text-primary" : "text-muted-foreground"}
                />
              </motion.div>
              <div className="flex-1 min-w-0">
                <h4 className={cn(
                  "text-sm font-semibold mb-1",
                  layer.highlight ? "text-foreground" : "text-foreground/90"
                )}>
                  {layer.title}
                </h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {layer.description}
                </p>
              </div>
            </div>
          </Card>
        </StaggerItem>
      ))}
    </StaggerContainer>
  );
}

/**
 * Integration card showing multi-language gRPC integration.
 */
function IntegrationCard() {
  const languages = [
    { name: "Go", icon: "code" as IconName },
    { name: "Python", icon: "code" as IconName },
    { name: "Java", icon: "code" as IconName },
    { name: "TypeScript", icon: "code" as IconName },
    { name: "Rust", icon: "code" as IconName },
  ];

  return (
    <div className="space-y-6">
      {/* Language badges */}
      <Card variant="feature" className="p-7">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="network" size="sm" className="text-primary" />
          <h4 className="text-sm font-semibold">Standard gRPC Protocol</h4>
        </div>
        <div className="flex flex-wrap gap-2 mb-4">
          {languages.map((lang) => (
            <div
              key={lang.name}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted/50 border border-border"
            >
              <Icon name={lang.icon} size="xs" className="text-muted-foreground" />
              <span className="text-xs font-medium">{lang.name}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Any language with gRPC support works out of the box
        </p>
      </Card>

      {/* Code example */}
      <CodeSnippetCard
        language="go"
        code={`// Execute agent
exec, _ := client.Create(ctx, 
  &AgentExecution{
    AgentId: "code-reviewer",
    Message: "Review PR #123",
  })

// Stream updates
stream, _ := client.Subscribe(ctx, exec.Id)
for {
  resp, _ := stream.Recv()
  if resp.Phase == "COMPLETED" { break }
}`}
      />

      {/* Technical foundation footer */}
      <div className="pt-4 border-t border-border">
        <p className="text-sm text-muted-foreground text-center mb-3">
          Built on proven infrastructure
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground/80">
          <span>Temporal Workflows</span>
          <span className="text-muted-foreground/40">•</span>
          <span>SQLite/BadgerDB</span>
          <span className="text-muted-foreground/40">•</span>
          <span>Public Proto Contracts</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Platform vs Framework comparison visual.
 */
function PlatformComparisonVisual() {
  return (
    <div>
      <div className="text-center mb-12">
        <h3 className="text-2xl sm:text-3xl font-bold mb-3">
          Why Platform, Not Framework
        </h3>
        <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
          Update agents independently. All consumers benefit instantly.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Framework Approach */}
        <Card variant="bordered" className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-muted border border-border flex items-center justify-center">
              <Icon name="package" size="lg" className="text-muted-foreground" />
            </div>
            <h4 className="text-xl font-bold">Framework Approach</h4>
          </div>

          {/* Visual diagram */}
          <div className="mb-6 p-6 bg-muted/30 rounded-lg">
            <div className="space-y-4">
              <AppBox label="App 1" hasAgent />
              <AppBox label="App 2" hasAgent />
            </div>
            <p className="text-xs text-muted-foreground text-center mt-4">
              Update agent = redeploy all apps
            </p>
          </div>

          {/* Characteristics */}
          <ul className="space-y-2 text-sm text-muted-foreground">
            <CharacteristicItem text="Import agent library into each app" />
            <CharacteristicItem text="Tightly coupled to app code" />
            <CharacteristicItem text="Redeploy all apps to update agent" />
            <CharacteristicItem text="Custom integration per language" />
          </ul>
        </Card>

        {/* Stigmer Approach */}
        <Card variant="feature" className="p-6 sm:p-8 border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20 flex items-center justify-center">
              <Icon name="network" size="lg" className="text-primary" />
            </div>
            <h4 className="text-xl font-bold">Stigmer Approach</h4>
          </div>

          {/* Visual diagram */}
          <div className="mb-6 p-6 bg-background/50 rounded-lg">
            <div className="flex items-center justify-center gap-4">
              {/* App 1 */}
              <AppBox label="App 1" />
              
              {/* Arrow from App 1 to Agent */}
              <svg width="40" height="20" viewBox="0 0 40 20" className="text-primary/60 shrink-0">
                <path d="M0 10 L35 10 M28 5 L35 10 L28 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              
              {/* Agent Service (center) */}
              <AgentServiceBox />
              
              {/* Arrow from Agent to App 2 */}
              <svg width="40" height="20" viewBox="0 0 40 20" className="text-primary/60 shrink-0">
                <path d="M40 10 L5 10 M12 5 L5 10 L12 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              
              {/* App 2 */}
              <AppBox label="App 2" />
            </div>
            <p className="text-xs text-primary/80 text-center mt-4 font-medium">
              Update agent = instant benefit for all
            </p>
          </div>

          {/* Characteristics */}
          <ul className="space-y-2 text-sm">
            <CharacteristicItem text="Create agent once (YAML or SDK)" highlight />
            <CharacteristicItem text="Loosely coupled via gRPC" highlight />
            <CharacteristicItem text="Update agent, all consumers benefit instantly" highlight />
            <CharacteristicItem text="Standard gRPC (Go, Python, Java, TypeScript, Rust)" highlight />
          </ul>
        </Card>
      </div>
    </div>
  );
}

/**
 * App box component for comparison diagram.
 */
function AppBox({ label, hasAgent }: { label: string; hasAgent?: boolean }) {
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <div className="px-4 py-2 rounded-lg border-2 border-border bg-background text-xs font-medium">
        {label}
        {hasAgent && (
          <div className="mt-1 text-[10px] text-muted-foreground">[Agent Library]</div>
        )}
      </div>
    </div>
  );
}

/**
 * Agent service box for comparison diagram.
 */
function AgentServiceBox() {
  return (
    <div className="px-6 py-3 rounded-lg border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-accent/10">
      <div className="flex items-center gap-2">
        <Icon name="network" size="sm" className="text-primary" />
        <div>
          <div className="text-sm font-semibold">Agent Service</div>
          <div className="text-[10px] text-muted-foreground">gRPC endpoint</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Characteristic item for comparison lists.
 */
function CharacteristicItem({ text, highlight }: { text: string; highlight?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cn(
        "shrink-0 mt-0.5",
        highlight ? "text-primary" : "text-muted-foreground"
      )}>
        {highlight ? "✓" : "•"}
      </span>
      <span className={cn(
        highlight ? "text-foreground font-medium" : "text-muted-foreground"
      )}>
        {text}
      </span>
    </li>
  );
}

/**
 * Developer journey timeline.
 */
function DeveloperJourneyFlow() {
  const steps = [
    {
      number: 1,
      title: "Develop Locally",
      description: "Write YAML agents, test with stigmer server, iterate in seconds",
      details: ["stigmer server", "SQLite + Ollama", "Zero config"],
    },
    {
      number: 2,
      title: "Add Complexity",
      description: "Graduate to Go SDK when you need conditionals, loops, state management",
      details: ["Go SDK", "Type safety", "Optional"],
      optional: true,
    },
    {
      number: 3,
      title: "Integrate via gRPC",
      description: "Generate gRPC clients, call agents from your app like any service",
      details: ["Any language", "Standard protocol", "Public protos"],
    },
    {
      number: 4,
      title: "Scale to Production",
      description: "Same code, managed infrastructure for production workloads",
      details: ["Same code", "Managed infra", "Coming soon"],
    },
  ];

  return (
    <div>
      <FadeInUp>
        <div className="text-center mb-12">
          <h3 className="text-2xl sm:text-3xl font-bold mb-3">
            Start Simple, Scale Naturally
          </h3>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            From local development to production integration. Same platform, your pace.
          </p>
        </div>
      </FadeInUp>

      {/* Desktop: Horizontal timeline - Staggered */}
      <StaggerContainer
        className="hidden sm:grid sm:grid-cols-4 sm:gap-4"
        staggerDelay={0.12}
        delayChildren={0.1}
      >
        {steps.map((step) => (
          <StaggerItem key={step.number}>
            <JourneyStep {...step} />
          </StaggerItem>
        ))}
      </StaggerContainer>

      {/* Mobile: Vertical timeline - Staggered */}
      <StaggerContainer
        className="sm:hidden space-y-6"
        staggerDelay={0.1}
        delayChildren={0.1}
      >
        {steps.map((step) => (
          <StaggerItem key={step.number}>
            <JourneyStep {...step} vertical />
          </StaggerItem>
        ))}
      </StaggerContainer>

      {/* Footer note */}
      <FadeInUp delay={0.5}>
        <div className="mt-8 text-center">
          <p className="text-sm text-muted-foreground">
            Same gRPC contracts from local development to production deployment
          </p>
        </div>
      </FadeInUp>
    </div>
  );
}

/**
 * Individual journey step component.
 */
interface JourneyStepProps {
  number: number;
  title: string;
  description: string;
  details: string[];
  optional?: boolean;
  vertical?: boolean;
}

function JourneyStep({ number, title, description, details, optional, vertical }: JourneyStepProps) {
  return (
    <div className={cn(
      "relative",
      vertical && "flex gap-4"
    )}>
      {/* Number badge */}
      <div className={cn(
        "flex items-center gap-3",
        vertical ? "flex-col" : "flex-col items-center mb-4"
      )}>
        <div className={cn(
          "w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold text-lg shrink-0",
          "shadow-lg shadow-primary/30"
        )}>
          {number}
        </div>
        {optional && (
          <div className="px-2 py-0.5 rounded text-[10px] font-medium bg-accent/20 text-accent shrink-0">
            Optional
          </div>
        )}
      </div>

      {/* Content */}
      <div className={cn(vertical && "flex-1")}>
        <h4 className={cn(
          "font-bold mb-2",
          vertical ? "text-base" : "text-center text-sm"
        )}>
          {title}
        </h4>
        <p className={cn(
          "text-muted-foreground mb-3 leading-relaxed",
          vertical ? "text-sm" : "text-center text-xs"
        )}>
          {description}
        </p>
        <div className={cn(
          "flex flex-wrap gap-1.5",
          !vertical && "justify-center"
        )}>
          {details.map((detail) => (
            <span
              key={detail}
              className="px-2 py-1 rounded text-[10px] font-medium bg-muted/50 border border-border text-muted-foreground"
            >
              {detail}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export { Architecture };
