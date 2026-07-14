"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";

export type FinalCTAProps = React.HTMLAttributes<HTMLElement>;

function FinalCTA({ className, ...props }: FinalCTAProps) {
  return (
    <section
      id="final-cta"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="final-cta-heading"
      {...props}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <FadeInUp>
            <h2
              id="final-cta-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4"
            >
              Start building
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-8">
              Your first agent takes five minutes. Sign up for cloud or install the CLI.
            </p>
          </FadeInUp>

          <FadeInUp delay={0.1}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button asChild size="lg">
                <a href={SITE_CONFIG.cloudSignupUrl}>
                  Start Free
                  <Icon name="arrow-right" size="sm" />
                </a>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link href="/docs/sdk">
                  View SDKs
                </Link>
              </Button>
            </div>
          </FadeInUp>
        </div>

        {/* SDK install snippets */}
        <FadeInUp delay={0.2}>
          <SDKSnippets />
        </FadeInUp>
      </div>
    </section>
  );
}

function SDKSnippets() {
  const [activeTab, setActiveTab] = React.useState<
    "ts" | "go" | "python" | "java"
  >("ts");

  const snippets = {
    ts: {
      label: "TypeScript",
      installPrefix: "$",
      install: "npm install @stigmer/sdk",
      code: `import { Stigmer } from "@stigmer/sdk";

const stigmer = new Stigmer({
  baseUrl: "https://api.stigmer.ai",
  apiKey: "sk_...",
});

const execution = await stigmer.agentExecution.create({
  org: "my-org",
  name: "support-run",
  agentId: "support-agent",
  message: "Can I return these shoes?",
});`,
    },
    go: {
      label: "Go",
      installPrefix: "$",
      install: "go get github.com/stigmer/stigmer/sdk/go/v3",
      code: `import stigmer "github.com/stigmer/stigmer/sdk/go/v3"

client, _ := stigmer.NewClient("sk_...")
defer client.Close()

exec, _ := client.AgentExecution.Create(ctx,
  &stigmer.AgentExecutionInput{
    Org:     "my-org",
    Name:    "support-run",
    AgentId: "support-agent",
    Message: "Can I return these shoes?",
  },
)`,
    },
    python: {
      label: "Python",
      installPrefix: "$",
      install: "pip install stigmer",
      code: `from stigmer import StigmerClient, AgentExecutionInput

with StigmerClient("sk_...") as client:
    execution = client.agent_executions.create(
        AgentExecutionInput(
            org="my-org",
            name="support-run",
            agent_id="support-agent",
            message="Can I return these shoes?",
        )
    )`,
    },
    java: {
      label: "Java",
      installPrefix: "// Gradle:",
      install: `implementation("ai.stigmer:stigmer-java:0.1.0")`,
      code: `import ai.stigmer.sdk.StigmerClient;
import ai.stigmer.sdk.gen.AgentExecutionInput;

try (var client = StigmerClient.builder("sk_...").build()) {
    var execution = client.agentExecutions().create(
        AgentExecutionInput.builder()
            .org("my-org")
            .name("support-run")
            .agentId("support-agent")
            .message("Can I return these shoes?")
            .build()
    );
}`,
    },
  };

  const active = snippets[activeTab];

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {(Object.keys(snippets) as Array<keyof typeof snippets>).map((key) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              "px-4 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors",
              activeTab === key
                ? "text-foreground bg-card"
                : "text-subtle hover:text-muted-foreground"
            )}
          >
            {snippets[key].label}
          </button>
        ))}
      </div>

      {/* Install command */}
      <div className="px-4 sm:px-6 py-3 border-b border-border bg-card/50">
        <code className="text-xs font-mono text-muted-foreground">
          {active.installPrefix && (
            <span className="text-subtle">{active.installPrefix} </span>
          )}
          {active.install}
        </code>
      </div>

      {/* Code */}
      <div className="p-4 sm:p-6 bg-card">
        <pre className="text-sm font-mono text-muted-foreground leading-relaxed overflow-x-auto">
          {active.code}
        </pre>
      </div>
    </div>
  );
}

export { FinalCTA };
