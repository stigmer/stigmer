"use client";

/**
 * The sandbox, up close: the three questions a buyer of agent
 * infrastructure asks about the computer each conversation gets (what's on
 * it, what it can reach, what happens when nobody's using it), each answered
 * with the real thing and the public tests that check it.
 *
 * The words, the Environment file and the proofs come from brand/sandbox.ts.
 * Under the heading, one line says where the section holds, linking the
 * runners guide's driver table. Each panel is a row like the hard parts':
 * its number, question and sentences on five of twelve columns on a large
 * screen, and its artifact with its proofs on seven, in a card; stacked on a
 * phone. The rows are wide because the real Environment file needs the
 * room; on a phone only the file's own box scrolls sideways.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import {
  FadeInUp,
  StaggerContainer,
  StaggerItem,
} from "@/components/ui/motion";
import { Proof } from "@/components/visuals/proof/Proof";
import { SourceProof } from "@/components/visuals/proof/SourceProof";
import { EnvironmentFile } from "@/components/visuals/sandbox/EnvironmentFile";
import { ReachList } from "@/components/visuals/sandbox/ReachList";
import { SleepSteps } from "@/components/visuals/sandbox/SleepSteps";
import {
  SANDBOX_HEADING,
  SANDBOX_PANEL_ORDER,
  SANDBOX_PANELS,
  SANDBOX_SCOPE,
  type SandboxPanelId,
} from "../../../../brand/sandbox";

export type SandboxProps = React.HTMLAttributes<HTMLElement>;

const ARTIFACTS: Readonly<Record<SandboxPanelId, () => React.ReactElement>> = {
  inside: EnvironmentFile,
  reach: ReachList,
  sleep: SleepSteps,
};

function Sandbox({ className, ...props }: SandboxProps) {
  return (
    <section
      id="sandbox"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="sandbox-heading"
      {...props}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="mb-14 max-w-3xl flex flex-col gap-4">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle">
              {SANDBOX_HEADING.eyebrow}
            </p>
            <h2
              id="sandbox-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground text-balance"
            >
              {SANDBOX_HEADING.title}
            </h2>
            <div className="flex flex-col gap-1">
              <p className="text-muted-foreground leading-relaxed">
                {SANDBOX_SCOPE.sentence}
              </p>
              <SourceProof proof={SANDBOX_SCOPE.link} />
            </div>
          </div>
        </FadeInUp>

        <StaggerContainer staggerDelay={0.1} delayChildren={0.1}>
          {SANDBOX_PANEL_ORDER.map((id, index) => {
            const panel = SANDBOX_PANELS[id];
            const Artifact = ARTIFACTS[id];
            return (
              <StaggerItem key={id}>
                <article
                  aria-labelledby={`sandbox-${id}`}
                  className="grid grid-cols-1 lg:grid-cols-12 lg:items-start gap-6 lg:gap-10 border-t border-border py-10"
                >
                  <div className="lg:col-span-5 flex flex-col gap-4">
                    <p className="text-xs font-mono uppercase tracking-wider text-subtle">
                      {index + 1} · {panel.label}
                    </p>
                    <h3
                      id={`sandbox-${id}`}
                      className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground text-balance"
                    >
                      {panel.title}
                    </h3>
                    {panel.sentences.map((sentence) => (
                      <p
                        key={sentence}
                        className="text-muted-foreground leading-relaxed"
                      >
                        {sentence}
                      </p>
                    ))}
                  </div>
                  <div className="lg:col-span-7 min-w-0 rounded-lg border border-border bg-card p-5 sm:p-6 flex flex-col gap-6">
                    <Artifact />
                    {panel.proofs.map((proof, proofIndex) => (
                      <Proof key={proofIndex} proof={proof} />
                    ))}
                  </div>
                </article>
              </StaggerItem>
            );
          })}
        </StaggerContainer>
      </div>
    </section>
  );
}

export { Sandbox };
