"use client";

// The journey from a first agent to its users, as a dashboard card: six
// steps in order, each done only when the server says so (`useJourney`), the
// current one with its one act, the later ones quiet. Every link is the
// host's route; a step whose destination the host does not pass has no act.
// The card is for an admin of the organization (`can_edit` on it, asked fail
// closed): the journey is the organization's, and a member sees no card. Once
// all six are done it folds to one line. "Hide" is the host's to remember
// (`onHide`); the operational dashboard keeps it in this browser.

import { useId } from "react";
import { Check } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import { Button } from "../button/Button.js";
import { LinkButton } from "../button/LinkButton.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { cardClasses, cardHeaderClasses } from "../internal/surface/Card.js";
import { ListRow } from "../internal/surface/List.js";
import { useJourney, type JourneyStep, type JourneyStepId, type UseJourneyReturn } from "../journey/useJourney.js";
import type { JourneyLinks, RenderJourneyLink } from "../journey/links.js";

/** Where each step leads, as the host routes it; the later steps' destinations are the journey's ({@link JourneyLinks}). */
export interface DashboardFirstStepLinks extends Omit<JourneyLinks, "renderLink"> {
  /** Models & providers, where a provider key is connected. */
  readonly connectProvider: string;
  /**
   * Where a newcomer says what their agent should do: the launcher, whose
   * first question offers the example jobs and "Describe your own".
   */
  readonly createAgent: string;
  /** The launcher, where a session starts. */
  readonly startSession: string;
}

/** Props for {@link DashboardFirstSteps}. */
export interface DashboardFirstStepsProps {
  readonly org: string;
  readonly links: DashboardFirstStepLinks;
  /** Draws a link; a host with its own router passes its link component. A plain anchor otherwise. */
  readonly renderLink?: RenderJourneyLink;
  /**
   * The journey as the caller already read it (`useJourney`), so a page
   * that decides its layout on it reads it once; the card reads it itself
   * otherwise.
   */
  readonly journey?: UseJourneyReturn;
  /** Hides the card for this person; the card offers "Hide" only with it. */
  readonly onHide?: () => void;
  readonly className?: string;
}

const anchor: NonNullable<DashboardFirstStepsProps["renderLink"]> = ({ href, className, children }) => (
  <a href={href} className={className}>
    {children}
  </a>
);

/** Each step's one act, in words. */
const ACTS: Record<JourneyStepId, string> = {
  describe: "Pick an example",
  key: "Add a key",
  watch: "Run it",
  "make-yours": "Make it yours",
  "in-app": "Put it in your app",
  others: "Invite your team",
};

/** The card's title, which also names its region. */
export const JOURNEY_CARD_TITLE = "From first agent to your users";

/** The journey's six steps as a card: done, current with its act, and the quiet ones after it. */
export function DashboardFirstSteps({ org, links, renderLink = anchor, journey: given, onHide, className }: DashboardFirstStepsProps) {
  const headingId = useId();
  const read = useJourney(org, { enabled: given === undefined });
  const journey = given ?? read;
  if (journey.status !== "ready") return null;

  const agent = journey.agent?.ref;
  // Each step's destination; a typed record, so a new step without one fails to compile.
  const destinations: Record<JourneyStepId, () => string | undefined> = {
    describe: () => links.createAgent,
    key: () => links.connectProvider,
    watch: () => links.startSession,
    "make-yours": () => (agent && links.makeItYours ? links.makeItYours(agent) : undefined),
    "in-app": () => (agent && links.putInApp ? links.putInApp(agent) : undefined),
    others: () => links.bringOthers,
  };
  const hrefOf = (id: JourneyStepId): string | undefined => destinations[id]();

  const count = `${journey.done} of ${journey.steps.length}`;

  if (journey.current === undefined) {
    return (
      <section aria-labelledby={headingId} className={cn(cardClasses(), className)}>
        <p id={headingId} className="stg:m-0 stg:flex stg:items-center stg:gap-2 stg:text-sm stg:text-muted-foreground">
          <Check aria-hidden="true" className="stg:size-4 stg:text-foreground" />
          <span>
            <span className="stg:font-medium stg:text-foreground">Your organization is set up</span> · {count}
          </span>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby={headingId} className={cn(cardClasses({ flush: true }), className)}>
      <div className={cardHeaderClasses()}>
        <h2 id={headingId} className="stg:m-0 stg:flex-1 stg:text-base stg:font-semibold stg:text-foreground">
          {JOURNEY_CARD_TITLE}
        </h2>
        <span className="stg:text-sm stg:text-muted-foreground">{count}</span>
        {onHide && (
          <Button variant="ghost" size="xs" onClick={onHide} aria-label="Hide these steps">
            Hide
          </Button>
        )}
      </div>
      <ol className={cn(UNSTYLED_LIST, "stg:divide-y stg:divide-border-muted")}>
        {journey.steps.map((step) => (
          <StepRow key={step.id} step={step} href={step.state === "current" ? hrefOf(step.id) : undefined} renderLink={renderLink} />
        ))}
      </ol>
    </section>
  );
}

/** One step as a list row: its marker leading, its title, its line once it is done or current, the current one's act. */
function StepRow({
  step,
  href,
  renderLink,
}: {
  readonly step: JourneyStep;
  readonly href: string | undefined;
  readonly renderLink: NonNullable<DashboardFirstStepsProps["renderLink"]>;
}) {
  const done = step.state === "done";
  const current = step.state === "current";
  return (
    <ListRow
      aria-current={current ? "step" : undefined}
      leading={<StepMarker number={step.number} done={done} current={current} />}
      name={
        <span className={cn(!done && !current && "stg:text-muted-foreground")}>
          {step.title}
          {done && <span className="stg:sr-only"> (done)</span>}
        </span>
      }
      description={done || current ? step.line : undefined}
      trailing={
        current && href !== undefined ? (
          <LinkButton href={href} size="xs" renderLink={renderLink}>
            {ACTS[step.id]}
          </LinkButton>
        ) : undefined
      }
    />
  );
}

/** A step's marker: a filled check when done, its number ringed when current, quiet after. */
function StepMarker({ number, done, current }: { readonly number: number; readonly done: boolean; readonly current: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "stg:flex stg:size-6 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:text-xs stg:font-semibold",
        done
          ? "stg:bg-foreground stg:text-background"
          : current
            ? "stg:border-2 stg:border-foreground stg:text-foreground"
            : "stg:border stg:border-border stg:text-muted-foreground",
      )}
    >
      {done ? <Check className="stg:size-3.5" /> : number}
    </span>
  );
}
