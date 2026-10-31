"use client";

/**
 * The homepage's hard parts: the five worries a developer already has about
 * putting an agent in front of their customers, each answered with what they
 * would build, what Stigmer gives instead, and the thing that proves it.
 *
 * The words, the order and the proofs come from brand/agent-gets.ts, which
 * the video and the demo read too; each row's docs link from
 * src/lib/agent-gets.ts. A row is the worry and its two lines on the left
 * (five of twelve columns on a large screen) and its proof on the right,
 * stacked on a phone. Under the rows, one line says where the tests live;
 * the section ends on the turn line and the hero's two buttons.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";
import { Proof } from "@/components/visuals/proof/Proof";
import { proofHref } from "@/components/visuals/proof/links";
import { AGENT_GET_IDS, AGENT_GETS } from "@/lib/agent-gets";
import { AGENT_GET_CLAIMS } from "../../../../brand/agent-gets";

export type HardPartsProps = React.HTMLAttributes<HTMLElement>;

/** The line that closes the list. */
export const TURN_LINE = "You could build all of that. Or use Stigmer.";

const LINK = "text-foreground underline underline-offset-4 hover:text-foreground/80";

function HardParts({ className, ...props }: HardPartsProps) {
  return (
    <section
      id="hard-parts"
      className={cn("py-24 sm:py-32", className)}
      aria-labelledby="hard-parts-heading"
      {...props}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16 max-w-4xl mx-auto">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              The problem
            </p>
            <h2
              id="hard-parts-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6"
            >
              Your customers want an agent that does the work. The machinery is the hard part.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              A chat window on a model API answers questions. An agent that does a job for each of
              your customers needs a computer to work on, hours to finish the job, a way to ask
              before it acts, and walls between one customer and the next. Most teams end up
              building that themselves.
            </p>
          </div>
        </FadeInUp>

        <div>
          {AGENT_GET_IDS.map((id) => {
            const claim = AGENT_GET_CLAIMS[id];
            const page = AGENT_GETS[id];
            return (
              <FadeInUp key={id}>
                <article
                  aria-labelledby={`hard-parts-${id}`}
                  className="grid grid-cols-1 lg:grid-cols-12 lg:items-start gap-6 lg:gap-10 border-t border-border py-10"
                >
                  <div className="lg:col-span-5 flex flex-col gap-4">
                    <h3
                      id={`hard-parts-${id}`}
                      className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground text-balance"
                    >
                      {claim.worry}
                    </h3>
                    <p className="flex flex-col gap-1">
                      <span className="text-xs font-mono uppercase tracking-wider text-subtle">
                        You&apos;d build
                      </span>
                      <span className="text-muted-foreground leading-relaxed">{claim.build}</span>
                    </p>
                    <p className="flex flex-col gap-1">
                      <span className="text-xs font-mono uppercase tracking-wider text-subtle">
                        Stigmer
                      </span>
                      <span className="text-foreground leading-relaxed">{claim.gives}</span>
                    </p>
                    <Link href={page.href} className={cn("inline-flex items-center gap-1.5 text-sm self-start", LINK)}>
                      {page.cta}
                      <Icon name="arrow-right" size="xs" />
                    </Link>
                  </div>
                  <div className="lg:col-span-7 min-w-0 rounded-lg border border-border bg-card p-5 sm:p-6 flex flex-col gap-6">
                    {claim.proofs.map((proof, index) => (
                      <Proof key={index} proof={proof} />
                    ))}
                  </div>
                </article>
              </FadeInUp>
            );
          })}
        </div>

        <p className="border-t border-border pt-6 text-sm text-muted-foreground">
          Every test named here is in the open-source repository, and its CI runs them.{" "}
          <a href={proofHref("test/README.md")} className={LINK}>
            How we test
          </a>{" "}
          ·{" "}
          <a href={proofHref("test/conformance/README.md")} className={LINK}>
            The conformance suite
          </a>
        </p>

        <FadeInUp>
          <div className="flex flex-col items-center gap-8 pt-20 text-center">
            <p className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground text-balance">
              {TURN_LINE}
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3 w-full sm:w-auto">
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
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

export { HardParts };
