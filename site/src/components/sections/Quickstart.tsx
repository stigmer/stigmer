"use client";

import * as React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { viewportSettings } from "@/lib/animations";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  FadeInUp,
  StaggerContainer,
  StaggerItem,
  useReducedMotion,
} from "@/components/ui/motion";

export type QuickstartProps = React.HTMLAttributes<HTMLElement>;

/**
 * Quickstart section with installation commands and code examples.
 *
 * Features:
 * - Section heading
 * - Step-by-step installation guide
 * - Code blocks with syntax highlighting
 * - Copy-to-clipboard functionality
 * - Link to full documentation
 *
 * @example
 * <Quickstart />
 */
function Quickstart({ className, ...props }: QuickstartProps) {
  return (
    <section
      id="quickstart"
      className={cn("py-24 sm:py-32", className)}
      aria-labelledby="quickstart-heading"
      {...props}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header - Animated */}
        <FadeInUp>
          <div className="text-center mb-16">
            <h2
              id="quickstart-heading"
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
            >
              <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                From zero to running agent in 60 seconds
              </span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
              Install, start server, create agent, run. No configuration, no complexity.
            </p>
          </div>
        </FadeInUp>

        {/* Steps - Staggered with progress line */}
        <div className="relative">
          {/* Animated progress line */}
          <AnimatedProgressLine />

          <StaggerContainer className="space-y-8" staggerDelay={0.15} delayChildren={0.1}>
            {/* Step 1: Install */}
            <StaggerItem>
              <QuickstartStep
                number={1}
                title="Install the CLI"
                description="Install the Stigmer CLI. Works on macOS and Linux."
              >
                <CodeBlock
                  code="brew install stigmer/tap/stigmer"
                  language="bash"
                />
              </QuickstartStep>
            </StaggerItem>

            {/* Step 2: Start Server */}
            <StaggerItem>
              <QuickstartStep
                number={2}
                title="Start the server"
                description="Auto-starts Temporal, uses Ollama (free, local LLM), stores data in SQLite. Ready in seconds."
              >
                <CodeBlock
                  code="stigmer server"
                  language="bash"
                />
              </QuickstartStep>
            </StaggerItem>

            {/* Step 3: Create Agent */}
            <StaggerItem>
              <QuickstartStep
                number={3}
                title="Create an agent"
                description="Define an agent in 5 lines of YAML. Apply with: stigmer agent apply agent.yaml"
              >
                <CodeBlock
                  code={`apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: code-reviewer
spec:
  instructions: "Review code for security and best practices"
  mcpServers: [github]`}
                  language="yaml"
                />
              </QuickstartStep>
            </StaggerItem>

            {/* Step 4: Run Agent */}
            <StaggerItem>
              <QuickstartStep
                number={4}
                title="Run your agent"
                description="Execute your agent. Results stream to your terminal in real-time."
              >
                <CodeBlock
                  code='stigmer agent run code-reviewer "Review PR #123"'
                  language="bash"
                />
              </QuickstartStep>
            </StaggerItem>

            {/* Step 5: Integrate via gRPC */}
            <StaggerItem>
              <QuickstartStep
                number={5}
                title="Integrate into Your App"
                description="Agents expose gRPC endpoints. Call from any language. No custom SDKs, just standard gRPC clients."
              >
                <div className="space-y-4">
                  <CodeBlock
                    code={`// Execute an agent via gRPC
import agentexec "github.com/stigmer/stigmer/apis/ai/stigmer/agentic/agentexecution/v1"
import "github.com/stigmer/stigmer/apis/ai/stigmer/commons/apiresource"

client := agentexec.NewAgentExecutionCommandControllerClient(conn)
execution, err := client.Create(ctx, &agentexec.AgentExecution{
    Metadata: &apiresource.ApiResourceMetadata{
        OrganizationId: "your-org",
    },
    Spec: &agentexec.AgentExecutionSpec{
        AgentId: "code-reviewer",
        Input: "Review PR #123",
    },
})`}
                    language="go"
                  />
                  <p className="text-sm text-muted-foreground">
                    Python gRPC client example in docs (standard grpc-tools). Native Python SDK in active development—track progress on GitHub.
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <a 
                      href="/docs/integration/grpc" 
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      See full integration guide
                      <Icon name="arrow-right" size="xs" />
                    </a>
                  </p>
                </div>
              </QuickstartStep>
            </StaggerItem>
          </StaggerContainer>
        </div>

        {/* SDK Callout - Animated */}
        <FadeInUp delay={0.2}>
          <div className="mt-12 p-6 rounded-lg border border-border bg-muted/30">
            <div className="flex items-start gap-4">
              <div className="shrink-0">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/20 flex items-center justify-center">
                  <Icon name="code" size="lg" className="text-primary" />
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  Need more power? Use the Go SDK
                </h3>
                <p className="text-sm text-muted-foreground mb-3">
                  For complex production workflows, drop into code with the Go SDK:
                </p>
                <ul className="text-sm text-muted-foreground space-y-1 mb-4">
                  <li>• Full type safety and IDE autocomplete</li>
                  <li>• Programmatic workflow composition</li>
                  <li>• State management and error handling</li>
                  <li>• Unit testing and CI/CD integration</li>
                </ul>
                <p className="text-sm text-muted-foreground mb-4">
                  Python SDK in active development. Python developers can call agents via gRPC today using standard grpc-tools.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/docs/sdk">
                    See SDK docs
                    <Icon name="arrow-right" size="xs" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </FadeInUp>

        {/* Progression Path Callout - Animated */}
        <FadeInUp delay={0.3}>
          <div className="mt-12 p-6 rounded-lg border border-border bg-background">
            <h3 className="text-lg font-semibold text-foreground mb-4 text-center">
              From Local Development to Production Integration
            </h3>
            <StaggerContainer
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
              staggerDelay={0.1}
              delayChildren={0.1}
            >
              <StaggerItem>
                <ProgressionStep
                  number={1}
                  title="Develop Locally"
                  time=""
                  description="Write YAML agents, test with stigmer server, iterate in seconds"
                />
              </StaggerItem>
              <StaggerItem>
                <ProgressionStep
                  number={2}
                  title="Add Complexity"
                  time="optional"
                  description="Graduate to Go SDK when you need conditionals, loops, state management"
                />
              </StaggerItem>
              <StaggerItem>
                <ProgressionStep
                  number={3}
                  title="Integrate via gRPC"
                  time=""
                  description="Generate gRPC clients, call agents from your app like any service"
                />
              </StaggerItem>
              <StaggerItem>
                <ProgressionStep
                  number={4}
                  title="Deploy to Production"
                  time=""
                  description="Same code, managed infrastructure (coming soon)"
                />
              </StaggerItem>
            </StaggerContainer>
            <p className="mt-4 text-sm text-muted-foreground text-center">
              Start simple, scale naturally.
            </p>
          </div>
        </FadeInUp>

        {/* CTA - Animated */}
        <FadeInUp delay={0.4}>
          <div className="mt-16 text-center">
            <Button asChild size="lg">
              <Link href="/docs/getting-started">
                <Icon name="book-open" />
                Read the full documentation
              </Link>
            </Button>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

/**
 * Animated vertical progress line connecting the steps.
 * Respects reduced motion preference.
 */
function AnimatedProgressLine() {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    // Static fallback
    return (
      <div
        className="absolute left-4 sm:left-5 top-4 bottom-4 w-0.5 bg-gradient-to-b from-primary via-accent to-primary/20"
        aria-hidden="true"
      />
    );
  }

  return (
    <motion.div
      className="absolute left-4 sm:left-5 top-4 bottom-4 w-0.5 bg-gradient-to-b from-primary via-accent to-primary/20"
      aria-hidden="true"
      initial={{ scaleY: 0 }}
      whileInView={{ scaleY: 1 }}
      viewport={viewportSettings.standard}
      transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
      style={{ transformOrigin: "top" }}
    />
  );
}

/**
 * Individual quickstart step component.
 */
interface QuickstartStepProps {
  number: number;
  title: string;
  description: string;
  children: React.ReactNode;
}

function QuickstartStep({ number, title, description, children }: QuickstartStepProps) {
  return (
    <div className="relative pl-12 sm:pl-16">
      {/* Step number */}
      <div
        className={cn(
          "absolute left-0 top-0",
          "w-8 h-8 sm:w-10 sm:h-10",
          "rounded-full",
          "bg-gradient-to-br from-primary to-accent",
          "flex items-center justify-center",
          "text-sm sm:text-base font-bold text-white",
          "shadow-lg shadow-primary/30"
        )}
      >
        {number}
      </div>

      {/* Content */}
      <div>
        <h3 className="text-lg sm:text-xl font-semibold text-foreground mb-1">
          {title}
        </h3>
        <p className="text-sm sm:text-base text-muted-foreground mb-4">
          {description}
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * Code block with syntax highlighting and copy functionality.
 *
 * Accessibility features:
 * - ARIA live region announces copy status to screen readers
 * - Button has dynamic aria-label based on state
 * - Keyboard accessible copy button
 */
interface CodeBlockProps {
  code: string;
  language: string;
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers without clipboard API
      const textArea = document.createElement("textarea");
      textArea.value = code;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative group rounded-lg overflow-hidden border border-border bg-muted/30">
      {/* ARIA live region - announces copy status to screen readers */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {copied && "Code copied to clipboard"}
      </div>

      {/* Language badge */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/50">
        <span className="text-xs font-mono text-muted-foreground uppercase">
          {language}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          className={cn(
            "h-7 px-2 text-xs",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            // Ensure button is always accessible via keyboard even when visually hidden
            "focus:opacity-100"
          )}
          aria-label={copied ? "Copied to clipboard" : `Copy ${language} code`}
        >
          <Icon
            name={copied ? "check" : "copy"}
            size="xs"
            className={cn(copied && "text-green-500")}
            aria-hidden="true"
          />
          <span className="ml-1">{copied ? "Copied!" : "Copy"}</span>
        </Button>
      </div>

      {/* Code content */}
      <pre className="p-4 overflow-x-auto scrollbar-thin">
        <code className="text-sm font-mono text-foreground whitespace-pre">
          {code}
        </code>
      </pre>
    </div>
  );
}

/**
 * Progression step component for the progression path callout.
 */
interface ProgressionStepProps {
  number: number;
  title: string;
  time: string;
  description: string;
}

function ProgressionStep({ number, title, time, description }: ProgressionStepProps) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-white font-bold mb-2">
        {number}
      </div>
      <h4 className="text-sm font-semibold text-foreground mb-1">
        {title} <span className="text-xs text-muted-foreground">({time})</span>
      </h4>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {description}
      </p>
    </div>
  );
}

export { Quickstart };
