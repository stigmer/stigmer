/**
 * The job film's storyboard: when each part of the picture shows and lights,
 * and the words on screen, frame by frame.
 *
 * The story is the homepage hero's, taken from the data the hero reads rather
 * than copied: the job's names, the steps in order, the parts and the rule
 * that says which layer of which part is on at each moment all come from
 * brand/job-story.ts, the headline and the one sentence from
 * brand/positioning.ts, and the titles from brand/agent-gets.ts. Only the
 * clock is the film's own: the hero loops, the film opens on the headline,
 * plays the job once and ends on the one sentence.
 *
 * Pure data and arithmetic, with no React or Remotion import, so its test
 * loads it in Node alone. The drawing (JobFilm.tsx) asks it for an opacity
 * per part and layer and for the line under the picture at each frame.
 */
import { AGENT_GET_TITLES } from "../../../../brand/agent-gets";
import { POSITIONING } from "../../../../brand/positioning";
import {
  JOB,
  OPACITY,
  PARTS,
  STEPS,
  isOn,
  type Layer,
  type Moment,
  type PartId,
  type Step,
} from "../../../../brand/job-story";

export const FPS = 30;

/** Seconds each step holds the screen; the agent's work longest, as the hero's loop gives it the longest share. */
const STEP_SECONDS: Readonly<Record<Step, number>> = {
  "hands-over": 2.1,
  enters: 2.1,
  works: 3.5,
  asks: 2.1,
  approves: 2.1,
  returns: 2.1,
};

/** Seconds for the opening, the stage before the job starts, the finished picture and the end card. */
const SECONDS = { headline: 3, stage: 2, hold: 3, end: 3 } as const;

/** How long a part takes to light or dim, in frames. */
export const RAMP_FRAMES = Math.round(0.4 * FPS);

const frames = (seconds: number) => Math.round(seconds * FPS);

/** A stretch of the film, from its first frame up to (not including) `to`. */
export interface Span {
  from: number;
  to: number;
}

/** A moment of the job on screen, with the line under the picture while it shows. */
export interface Beat extends Span {
  moment: Moment;
  line: string | null;
}

/** The line under the picture at each step, built from the job's own names and titles. */
const STEP_LINES: Readonly<Record<Step, string>> = {
  "hands-over": `${JOB.customer} hands its agent ${JOB.ledger}.`,
  enters: `${AGENT_GET_TITLES["own-computer"]}.`,
  works: `${AGENT_GET_TITLES.hours}.`,
  asks: `${AGENT_GET_TITLES["asks-first"]}.`,
  approves: "A person says yes.",
  returns: `It hands back ${JOB.report}.`,
};

/** The line under the finished picture: the two titles it carries beside the wall and the key. */
export const HOLD_LINE = `${AGENT_GET_TITLES.walls}. ${AGENT_GET_TITLES.keys}.`;

function beats(): Beat[] {
  const list: Beat[] = [];
  let at = frames(SECONDS.headline);
  const push = (moment: Moment, length: number, line: string | null) => {
    list.push({ moment, from: at, to: at + length, line });
    at += length;
  };
  push("clear", frames(SECONDS.stage), null);
  for (const step of STEPS) push(step, frames(STEP_SECONDS[step]), STEP_LINES[step]);
  push("hold", frames(SECONDS.hold), HOLD_LINE);
  return list;
}

/** The picture's moments in order: the stage, each step, then the finished picture. */
export const BEATS: readonly Beat[] = beats();

/** The opening card: the headline. */
export const HEADLINE: Span & { text: string } = {
  from: 0,
  to: BEATS[0].from,
  text: POSITIONING.headline,
};

/** The stretch the picture is on screen. */
export const PICTURE: Span = { from: BEATS[0].from, to: BEATS[BEATS.length - 1].to };

/** The closing card: the one sentence and the address. */
export const END_CARD: Span & { sentence: string; address: string } = {
  from: PICTURE.to,
  to: PICTURE.to + frames(SECONDS.end),
  sentence: POSITIONING.oneSentence,
  address: "stigmer.ai",
};

export const DURATION_IN_FRAMES = END_CARD.to;

/** The beat on screen at a frame; before the picture the stage, after it the finished picture. */
export function beatAt(frame: number): Beat {
  if (frame < PICTURE.from) return BEATS[0];
  return BEATS.find((beat) => frame < beat.to) ?? BEATS[BEATS.length - 1];
}

/** The moment of the job at a frame. */
export function momentAt(frame: number): Moment {
  return beatAt(frame).moment;
}

/** Smoothstep over 0..1, clamped: a change starts and lands softly. */
function ease(progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  return t * t * (3 - 2 * t);
}

function settled(id: PartId, layer: Layer | "part", moment: Moment): number {
  return OPACITY[layer][isOn(PARTS[id], layer, moment) ? "on" : "off"];
}

/**
 * A layer's opacity at a frame: the value the hero's rule gives the beat on
 * screen, eased in over `RAMP_FRAMES` from the value of the beat before it.
 */
export function layerOpacity(id: PartId, layer: Layer | "part", frame: number): number {
  const beat = beatAt(frame);
  const index = BEATS.indexOf(beat);
  const target = settled(id, layer, beat.moment);
  if (index === 0) return target;
  const previous = settled(id, layer, BEATS[index - 1].moment);
  const t = ease((frame - beat.from) / RAMP_FRAMES);
  return previous * (1 - t) + target * t;
}
