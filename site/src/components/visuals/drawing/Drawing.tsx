/**
 * The pieces every drawn picture is made of: its connectors (each line piece
 * and its chevron), its frames and a part's lit border.
 *
 * Each piece is placed by the picture's stylesheet (`grid.ts`), by the
 * `data-area` or `data-frame` it carries, and lights by the layers the loop's
 * stylesheet animates (`loop.ts`). A connector a step lights is drawn once in
 * the foreground colour on a `data-stroke` layer that rests dim and fades up;
 * a connector no step lights rests quiet with no layer. They hold no state
 * and no hooks.
 */
import { cn } from "@/lib/utils";
import { corners, fraction, type Connector as ConnectorData, type Layout, type Segment } from "./grid";

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
 * piece of a dashed line dashes alike; a dashed border's dash is the
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

/**
 * A connector in its area, both layouts' pieces drawn and the stylesheet
 * showing one. A lit connector is the foreground colour on its part's stroke
 * layer; a quiet one is the subtle border colour, or the muted text colour
 * when dashed.
 */
function Connector({ id, connector }: { id: string; connector: ConnectorData }) {
  const dashed = connector.dashed === true;
  const pieces = (Object.entries(connector.segments) as [Layout, readonly Segment[]][]).flatMap(([layout, segments]) =>
    segments.map((segment, index) => (
      <Line key={`${layout}-${index}`} segment={segment} turns={corners(segments, segment)} layout={layout} dashed={dashed} />
    )),
  );
  if (connector.part) {
    return (
      <span data-area={id} className="relative text-foreground">
        <span data-stroke={connector.part} className="absolute inset-0">
          {pieces}
        </span>
      </span>
    );
  }
  return (
    <span data-area={id} className={cn("relative", dashed ? "text-muted-foreground" : "text-subtle")}>
      {pieces}
    </span>
  );
}

/**
 * A frame round the areas it holds, placed by its `data-frame` rule, with its
 * name in the small uppercase label at its top-left, inside its top gutter.
 * It is drawn before what it holds, so they paint over it.
 */
function Frame({ id, label }: { id: string; label: string }) {
  return (
    <span data-frame={id} className="relative rounded-xl border border-border">
      <span className="absolute top-1.5 left-3 font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
    </span>
  );
}

/** A part's lit border, laid over its resting one. */
function Ring({ part }: { part: string }) {
  return (
    <span
      data-ring={part}
      className="pointer-events-none absolute -inset-px rounded-[inherit] border border-foreground"
    />
  );
}

export { Connector, Frame, Ring };
