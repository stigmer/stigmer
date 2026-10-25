/**
 * The job film: the homepage hero's picture of a customer's agent at work,
 * played once, silent, with its words on screen.
 *
 * It opens on the headline, sets out the stage, plays the hero's six steps
 * with a line under the picture for each, holds the finished picture and
 * ends on the one sentence and the address. Every frame is a pure function of
 * the frame number: what is shown and lit comes from storyboard.ts, which
 * takes it from the job's data and rule the hero reads too, so the film lights
 * exactly what the hero lights, step by step.
 *
 * The picture is the hero's compact arrangement (the customer and the
 * computer side by side, the wall and the other customers below), drawn at
 * film scale with no word under 28px, so the square cut stays readable in a
 * phone's feed. The landscape cut sets the headline beside it, as the hero
 * sits on a wide screen; the square cut opens on the headline alone.
 */
import type * as React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Building2, Check, Clock, Cpu, File, KeyRound, Lock, Shield, User, type LucideIcon } from "lucide-react";
import { AGENT_GET_TITLES } from "../../../../brand/agent-gets";
import { JOB, type Layer, type PartId } from "../../../../brand/job-story";
import { StigmerMark } from "../intro/graphics/StigmerMark";
import { LOOK } from "./look";
import { END_CARD, HEADLINE, PICTURE, RAMP_FRAMES, beatAt, layerOpacity } from "./storyboard";

export const JOB_FILM = { width: 1920, height: 1080 } as const;
export const JOB_FILM_SQUARE = { width: 1080, height: 1080 } as const;

/** The picture's width in either cut. */
const PICTURE_WIDTH = 984;

/** The smallest words on screen, and the small uppercase labels the picture names things with. */
const TEXT = 28;
const LABEL: React.CSSProperties = {
  fontFamily: LOOK.mono,
  fontSize: TEXT,
  lineHeight: "36px",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
};

/** How far a box's contents sit from its border. */
const INSET = 20;

type Column = "customer" | "arrows" | "computer";
type Row = "head" | "ledger" | "work" | "ask" | "report";

const COLUMN: Readonly<Record<Column, number>> = { customer: 1, arrows: 2, computer: 3 };
const ROWS: readonly Row[] = ["head", "ledger", "work", "ask", "report"];

/** One part's layer opacity at the frame on screen. */
type Lit = (layer: Layer) => number;

/** A file, a question or an answer, as a small bordered chip, its border lit by `ring`. */
function Chip({
  lit,
  icon: Glyph,
  ground,
  style,
  children,
}: {
  lit: Lit;
  icon?: LucideIcon;
  ground: "card" | "background";
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <span
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        minHeight: 56,
        maxWidth: "100%",
        boxSizing: "border-box",
        padding: "8px 14px",
        border: `2px solid ${LOOK.subtle}`,
        borderRadius: 8,
        background: ground === "card" ? LOOK.card : LOOK.background,
        fontFamily: LOOK.mono,
        fontSize: TEXT,
        lineHeight: "36px",
        ...style,
      }}
    >
      <span
        style={{
          position: "absolute",
          inset: -2,
          borderRadius: "inherit",
          border: `2px solid ${LOOK.foreground}`,
          opacity: lit("ring"),
        }}
      />
      <span style={{ display: "flex", alignItems: "flex-start", gap: 10, color: LOOK.foreground, opacity: lit("ink") }}>
        {Glyph ? <Glyph size={26} strokeWidth={2} style={{ flexShrink: 0, marginTop: 5 }} /> : null}
        <span style={{ minWidth: 0 }}>{children}</span>
      </span>
    </span>
  );
}

/** An arrow between the customer and the computer, its stroke lit by `stroke`. */
function Arrow({ lit, toward }: { lit: Lit; toward: "computer" | "customer" }) {
  return (
    <span style={{ position: "relative", display: "block", width: "100%", height: 16, color: LOOK.foreground, opacity: lit("stroke") }}>
      <span style={{ position: "absolute", left: 2, right: 2, top: 6.5, height: 3, background: "currentColor" }} />
      <svg
        viewBox="0 0 6 8"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ position: "absolute", top: 0, width: 12, height: 16, [toward === "computer" ? "right" : "left"]: 0 }}
      >
        <path d={toward === "computer" ? "M1 .75 5.25 4 1 7.25" : "M5 .75.75 4 5 7.25"} />
      </svg>
    </span>
  );
}

/** A title the picture carries, with its icon, lit with the part it belongs to. */
function Titled({ lit, icon: Glyph, title }: { lit: Lit; icon: LucideIcon; title: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 12, color: LOOK.foreground, opacity: lit("ink") }}>
      <Glyph size={28} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span style={LABEL}>{title}</span>
    </span>
  );
}

/**
 * Where each part of the job's picture is drawn, and how. Keyed by every
 * part brand/job-story.ts has, so a part added there fails this film's
 * typecheck until the film draws it too.
 */
const PLACEMENTS: Readonly<Record<PartId, { column: Column; row: Row; draw: (lit: Lit) => React.ReactNode }>> = {
  "customer-ledger": {
    column: "customer",
    row: "ledger",
    draw: (lit) => (
      <>
        <Chip lit={lit} icon={File} ground="card">
          {JOB.ledger}
        </Chip>
        <span style={{ fontSize: TEXT, lineHeight: "36px", color: LOOK.foreground, opacity: lit("ink") }}>{JOB.message}</span>
      </>
    ),
  },
  "arrow-in": { column: "arrows", row: "ledger", draw: (lit) => <Arrow lit={lit} toward="computer" /> },
  "computer-ledger": {
    column: "computer",
    row: "ledger",
    draw: (lit) => (
      <Chip lit={lit} icon={File} ground="background">
        {JOB.ledger}
      </Chip>
    ),
  },
  computer: {
    column: "computer",
    row: "head",
    draw: (lit) => (
      <>
        <span style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: LOOK.mono, fontSize: 30, fontWeight: 500 }}>
          <Cpu size={30} strokeWidth={2} color={LOOK.foreground} style={{ flexShrink: 0, opacity: lit("ink") }} />
          {JOB.agent}
        </span>
        <span style={{ ...LABEL, color: LOOK.muted }}>{AGENT_GET_TITLES["own-computer"]}</span>
      </>
    ),
  },
  "computer-work": {
    column: "computer",
    row: "work",
    draw: (lit) => (
      <>
        <Titled lit={lit} icon={Clock} title={AGENT_GET_TITLES.hours} />
        <span style={{ display: "block", alignSelf: "stretch", borderTop: `4px dotted ${LOOK.foreground}`, opacity: lit("stroke") }} />
      </>
    ),
  },
  "computer-ask": {
    column: "computer",
    row: "ask",
    draw: (lit) => (
      <>
        <Titled lit={lit} icon={Shield} title={AGENT_GET_TITLES["asks-first"]} />
        <Chip lit={lit} ground="background">
          {JOB.tool}
        </Chip>
      </>
    ),
  },
  "arrow-ask": { column: "arrows", row: "ask", draw: (lit) => <Arrow lit={lit} toward="customer" /> },
  "customer-ask": {
    column: "customer",
    row: "ask",
    draw: (lit) => (
      <Chip lit={lit} icon={Shield} ground="card">
        {JOB.tool}: approve?
      </Chip>
    ),
  },
  "customer-yes": {
    column: "customer",
    row: "ask",
    draw: (lit) => (
      <Chip lit={lit} icon={Check} ground="card" style={{ fontFamily: LOOK.sans, fontSize: 30, fontWeight: 600 }}>
        Yes
      </Chip>
    ),
  },
  "computer-report": {
    column: "computer",
    row: "report",
    draw: (lit) => (
      <Chip lit={lit} icon={File} ground="background">
        {JOB.report}
      </Chip>
    ),
  },
  "arrow-out": { column: "arrows", row: "report", draw: (lit) => <Arrow lit={lit} toward="customer" /> },
  "customer-report": {
    column: "customer",
    row: "report",
    draw: (lit) => (
      <Chip lit={lit} icon={File} ground="card">
        {JOB.report}
      </Chip>
    ),
  },
};

const PART_IDS = Object.keys(PLACEMENTS) as PartId[];

/** One of the other customers' computers, dimmed behind the wall. */
function OtherCustomer({ named }: { named: boolean }) {
  return (
    <span
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        height: 112,
        border: `2px solid ${LOOK.border}`,
        borderRadius: 16,
      }}
    >
      <Cpu size={36} strokeWidth={2} color={LOOK.dim} style={{ opacity: 0.4 }} />
      {named ? <span style={{ fontSize: TEXT, color: LOOK.dim }}>Another customer</span> : null}
    </span>
  );
}

/** The hero's picture at a frame. */
function Picture({ frame }: { frame: number }) {
  const cell = (column: Column, row: Row): React.CSSProperties => ({
    gridColumn: COLUMN[column],
    gridRow: ROWS.indexOf(row) + 1,
    display: "flex",
    flexDirection: "column",
    alignItems: column === "arrows" ? "stretch" : "flex-start",
    justifyContent: column === "arrows" ? "center" : row === "head" ? "flex-start" : "center",
    gap: 12,
    padding:
      column === "arrows"
        ? "0 4px"
        : `${row === "head" ? INSET : 10}px ${INSET}px ${row === "report" ? INSET : 10}px`,
    minWidth: 0,
  });
  const box = (column: Column): React.CSSProperties => ({
    gridColumn: COLUMN[column],
    gridRow: `1 / ${ROWS.length + 1}`,
    borderRadius: 16,
  });
  const lit = (id: PartId): Lit => (layer) => layerOpacity(id, layer, frame);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 44px minmax(0, 1fr)",
        width: PICTURE_WIDTH,
        fontFamily: LOOK.sans,
        color: LOOK.foreground,
      }}
    >
      {/* The customer, inside your product. */}
      <div style={{ ...box("customer"), border: `2px dashed ${LOOK.subtle}` }} />
      <div style={cell("customer", "head")}>
        <span style={{ ...LABEL, color: LOOK.muted }}>Your product</span>
        <span style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", fontSize: 34, fontWeight: 600 }}>
          <Building2 size={30} strokeWidth={2} color={LOOK.muted} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{JOB.customer}</span>
          <User size={30} strokeWidth={2} color={LOOK.muted} style={{ flexShrink: 0 }} />
        </span>
      </div>

      {/* The customer's agent, in its own computer, its border lit with it. */}
      <div style={{ ...box("computer"), position: "relative", border: `2px solid ${LOOK.subtle}`, background: LOOK.card }}>
        <span
          style={{
            position: "absolute",
            inset: -2,
            borderRadius: "inherit",
            border: `2px solid ${LOOK.foreground}`,
            opacity: layerOpacity("computer", "ring", frame),
          }}
        />
      </div>

      {/* Every part of the story, each in its cell, shown and lit as the hero's rule says. */}
      {(Object.keys(COLUMN) as Column[]).flatMap((column) =>
        ROWS.map((row) => {
          const here = PART_IDS.filter((id) => PLACEMENTS[id].column === column && PLACEMENTS[id].row === row);
          if (here.length === 0) return null;
          return (
            <div key={`${column}-${row}`} style={{ ...cell(column, row), position: "relative" }}>
              {here.map((id) => (
                <div
                  key={id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: column === "arrows" ? "stretch" : "flex-start",
                    gap: 12,
                    width: "100%",
                    opacity: layerOpacity(id, "part", frame),
                  }}
                >
                  {PLACEMENTS[id].draw(lit(id))}
                </div>
              ))}
            </div>
          );
        }),
      )}

      {/* The model key the agent runs on, the developer's own. */}
      <span style={{ gridColumn: 3, gridRow: 6, justifySelf: "center", width: 2, height: 24, background: LOOK.subtle }} />
      <span
        style={{
          gridColumn: 3,
          gridRow: 7,
          justifySelf: "center",
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: 56,
          padding: "0 18px",
          border: `2px solid ${LOOK.subtle}`,
          borderRadius: 8,
          fontSize: TEXT,
          color: LOOK.muted,
        }}
      >
        <KeyRound size={26} strokeWidth={2} />
        Your model key
      </span>
      <span style={{ ...LABEL, gridColumn: 3, gridRow: 8, justifySelf: "center", marginTop: 10, color: LOOK.muted }}>
        {AGENT_GET_TITLES.keys}
      </span>

      {/* The wall, and the other customers behind it. */}
      <div style={{ gridColumn: "1 / -1", gridRow: 9, display: "flex", alignItems: "center", height: 64 }}>
        <span style={{ flex: 1, height: 2, background: LOOK.subtle }} />
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 52,
            height: 52,
            border: `2px solid ${LOOK.subtle}`,
            borderRadius: 26,
            background: LOOK.background,
            color: LOOK.muted,
          }}
        >
          <Lock size={26} strokeWidth={2} />
        </span>
        <span style={{ flex: 1, height: 2, background: LOOK.subtle }} />
      </div>
      <div style={{ gridColumn: "1 / -1", gridRow: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <OtherCustomer named />
        <OtherCustomer named={false} />
        <span style={{ ...LABEL, gridColumn: "1 / -1", color: LOOK.muted }}>{AGENT_GET_TITLES.walls}</span>
      </div>
    </div>
  );
}

/** The line under the picture: the beat's words, faded in at its start and out at its end. */
function Line({ frame }: { frame: number }) {
  const beat = beatAt(frame);
  const fade = Math.round(RAMP_FRAMES * 0.75);
  const opacity =
    frame < PICTURE.from
      ? 0
      : interpolate(frame, [beat.from, beat.from + fade, beat.to - fade, beat.to], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
  return (
    <div
      style={{
        width: PICTURE_WIDTH,
        minHeight: 52,
        fontSize: 40,
        lineHeight: "52px",
        fontWeight: 500,
        textAlign: "center",
        color: LOOK.foreground,
        opacity: beat.line === null ? 0 : opacity,
      }}
    >
      {beat.line}
    </div>
  );
}

/** The headline with the mark, as the film opens on it. */
function Headline({ size, align }: { size: number; align: "center" | "left" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align === "center" ? "center" : "flex-start", gap: 40 }}>
      <StigmerMark size={size * 1.25} />
      <h1
        style={{
          margin: 0,
          fontFamily: LOOK.sans,
          fontSize: size,
          lineHeight: 1.08,
          fontWeight: 700,
          letterSpacing: "-0.025em",
          color: LOOK.foreground,
          textAlign: align,
          textWrap: "balance",
        }}
      >
        {HEADLINE.text}
      </h1>
    </div>
  );
}

/** The closing card: the one sentence and the address. */
function EndCard({ frame, width }: { frame: number; width: number }) {
  const opacity = interpolate(frame, [END_CARD.from, END_CARD.from + RAMP_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 44, opacity }}>
      <StigmerMark size={120} />
      <p
        style={{
          margin: 0,
          maxWidth: width,
          fontFamily: LOOK.sans,
          fontSize: 64,
          lineHeight: 1.15,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          textAlign: "center",
          textWrap: "balance",
          color: LOOK.foreground,
        }}
      >
        {END_CARD.sentence}
      </p>
      <p style={{ margin: 0, fontFamily: LOOK.mono, fontSize: 40, color: LOOK.muted }}>{END_CARD.address}</p>
    </AbsoluteFill>
  );
}

/** The picture's fade: in after the opening, out before the end card. */
function pictureOpacity(frame: number): number {
  return interpolate(
    frame,
    [PICTURE.from, PICTURE.from + RAMP_FRAMES, PICTURE.to - RAMP_FRAMES, PICTURE.to],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
}

const Ground = ({ children }: { children: React.ReactNode }) => (
  <AbsoluteFill style={{ background: LOOK.background, fontFamily: LOOK.sans }}>
    <AbsoluteFill style={{ background: LOOK.vignette }} />
    {children}
  </AbsoluteFill>
);

/** 1920 × 1080: the headline on the left from the first frame, the picture on the right. */
export const JobFilm = () => {
  const frame = useCurrentFrame();
  const sideOpacity = interpolate(frame, [PICTURE.to - RAMP_FRAMES, PICTURE.to], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Ground>
      <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 96px", gap: 96 }}>
        <div style={{ flex: 1, minWidth: 0, opacity: sideOpacity }}>
          <Headline size={88} align="left" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 36, opacity: pictureOpacity(frame) }}>
          <Picture frame={frame} />
          <Line frame={frame} />
        </div>
      </AbsoluteFill>
      <EndCard frame={frame} width={1400} />
    </Ground>
  );
};

/** 1080 × 1080: the headline alone, then the picture with its line, then the end card. */
export const JobFilmSquare = () => {
  const frame = useCurrentFrame();
  const headlineOpacity = interpolate(frame, [HEADLINE.to - RAMP_FRAMES, HEADLINE.to], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <Ground>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 80, opacity: headlineOpacity }}>
        <Headline size={96} align="center" />
      </AbsoluteFill>
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", gap: 28, opacity: pictureOpacity(frame) }}
      >
        <Picture frame={frame} />
        <Line frame={frame} />
      </AbsoluteFill>
      <EndCard frame={frame} width={920} />
    </Ground>
  );
};
