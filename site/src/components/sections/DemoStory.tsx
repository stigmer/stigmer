"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { FadeInUp } from "@/components/ui/motion";

export type DemoStoryProps = React.HTMLAttributes<HTMLElement>;

function DemoStory({ className, ...props }: DemoStoryProps) {
  return (
    <section
      id="demo-story"
      className={cn("py-24 sm:py-32", className)}
      aria-labelledby="demo-story-heading"
      {...props}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              The problem
            </p>
            <h2
              id="demo-story-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6"
            >
              You added AI. It doesn&apos;t know your business.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              You built a chatbot with an LLM. It gives generic answers&mdash;it
              doesn&apos;t know your return policies, can&apos;t look up orders,
              and has no guardrails. Customers get wrong answers and call your
              team anyway.
            </p>
          </div>
        </FadeInUp>

        {/* Before quote */}
        <FadeInUp delay={0.1}>
          <QuoteBlock
            question="Can I return these shoes?"
            answer="Most retailers accept returns within 30 days."
            variant="before"
          />
        </FadeInUp>

        {/* Three acts */}
        <div className="mt-16 space-y-0">
          <FadeInUp delay={0.15}>
            <ActBlock
              number="01"
              label="Teach your domain"
              description="Upload return policies, product catalogs, escalation rules. No vector database. No embedding pipeline. Just your knowledge, in plain text."
              question="Can I return these shoes?"
              answer="Footwear returns are accepted within 14 days of delivery, unworn and in original packaging. Sale items are final sale. Would you like me to check if your order is eligible?"
            />
          </FadeInUp>

          <FadeInUp delay={0.2}>
            <ActBlock
              number="02"
              label="Connect your tools"
              description="Give the agent access to your order management API. It checks inventory, looks up orders, initiates returns — with the same APIs your team already uses."
              question="I'd like to return order #4821."
              answer="Your order is eligible for a return. I've started the process — you'll receive a prepaid shipping label at sarah@email.com within the hour."
            />
          </FadeInUp>

          <FadeInUp delay={0.25}>
            <ActBlock
              number="03"
              label="Set your rules"
              description="Mark which actions need human approval. Routine questions are handled automatically. Refund processing — humans stay in control."
              question="I bought the wrong size on three items. Can I return all of them?"
              answer="All three items meet the return policy. Total: $680. I've sent the details to the merchant for approval before processing."
            />
          </FadeInUp>
        </div>

        {/* After */}
        <FadeInUp delay={0.3}>
          <div className="mt-16 text-center">
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Every merchant on your platform now has an agent that knows their
              business, uses your systems, and follows their rules. You built a product
              feature, not plumbing.
            </p>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

function ActBlock({
  number,
  label,
  description,
  question,
  answer,
}: {
  number: string;
  label: string;
  description: string;
  question: string;
  answer: string;
}) {
  return (
    <div className="py-8 border-t border-border">
      <div className="flex items-start gap-6">
        <span className="text-xs font-mono text-subtle shrink-0 pt-1">
          {number}
        </span>
        <div className="flex-1">
          <h3 className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
            {label}
          </h3>
          <p className="text-muted-foreground mb-6 max-w-xl leading-relaxed">
            {description}
          </p>
          <QuoteBlock question={question} answer={answer} variant="after" />
        </div>
      </div>
    </div>
  );
}

function QuoteBlock({
  question,
  answer,
  variant,
}: {
  question: string;
  answer: string;
  variant: "before" | "after";
}) {
  return (
    <div className={cn(
      "rounded-lg border border-border p-4 sm:p-6",
      variant === "before" ? "bg-card/50" : "bg-card"
    )}>
      <p className="text-foreground font-medium mb-3">
        &ldquo;{question}&rdquo;
      </p>
      <p className={cn(
        "text-sm leading-relaxed",
        variant === "before" ? "text-subtle" : "text-muted-foreground"
      )}>
        → {answer}
      </p>
    </div>
  );
}

export { DemoStory };
