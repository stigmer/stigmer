"use client";

/**
 * Three more things we built, after the hard parts: one API for every
 * client, Anthropic's SDK reading a Stigmer session, and two agent engines,
 * each with its proof. The entries come from brand/agent-gets.ts
 * (`ALSO_BUILT`), where the proofs test holds each test they quote. Three
 * cards on one row on a large screen, stacked below it.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";
import { Proof } from "@/components/visuals/proof/Proof";
import { ALSO_BUILT } from "../../../../brand/agent-gets";

export type AlsoBuiltProps = React.HTMLAttributes<HTMLElement>;

function AlsoBuilt({ className, ...props }: AlsoBuiltProps) {
  return (
    <section
      id="also-built"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="also-built-heading"
      {...props}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <h2
            id="also-built-heading"
            className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-10"
          >
            Three more things we built
          </h2>
        </FadeInUp>

        <StaggerContainer
          className="grid grid-cols-1 lg:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border"
          staggerDelay={0.1}
          delayChildren={0.1}
        >
          {ALSO_BUILT.map((also) => (
            <StaggerItem key={also.id}>
              <article
                aria-labelledby={`also-built-${also.id}`}
                className="bg-background p-6 sm:p-8 h-full flex flex-col gap-4 min-w-0"
              >
                <h3 id={`also-built-${also.id}`} className="text-lg font-semibold text-foreground">
                  {also.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{also.sentence}</p>
                <div className="flex flex-col gap-4">
                  {also.proofs.map((proof, index) => (
                    <Proof key={index} proof={proof} />
                  ))}
                </div>
              </article>
            </StaggerItem>
          ))}
        </StaggerContainer>
      </div>
    </section>
  );
}

export { AlsoBuilt };
