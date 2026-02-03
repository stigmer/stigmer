"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

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
        {/* Section Header */}
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

        {/* Steps */}
        <div className="space-y-8">
          {/* Step 1: Install */}
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

          {/* Step 2: Start Server */}
          <QuickstartStep
            number={2}
            title="Start the server"
            description="That's it. Auto-downloads Temporal, uses free Ollama models, ready in < 3 seconds."
          >
            <CodeBlock
              code="stigmer server"
              language="bash"
            />
          </QuickstartStep>

          {/* Step 3: Create Agent */}
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

          {/* Step 4: Run Agent */}
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

          {/* Step 5: Integrate via gRPC */}
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
        </div>

        {/* SDK Callout */}
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

        {/* Progression Path Callout */}
        <div className="mt-12 p-6 rounded-lg border border-border bg-background">
          <h3 className="text-lg font-semibold text-foreground mb-4 text-center">
            From Creation to Integration in 20 Minutes
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <ProgressionStep
              number={1}
              title="Create"
              time="5 min"
              description="Write a 5-line YAML agent in Stigmer Cloud"
            />
            <ProgressionStep
              number={2}
              title="Test"
              time="5 min"
              description="Run agent via CLI or web UI"
            />
            <ProgressionStep
              number={3}
              title="Integrate"
              time="10 min"
              description="Call agent from your app via gRPC"
            />
            <ProgressionStep
              number={4}
              title="Scale"
              time="ongoing"
              description="Update agent independently, all consumers benefit"
            />
          </div>
          <p className="mt-4 text-sm text-muted-foreground text-center">
            Start simple, scale naturally. No rip-and-replace.
          </p>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <Button asChild size="lg">
            <Link href="/docs/getting-started">
              <Icon name="book-open" />
              Read the full documentation
            </Link>
          </Button>
        </div>
      </div>
    </section>
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
      // Fallback
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
            "opacity-0 group-hover:opacity-100 transition-opacity"
          )}
          aria-label={copied ? "Copied!" : "Copy code"}
        >
          <Icon
            name={copied ? "check" : "copy"}
            size="xs"
            className={cn(copied && "text-green-500")}
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
