/**
 * Hold the job film to the homepage hero it retells: the same steps in the
 * same order, the same parts lit at each of them by the rule the hero lights
 * by (brand/job-story.ts), and words drawn from the job, the shared titles and
 * the positioning. A word, a step or a part's lighting changed there fails
 * here until the film agrees, and then the film is rendered again.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AGENT_GET_TITLES } from "../../../../../brand/agent-gets";
import { POSITIONING } from "../../../../../brand/positioning";
import {
  JOB,
  OPACITY,
  PARTS,
  STEPS,
  isOn,
  type Layer,
  type PartId,
} from "../../../../../brand/job-story";
import {
  BEATS,
  DURATION_IN_FRAMES,
  END_CARD,
  HEADLINE,
  HOLD_LINE,
  PICTURE,
  RAMP_FRAMES,
  layerOpacity,
  momentAt,
} from "../storyboard";

const PART_IDS = Object.keys(PARTS) as PartId[];

/** Every layer a part lights, and its own presence. */
const layersOf = (id: PartId): (Layer | "part")[] => ["part", ...PARTS[id].layers];

const stepBeats = BEATS.filter((beat) => beat.moment !== "clear" && beat.moment !== "hold");

test("the film plays the hero's steps in order, each with a line, inside its length", () => {
  assert.deepEqual(
    stepBeats.map((beat) => beat.moment),
    [...STEPS],
  );
  for (const beat of stepBeats) {
    assert.ok(beat.line, `${beat.moment} has a line`);
  }
  let previous = PICTURE.from;
  for (const beat of BEATS) {
    assert.equal(beat.from, previous, `${beat.moment} starts where the beat before it ends`);
    assert.ok(beat.to > beat.from, `${beat.moment} lasts`);
    assert.ok(beat.to - beat.from > RAMP_FRAMES, `${beat.moment} settles before it ends`);
    previous = beat.to;
  }
  assert.equal(HEADLINE.from, 0);
  assert.equal(HEADLINE.to, PICTURE.from);
  assert.equal(END_CARD.from, PICTURE.to);
  assert.ok(PICTURE.to < DURATION_IN_FRAMES);
  assert.equal(END_CARD.to, DURATION_IN_FRAMES);
});

test("every part's every layer settles where the hero's rule puts it, at every moment", () => {
  for (const beat of BEATS) {
    const settledFrame = beat.from + RAMP_FRAMES;
    for (const id of PART_IDS) {
      for (const layer of layersOf(id)) {
        assert.equal(
          layerOpacity(id, layer, settledFrame),
          OPACITY[layer][isOn(PARTS[id], layer, beat.moment) ? "on" : "off"],
          `${id} ${layer} at ${beat.moment}`,
        );
      }
    }
  }
  assert.equal(momentAt(PICTURE.from), "clear");
  assert.equal(momentAt(PICTURE.to - 1), "hold");
});

test("the words come from the hero's job, the shared titles and the positioning", () => {
  const lines = BEATS.map((beat) => beat.line ?? "").join("\n");
  for (const name of [JOB.customer, JOB.ledger, JOB.report]) {
    assert.ok(lines.includes(name), `a line names ${name}`);
  }
  for (const title of [AGENT_GET_TITLES["own-computer"], AGENT_GET_TITLES.hours, AGENT_GET_TITLES["asks-first"]]) {
    assert.ok(
      BEATS.some((beat) => beat.line === `${title}.`),
      `a step's line is the title "${title}"`,
    );
  }
  assert.equal(HOLD_LINE, `${AGENT_GET_TITLES.walls}. ${AGENT_GET_TITLES.keys}.`);
  assert.equal(BEATS[BEATS.length - 1].line, HOLD_LINE);
  assert.equal(HEADLINE.text, POSITIONING.headline);
  assert.equal(END_CARD.sentence, POSITIONING.oneSentence);
  assert.equal(END_CARD.address, "stigmer.ai");
});

test("no line or card holds a number", () => {
  for (const words of [HEADLINE.text, END_CARD.sentence, END_CARD.address, ...BEATS.map((beat) => beat.line ?? "")]) {
    assert.doesNotMatch(words, /\d/, words);
  }
});
