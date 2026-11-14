"use client";

// The journey's next step, said in one quiet line where the person already
// is. Two faces, one rule (`useJourney`):
//
// - `JourneyNextLine`, under a finished turn (the session view's `nextStep`
//   slot): once a journey agent has done its first job and "Make it yours"
//   is the step to take, "Your first agent did a job. Next: make it yours"
//   with one act, to the agent's "Make it yours" tab. It is drawn only for
//   a journey agent's session (an example's, or one described in the
//   person's own words), never for another agent's.
// - `JourneyLauncherLine`, under the launcher's heading once its first
//   state has ended: "Next: make Variance Reporter yours", and later steps
//   the same way, from step 4 on.
//
// Both say nothing until every read is in, and nothing to a person the
// steps are not for (the journey's own permission rule), so no line is
// drawn and then taken back.

import { Check } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import type { ResourceRef } from "@stigmer/client";
import { LinkButton } from "../button/LinkButton.js";
import { cardClasses } from "../internal/surface/Card.js";
import { isJourneyAgentSlug } from "@stigmer/examples/journey";
import { useJourney, type JourneyStepId, type UseJourneyReturn } from "./useJourney.js";
import { anchorLink, type JourneyLinks } from "./links.js";

/** Props for {@link JourneyNextLine}. */
export interface JourneyNextLineProps {
  /** The organization the journey is read for (the host's active one). */
  readonly org: string;
  /** The agent the session runs, as the session view passes it. */
  readonly agentRef: ResourceRef | undefined;
  readonly links: JourneyLinks;
}

/**
 * The line under a journey agent's finished first job: what it did, and
 * the one act that makes it the person's own.
 *
 * @example
 * ```tsx
 * function Conversation({ sessionId, org }: { sessionId: string; org: string }) {
 *   return (
 *     <SessionViewer
 *       sessionId={sessionId}
 *       org={org}
 *       nextStep={({ agentRef }) => (
 *         <JourneyNextLine org={org} agentRef={agentRef} links={{ makeItYours: (a) => `/agents/${a.org}/${a.slug}?tab=make-it-yours` }} />
 *       )}
 *     />
 *   );
 * }
 * ```
 */
export function JourneyNextLine({ org, agentRef, links }: JourneyNextLineProps) {
  const ours = agentRef !== undefined && isJourneyAgentSlug(agentRef.slug);
  const journey = useJourney(org, { enabled: ours && links.makeItYours !== undefined });
  if (!ours || links.makeItYours === undefined || journey.status !== "ready" || journey.current?.id !== "make-yours") return null;
  const render = links.renderLink ?? anchorLink;
  return (
    <div
      role="status"
      data-stgm-journey-next=""
      className={cn(cardClasses(), "stg:mx-4 stg:mb-1 stg:mt-2 stg:flex stg:flex-wrap stg:items-center stg:gap-3 stg:text-sm")}
    >
      <span aria-hidden="true" className="stg:flex stg:size-5 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:bg-foreground stg:text-background">
        <Check className="stg:size-3" />
      </span>
      <span className="stg:min-w-[12rem] stg:flex-1">
        <span className="stg:font-medium stg:text-foreground">Your first agent did a job.</span>{" "}
        <span className="stg:text-muted-foreground">Next: make it yours, with your own file or your own rules.</span>
      </span>
      <LinkButton href={links.makeItYours(agentRef)} size="xs" renderLink={render}>
        Make it yours
      </LinkButton>
    </div>
  );
}

/** Props for {@link JourneyLauncherLine}. */
export interface JourneyLauncherLineProps {
  readonly org: string;
  readonly links: JourneyLinks;
  /** Whether to read the journey at all; the launcher asks only once its first state has ended. */
  readonly enabled: boolean;
  readonly className?: string;
}

/** The step a launcher line names, in words and with its destination, or undefined to say nothing. */
function nextOf(journey: UseJourneyReturn, links: JourneyLinks): { readonly words: string; readonly href: string } | undefined {
  const step = journey.current;
  const agent = journey.agent;
  if (journey.status !== "ready" || step === undefined) return undefined;
  // The steps from "Make it yours" on; the launcher itself leads the first three.
  const later: Partial<Record<JourneyStepId, () => { readonly words: string; readonly href: string } | undefined>> = {
    "make-yours": () => (agent && links.makeItYours ? { words: `make ${agent.name} yours`, href: links.makeItYours(agent.ref) } : undefined),
    "in-app": () => (agent && links.putInApp ? { words: `put ${agent.name} in your app`, href: links.putInApp(agent.ref) } : undefined),
    others: () => (links.bringOthers ? { words: "bring your team in", href: links.bringOthers } : undefined),
  };
  return later[step.id]?.();
}

/** One quiet line under the launcher's heading naming the journey's next step, from "Make it yours" on. */
export function JourneyLauncherLine({ org, links, enabled, className }: JourneyLauncherLineProps) {
  const journey = useJourney(org, { enabled });
  const next = enabled ? nextOf(journey, links) : undefined;
  if (next === undefined) return null;
  const render = links.renderLink ?? anchorLink;
  return (
    <div
      role="status"
      data-stgm-journey-launcher=""
      className={cn("stg:flex stg:items-center stg:justify-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground", className)}
    >
      <span>Next:</span>
      {render({
        href: next.href,
        className: "stg:font-medium stg:text-foreground stg:underline stg:underline-offset-2 stg:hover:text-foreground",
        children: next.words,
      })}
    </div>
  );
}
