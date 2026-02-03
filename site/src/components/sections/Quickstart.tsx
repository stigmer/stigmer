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
              Get started in seconds
            </span>
          </h2>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
            Install Stigmer and run your first workflow with just a few commands.
          </p>
        </div>

        {/* Steps */}
        <div className="space-y-8">
          {/* Step 1: Install */}
          <QuickstartStep
            number={1}
            title="Install the CLI"
            description="Install Stigmer using Go's package manager."
          >
            <CodeBlock
              code="go install github.com/stigmer/stigmer/cmd/stigmer@latest"
              language="bash"
            />
          </QuickstartStep>

          {/* Step 2: Create workflow */}
          <QuickstartStep
            number={2}
            title="Create a workflow"
            description="Define your AI workflow in a simple YAML file."
          >
            <CodeBlock
              code={`# workflow.yaml
name: summarize
description: Summarize a document using AI

steps:
  - name: read-input
    action: file.read
    input:
      path: "\${input.file}"

  - name: summarize
    action: llm.complete
    input:
      model: gpt-4
      prompt: |
        Summarize the following document:
        \${steps.read-input.output}`}
              language="yaml"
            />
          </QuickstartStep>

          {/* Step 3: Run */}
          <QuickstartStep
            number={3}
            title="Run your workflow"
            description="Execute the workflow with a single command."
          >
            <CodeBlock
              code="stigmer run workflow.yaml --input file=document.txt"
              language="bash"
            />
          </QuickstartStep>
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

export { Quickstart };
