/**
 * The picture under "How it fits": your users, your app, your backend, and
 * Stigmer beside your database behind it, calling your model provider; with
 * the chat's own line from your app to Stigmer.
 *
 * It is drawn in HTML so its words are page text, and it lays out by its own
 * width (it is a size container): across from 880px, down the page below.
 * The layout, the lines' routes and that width live in `where-it-sits.ts`;
 * this file draws the pieces, each named for its grid area.
 *
 * It holds no state and no hooks, so it needs no "use client" of its own; it
 * renders wherever it is imported.
 */
import { cn } from "@/lib/utils";
import {
  CHAT,
  CONNECTORS,
  PLACES,
  corners,
  fraction,
  whereItSitsCss,
  type ConnectorId,
  type Layout,
  type PlaceId,
  type Segment,
} from "./where-it-sits";

const WHERE_IT_SITS_CSS = whereItSitsCss();

/** A place as it reads mid-sentence: "your app", but "Stigmer". */
function inSentence(id: PlaceId): string {
  const label = PLACES[id];
  return label.startsWith("Your ") ? `your ${label.slice("Your ".length)}` : label;
}

const CAPTION =
  `${PLACES.users} work in ${inSentence("app")}, which calls ${inSentence("backend")}. ` +
  `${PLACES.backend} calls ${PLACES.stigmer} as it calls ${inSentence("database")}, ` +
  `and ${PLACES.stigmer} calls ${inSentence("provider")} on your key. ` +
  `When ${inSentence("app")} shows the agent's chat, it talks to ${PLACES.stigmer} directly, ` +
  `once ${inSentence("backend")} has signed the user in.`;

/** A line's thickness, in px; a turning end runs on by half of it. */
const LINE = 1.5;

/** The open chevron at an arrow's end, the hero's, turned to face its way. */
const CHEVRONS = {
  right: { box: "0 0 6 8", path: "M1 .75 5.25 4 1 7.25", className: "right-0 top-[calc(50%-4px)] h-2 w-1.5" },
  left: { box: "0 0 6 8", path: "M5 .75.75 4 5 7.25", className: "left-0 top-[calc(50%-4px)] h-2 w-1.5" },
  down: { box: "0 0 8 6", path: "M.75 1 4 5.25 7.25 1", className: "bottom-0 left-[calc(50%-4px)] h-1.5 w-2" },
  up: { box: "0 0 8 6", path: "M.75 5 4 .75 7.25 5", className: "top-0 left-[calc(50%-4px)] h-1.5 w-2" },
} as const;

function Chevron({ way }: { way: keyof typeof CHEVRONS }) {
  const { box, path, className } = CHEVRONS[way];
  return (
    <svg
      viewBox={box}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("absolute", className)}
    >
      <path d={path} />
    </svg>
  );
}

/**
 * One straight piece of a connector, placed by percentages of its area and
 * centred on its line. Dashes are a gradient of 6px on and 6px off, so every
 * piece of the chat line dashes alike; a dashed border's dash is the
 * browser's to choose.
 */
function Line({
  segment,
  turns,
  layout,
  dashed,
}: {
  segment: Segment;
  turns: { from: boolean; to: boolean };
  layout: Layout;
  dashed: boolean;
}) {
  const from = fraction(segment.from);
  const to = fraction(segment.to);
  const forward = to > from;
  const runOn = (turn: boolean) => (turn ? LINE / 2 : 0);
  const before = runOn(forward ? turns.from : turns.to);
  const after = runOn(forward ? turns.to : turns.from);
  const horizontal = segment.axis === "x";
  const along = {
    offset: `calc(${Math.min(from, to) * 100}% - ${before}px)`,
    length: `calc(${Math.abs(to - from) * 100}% + ${before + after}px)`,
  };
  const across = `calc(${fraction(segment.at) * 100}% - ${LINE / 2}px)`;
  const way = horizontal ? (forward ? "right" : "left") : forward ? "down" : "up";

  return (
    <span
      data-layout={layout}
      className={cn("absolute", !dashed && "bg-current")}
      style={{
        ...(horizontal
          ? { left: along.offset, width: along.length, top: across, height: `${LINE}px` }
          : { top: along.offset, height: along.length, left: across, width: `${LINE}px` }),
        ...(dashed && {
          backgroundImage: `repeating-linear-gradient(${horizontal ? "90deg" : "180deg"},currentColor 0 6px,transparent 6px 12px)`,
        }),
      }}
    >
      {segment.arrow ? <Chevron way={way} /> : null}
    </span>
  );
}

function Connector({ id }: { id: ConnectorId }) {
  const connector = CONNECTORS[id];
  const dashed = "dashed" in connector;
  return (
    <span data-area={id} className={cn("relative", dashed ? "text-muted-foreground" : "text-subtle")}>
      {(Object.entries(connector.segments) as [Layout, readonly Segment[]][]).flatMap(([layout, segments]) =>
        segments.map((segment, index) => (
          <Line
            key={`${layout}-${index}`}
            segment={segment}
            turns={corners(segments, segment)}
            layout={layout}
            dashed={dashed}
          />
        )),
      )}
    </span>
  );
}

function WhereItSits({ className }: { className?: string }) {
  return (
    <figure data-where-it-sits="" className={cn("@container mx-auto w-full max-w-[1128px] font-sans", className)}>
      <style href="where-it-sits" precedence="default">
        {WHERE_IT_SITS_CSS}
      </style>
      <div data-where-it-sits-drawing="" aria-hidden="true">
        {(Object.entries(PLACES) as [PlaceId, string][]).map(([id, label]) => (
          <span
            key={id}
            data-area={id}
            data-box=""
            className={cn(
              "flex items-center justify-center rounded-lg border bg-card px-3 text-center",
              id === "stigmer"
                ? "border-foreground font-semibold text-foreground"
                : "border-subtle text-muted-foreground",
            )}
          >
            {label}
          </span>
        ))}
        {(Object.keys(CONNECTORS) as ConnectorId[]).map((id) => (
          <Connector key={id} id={id} />
        ))}
        <span data-area="chat-label" className="font-mono text-[13px] leading-4 text-muted-foreground">
          {CHAT}
        </span>
      </div>
      <figcaption className="sr-only">{CAPTION}</figcaption>
    </figure>
  );
}

export { WhereItSits };
