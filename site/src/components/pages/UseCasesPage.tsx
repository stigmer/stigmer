"use client";

import * as React from "react";
import Link from "next/link";
import { SITE_CONFIG } from "@/lib/constants";
import { USE_CASES, type UseCase } from "@/lib/use-cases";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SkipLink } from "@/components/ui/skip-link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";

function UseCasesPage() {
  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        {/* Page header */}
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-4xl mx-auto text-center">
            <FadeInUp>
              <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
                Use cases
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
                What you can build
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Jobs done inside other teams&apos; products. Each customer gets their own agent,
                which does the job and hands back the result. For example:
              </p>
            </FadeInUp>
          </div>
        </section>

        {/* Use cases */}
        <section className="pb-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {USE_CASES.map((useCase, index) => (
              <FadeInUp key={useCase.id} delay={index * 0.05}>
                <UseCaseEntry useCase={useCase} />
              </FadeInUp>
            ))}
            <p className="pt-8 border-t border-border text-sm text-subtle leading-relaxed">
              It asks first wherever the product marks a step as needing a yes, such as a tool
              that changes something outside the agent&apos;s computer.{" "}
              <Link
                href="/docs/concepts/approval-flows"
                className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Approval flows
              </Link>{" "}
              says how.
            </p>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="py-16 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <FadeInUp>
              <h2 className="text-2xl font-bold text-foreground mb-4">Try the first job yourself</h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                The quickstart runs the accounting job on your own machine: you give an agent a
                ledger, and it hands back a report.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button asChild size="lg">
                  <a href={SITE_CONFIG.cloudSignupUrl}>
                    Start free
                    <Icon name="arrow-right" size="sm" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href="/docs/getting-started/quickstart">Run the quickstart</Link>
                </Button>
              </div>
            </FadeInUp>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function UseCaseEntry({ useCase }: { useCase: UseCase }) {
  const fields = [
    ["The customer asks", useCase.asks],
    ["The agent hands back", useCase.handsBack],
    ["It asks first", useCase.asksFirst],
  ] as const;
  return (
    <article className="py-12 border-t border-border scroll-mt-20" id={useCase.id}>
      <h2 className="text-2xl font-bold text-foreground mb-6">{useCase.product}</h2>

      <dl className="mb-8 space-y-4">
        {fields.map(([label, value]) => (
          <div key={label} className="sm:flex sm:items-start sm:gap-3">
            <dt className="text-xs font-mono uppercase tracking-wider text-subtle shrink-0 pt-0.5 sm:w-48 mb-1 sm:mb-0">
              {label}
            </dt>
            <dd className="text-sm text-muted-foreground leading-relaxed">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-sm text-subtle">
        Built with{" "}
        {useCase.builtWith.map((link, index) => (
          <React.Fragment key={link.href}>
            {index > 0 && (index === useCase.builtWith.length - 1 ? " and " : ", ")}
            <Link
              href={link.href}
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              {link.label}
            </Link>
          </React.Fragment>
        ))}
      </p>
    </article>
  );
}

export { UseCasesPage };
