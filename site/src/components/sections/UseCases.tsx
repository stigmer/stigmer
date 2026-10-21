"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { USE_CASES } from "@/lib/use-cases";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

export type UseCasesProps = React.HTMLAttributes<HTMLElement>;

/** The jobs inside other teams' products; Planton has its own section below. */
const OTHER_PRODUCTS = USE_CASES.filter((useCase) => useCase.id !== "planton");

function UseCases({ className, ...props }: UseCasesProps) {
  return (
    <section
      id="use-cases"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="use-cases-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              Use cases
            </p>
            <h2
              id="use-cases-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground"
            >
              Jobs done inside other teams&apos; products
            </h2>
          </div>
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          staggerDelay={0.08}
          delayChildren={0.1}
        >
          {OTHER_PRODUCTS.map((useCase) => (
            <StaggerItem key={useCase.id}>
              <div className="rounded-lg border border-border p-6 h-full flex flex-col">
                <h3 className="text-sm font-mono uppercase tracking-wider text-subtle mb-4">
                  {useCase.product}
                </h3>
                <p className="text-sm text-foreground leading-relaxed mb-3">{useCase.asks}</p>
                <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                  {useCase.handsBack}
                </p>
                <Link
                  href={`/use-cases#${useCase.id}`}
                  className="inline-flex items-center gap-1.5 text-sm text-foreground hover:text-foreground/80 transition-colors mt-6"
                >
                  See the job
                  <Icon name="arrow-right" size="xs" />
                </Link>
              </div>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}

export { UseCases };
