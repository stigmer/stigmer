"use client";

/**
 * The picture under "How it fits": one job through Stigmer, with Stigmer
 * opened up, and under it the list that sends each opened-up part to the
 * row higher up the page that proves it.
 *
 * It is drawn in HTML so its words are page text, and it lays out by its own
 * width (it is a size container): across from 960px, down the page below.
 * The layout, the lines' routes, the frame round Stigmer and the loop live in
 * `job-through-stigmer.ts`; this file draws the pieces, each named for its
 * grid area, and lights them by the layers the loop animates.
 *
 * The loop is CSS, opacity only. The render never reads the motion
 * preference, so the exported markup hydrates whatever it is; the stylesheet
 * holds the finished picture still and hides the pause button when the
 * visitor asked for less motion. The pause is the one state.
 *
 * The list sits outside the figure, not in the drawing's columns: the
 * drawing is hidden from screen readers, and a link inside it would be
 * focusable yet unnamed.
 */
import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { Connector, Frame, Ring } from "./drawing/Drawing";
import { LoopPause } from "./drawing/LoopPause";
import {
  ATTRIBUTE,
  CAPTION,
  CHAT,
  CONNECTORS,
  DRAWING_CSS,
  FRAME,
  JOB,
  LOOP_CSS,
  OTHERS,
  PLACES,
  PROVEN_AT,
  provenAt,
  type ConnectorId,
  type OtherId,
  type PartId,
  type PlaceId,
} from "./job-through-stigmer";

const CSS = `${DRAWING_CSS}\n${LOOP_CSS}`;

/** A file or a question, as a small bordered chip, shown at its step. */
function Chip({ part, children }: { part: PartId; children: React.ReactNode }) {
  return (
    <span data-part={part} className="flex max-w-full [grid-area:1/1]">
      <span className="relative flex min-h-6 max-w-full items-center rounded border border-subtle bg-background px-2 py-0.5 font-mono text-[11px] leading-4 [overflow-wrap:anywhere]">
        <Ring part={part} />
        <span data-ink={part} className="text-foreground">
          {children}
        </span>
      </span>
    </span>
  );
}

/** A place: its name, its small line, and any chips it holds, lit by its part's layers. */
function Place({ id, children }: { id: PlaceId; children?: React.ReactNode }) {
  const { name, detail } = PLACES[id];
  if (id === "database") {
    return (
      <span
        data-area={id}
        data-box=""
        className="flex items-center justify-center self-start rounded-lg border border-subtle bg-card px-3 py-3 text-center text-muted-foreground"
      >
        {name}
      </span>
    );
  }
  return (
    <span
      data-area={id}
      data-box=""
      className="relative flex flex-col items-center justify-center gap-2 rounded-lg border border-subtle bg-card px-3 py-2.5 text-center"
    >
      <Ring part={id} />
      <span data-ink={id} className="flex flex-col items-center gap-0.5 text-foreground">
        <span className="flex items-center gap-1.5 font-medium">
          {id === "sandbox" ? <Icon name="cpu" className="h-4 w-4 shrink-0" /> : null}
          {name}
        </span>
        <span className="text-xs leading-4 text-muted-foreground">{detail}</span>
      </span>
      {children ? <span className="grid max-w-full place-items-center">{children}</span> : null}
    </span>
  );
}

/** Another customer's sandbox, dimmed beside Northwind's, as the hero draws them. */
function OtherSandbox({ id }: { id: OtherId }) {
  const label = OTHERS[id];
  return (
    <span data-area={id} className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border">
      <Icon name="cpu" className="h-5 w-5 text-[#808080] opacity-40" />
      {label ? <span className="text-center text-xs text-[#808080]">{label}</span> : null}
    </span>
  );
}

function JobThroughStigmer({ className }: { className?: string }) {
  const [paused, setPaused] = React.useState(false);

  return (
    <div className={cn("mx-auto w-full max-w-[1128px]", className)}>
      <figure
        {...{ [`data-${ATTRIBUTE}`]: "" }}
        data-paused={paused}
        className="@container w-full font-sans text-foreground"
      >
        <style href={ATTRIBUTE} precedence="default">
          {CSS}
        </style>
        <div {...{ [`data-${ATTRIBUTE}-stage`]: "" }} className="relative mx-auto pb-10">
          <div {...{ [`data-${ATTRIBUTE}-drawing`]: "" }} aria-hidden="true">
            <Frame id={FRAME.id} label={FRAME.label} />
            <Place id="app">
              <Chip part="app-ledger">{JOB.ledger}</Chip>
              <Chip part="app-ask">{JOB.tool}: approve?</Chip>
              <Chip part="app-report">{JOB.report}</Chip>
            </Place>
            <Place id="backend" />
            <Place id="database" />
            <Place id="api" />
            <Place id="access" />
            <Place id="job" />
            <Place id="sandbox">
              <Chip part="sandbox-ledger">{JOB.ledger}</Chip>
            </Place>
            <Place id="provider" />
            <OtherSandbox id="other-a" />
            <OtherSandbox id="other-b" />
            {(Object.keys(CONNECTORS) as ConnectorId[]).map((id) => (
              <Connector key={id} id={id} connector={CONNECTORS[id]} />
            ))}
            <span data-area="chat-label" className="font-mono text-[13px] leading-4">
              <span data-ink="chat" className="text-foreground">
                {CHAT}
              </span>
            </span>
          </div>
          <LoopPause prefix={ATTRIBUTE} paused={paused} onToggle={() => setPaused((was) => !was)} />
        </div>
        <figcaption className="sr-only">{CAPTION}</figcaption>
      </figure>
      <ul className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-4">
        {PROVEN_AT.map((item) => {
          const { name, title } = provenAt(item);
          return (
            <li key={item.part} className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] leading-[14px] tracking-[0.05em] text-subtle uppercase">{name}</span>
              <Link
                href={item.href}
                className="inline-flex items-center gap-1.5 text-sm text-foreground transition-colors hover:text-foreground/80"
              >
                {title}
                <Icon name="arrow-up" size="xs" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { JobThroughStigmer };
