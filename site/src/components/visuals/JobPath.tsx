"use client";

/**
 * The picture of the job the homepage hero and the docs front page show: a
 * customer inside your product hands its agent a ledger, the agent works in
 * its own computer, asks before a risky step, gets a yes and hands back a
 * report, while other customers' computers sit behind a wall.
 *
 * It is drawn in HTML so its words are page text, and it lays out by its own
 * width (it is a size container): side by side from 600px, the customer and
 * the computer in two columns below that. The two boxes share their rows
 * through a subgrid, so the ledger, the question and the report line up
 * across them at any width.
 *
 * The loop is CSS from `jobPathCss`, opacity only. The render never reads the
 * motion preference, so the exported markup hydrates whatever it is; the
 * stylesheet holds the finished picture still and hides the pause button
 * when the visitor asked for less motion. The pause is the one state: a flag
 * on the figure that the stylesheet turns into a paused animation.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "@/components/ui/icon";
import { AGENT_GETS, type AgentGetId } from "@/lib/agent-gets";
import { JOB, jobPathCss, type PartId } from "./job-path";

const JOB_PATH_CSS = jobPathCss();

const CAPTION =
  `${JOB.customer}, a customer in your product, hands its agent ${JOB.ledger}. ` +
  `The agent works through it for hours in its own computer, asks before it posts an adjustment, ` +
  `and hands back ${JOB.report}, while every other customer's agent stays behind a wall.`;

/** The small uppercase label the picture names things with. */
const LABEL = "font-mono text-[11px] leading-[14px] tracking-[0.05em] uppercase";

/** One of the five things each customer's agent gets, by its card title. */
function AgentGetTitle({ id, className }: { id: AgentGetId; className?: string }) {
  return (
    <span data-promise={id} className={cn(LABEL, className)}>
      {AGENT_GETS[id].title}
    </span>
  );
}

/** A part's lit border, laid over its resting one. */
function Ring({ part }: { part: PartId }) {
  return (
    <span
      data-ring={part}
      className="pointer-events-none absolute -inset-px rounded-[inherit] border border-foreground"
    />
  );
}

/** A file, a question or an answer, as a small bordered chip. */
function Chip({
  part,
  icon,
  ground,
  className,
  children,
}: {
  part: PartId;
  icon?: IconName;
  /** The chip's own ground: the card colour inside your product, the page's inside the computer. */
  ground: "card" | "background";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "relative flex min-h-7 max-w-full items-center rounded border border-subtle px-2 font-mono text-[11px] leading-4 @min-[600px]:text-xs",
        ground === "card" ? "bg-card" : "bg-background",
        className,
      )}
    >
      <Ring part={part} />
      <span data-ink={part} className="flex min-w-0 items-start gap-1.5 text-foreground">
        {icon ? <Icon name={icon} className="mt-px hidden h-3.5 w-3.5 @min-[600px]:block" /> : null}
        <span className="min-w-0">{children}</span>
      </span>
    </span>
  );
}

/** An arrow between the customer and the computer, in the arrows' column. */
function Arrow({ part, row, toward }: { part: PartId; row: string; toward: "computer" | "customer" }) {
  return (
    <span data-part={part} className={cn("col-start-2 flex items-center px-0.5 @min-[600px]:px-1", row)}>
      <span data-stroke={part} className="relative block h-2 w-full text-foreground">
        <span className="absolute inset-x-px top-[3.25px] h-[1.5px] bg-current" />
        <svg
          viewBox="0 0 6 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("absolute top-0 h-2 w-1.5", toward === "computer" ? "right-0" : "left-0")}
        >
          <path d={toward === "computer" ? "M1 .75 5.25 4 1 7.25" : "M5 .75.75 4 5 7.25"} />
        </svg>
      </span>
    </span>
  );
}

/** One of the other customers' computers, dimmed behind the wall. */
function OtherCustomer({ named }: { named: boolean }) {
  return (
    <span className="flex h-24 flex-col items-center justify-center gap-2 rounded-lg border border-border @min-[600px]:h-30">
      <Icon name="cpu" className="h-5 w-5 text-[#808080] opacity-40" />
      {named ? <span className="text-xs text-[#808080]">Another customer</span> : null}
    </span>
  );
}

function JobPath({ className }: { className?: string }) {
  const [paused, setPaused] = React.useState(false);

  return (
    <figure
      data-job-path=""
      data-paused={paused}
      className={cn("@container relative w-full max-w-[628px] font-sans text-foreground", className)}
    >
      <style href="job-path" precedence="default">
        {JOB_PATH_CSS}
      </style>
      <div
        data-job-path-drawing=""
        aria-hidden="true"
        className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] @min-[600px]:grid-cols-[200px_48px_212px_40px_minmax(0,1fr)]"
      >
        {/* The customer, inside your product. */}
        <div className="col-start-1 row-span-5 row-start-1 grid grid-rows-subgrid rounded-lg border border-dashed border-subtle p-2 @min-[600px]:p-3">
          <div className="flex min-h-14 flex-col gap-2 @min-[600px]:min-h-16">
            <span className={cn(LABEL, "text-muted-foreground")}>Your product</span>
            <span className="flex items-start gap-2 text-sm font-semibold">
              <Icon name="building-2" className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <span className="min-w-0 flex-1">{JOB.customer}</span>
              <Icon name="user" className="mt-0.5 hidden h-4 w-4 text-muted-foreground @min-[600px]:block" />
            </span>
          </div>
          <div data-part="customer-ledger" className="flex min-h-18 flex-col items-start gap-1.5 @min-[600px]:min-h-21">
            <Chip part="customer-ledger" icon="file" ground="card">
              {JOB.ledger}
            </Chip>
            <span data-ink="customer-ledger" className="text-xs">
              {JOB.message}
            </span>
          </div>
          <div />
          <div className="flex min-h-20 flex-col items-start gap-1.5 @min-[600px]:min-h-23">
            <span data-part="customer-ask" className="flex max-w-full">
              <Chip part="customer-ask" icon="shield" ground="card" className="py-1.5">
                {JOB.tool}: approve?
              </Chip>
            </span>
            <span data-part="customer-yes" className="flex">
              <Chip part="customer-yes" icon="check" ground="card" className="px-2.5 font-sans text-[13px] font-semibold">
                Yes
              </Chip>
            </span>
          </div>
          <div data-part="customer-report" className="flex min-h-11 items-start @min-[600px]:min-h-13">
            <Chip part="customer-report" icon="file" ground="card">
              {JOB.report}
            </Chip>
          </div>
        </div>

        <Arrow part="arrow-in" row="row-start-2" toward="computer" />
        <Arrow part="arrow-ask" row="row-start-4" toward="customer" />
        <Arrow part="arrow-out" row="row-start-5" toward="customer" />

        {/* The customer's agent, in its own computer. */}
        <div className="relative col-start-3 row-span-5 row-start-1 grid grid-rows-subgrid rounded-lg border border-subtle bg-card p-2 @min-[600px]:p-3">
          <Ring part="computer" />
          <div className="flex min-h-14 flex-col gap-1.5 @min-[600px]:min-h-16">
            <span className="flex items-start gap-2 font-mono text-xs leading-5 font-medium @min-[600px]:text-[13px]">
              <span data-ink="computer" className="mt-0.5 flex">
                <Icon name="cpu" className="h-4 w-4" />
              </span>
              <span className="min-w-0">{JOB.agent}</span>
            </span>
            <AgentGetTitle id="own-computer" className="text-muted-foreground" />
          </div>
          <div data-part="computer-ledger" className="flex min-h-18 items-center @min-[600px]:min-h-21">
            <Chip part="computer-ledger" icon="file" ground="background">
              {JOB.ledger}
            </Chip>
          </div>
          <div data-part="computer-work" className="flex min-h-14 flex-col justify-center gap-2.5 @min-[600px]:min-h-16">
            <span data-ink="computer-work" className="flex items-start gap-2">
              <Icon name="clock" className="h-3.5 w-3.5 shrink-0" />
              <AgentGetTitle id="hours" />
            </span>
            <span data-stroke="computer-work" className="block border-t-2 border-dotted border-foreground" />
          </div>
          <div data-part="computer-ask" className="flex min-h-20 flex-col items-start justify-center gap-2 @min-[600px]:min-h-23">
            <span data-ink="computer-ask" className="flex items-start gap-2">
              <Icon name="shield" className="h-3.5 w-3.5 shrink-0" />
              <AgentGetTitle id="asks-first" />
            </span>
            <Chip part="computer-ask" ground="background">
              {JOB.tool}
            </Chip>
          </div>
          <div data-part="computer-report" className="flex min-h-11 items-center @min-[600px]:min-h-13">
            <Chip part="computer-report" icon="file" ground="background">
              {JOB.report}
            </Chip>
          </div>
        </div>

        {/* The model key the agent runs on, the developer's own. */}
        <span className="col-start-3 row-start-6 h-5 w-px justify-self-center bg-subtle" />
        <span className="col-start-3 row-start-7 flex h-8 items-center gap-1.5 justify-self-center rounded border border-subtle px-2.5 text-[13px] text-muted-foreground">
          <Icon name="key-round" className="h-3.5 w-3.5" />
          Your model key
        </span>
        <AgentGetTitle id="keys" className="col-start-3 row-start-8 mt-2 text-center text-muted-foreground" />

        {/* The wall, and the other customers behind it. */}
        <div className="col-span-full row-start-9 flex h-10 items-center @min-[600px]:col-span-1 @min-[600px]:col-start-4 @min-[600px]:row-span-5 @min-[600px]:row-start-1 @min-[600px]:h-auto @min-[600px]:flex-col">
          <span className="h-px flex-1 bg-subtle @min-[600px]:h-auto @min-[600px]:w-px" />
          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-subtle bg-background text-muted-foreground">
            <Icon name="lock" className="h-3.5 w-3.5" />
          </span>
          <span className="h-px flex-1 bg-subtle @min-[600px]:h-auto @min-[600px]:w-px" />
        </div>
        <div className="col-span-full row-start-10 grid grid-cols-2 gap-3 @min-[600px]:col-span-1 @min-[600px]:col-start-5 @min-[600px]:row-span-8 @min-[600px]:row-start-1 @min-[600px]:grid-cols-1 @min-[600px]:self-start">
          <OtherCustomer named />
          <OtherCustomer named={false} />
          <AgentGetTitle id="walls" className="col-span-full flex min-h-7 items-center pr-9 text-muted-foreground" />
        </div>
      </div>
      <figcaption className="sr-only">{CAPTION}</figcaption>
      <button
        type="button"
        data-job-path-pause=""
        aria-label="Pause animation"
        aria-pressed={paused}
        onClick={() => setPaused((was) => !was)}
        className="absolute right-0 bottom-0 flex h-7 w-7 items-center justify-center rounded border border-border bg-background text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon name={paused ? "play" : "pause"} className="h-3.5 w-3.5" />
      </button>
    </figure>
  );
}

export { JobPath };
