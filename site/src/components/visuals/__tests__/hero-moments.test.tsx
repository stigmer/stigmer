/**
 * The homepage hero's five moments: its words, its walk and its loop.
 *
 * Each of the five has a moment, keyed by the five's ids, with its own
 * pictures, alt text and caption. The walk opens on the ask, steps through
 * the other four, each handing on to the next, and comes back to the ask;
 * no stretch of the cycle longer than one ramp lights no name. The loop is
 * held to the rules every looping picture keeps
 * (`@/__test-utils__/loop-checks`). The hero's own test holds the markup:
 * the pictures, their order, their loading and the names' links.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  expectFinishedAtBothEnds,
  expectLitAtTheirSteps,
  expectLongHold,
  expectNothingEscapable,
  expectOneCycle,
  expectOpacityOnly,
  expectPauseRules,
  expectRuleForEveryLayer,
  expectShownAtTheirSteps,
} from "@/__test-utils__/loop-checks";
import { AGENT_GET_IDS, AGENT_GETS } from "@/lib/agent-gets";
import { AGENT_GET_CLAIMS } from "../../../../../brand/agent-gets";
import { isOn } from "../drawing/loop";
import { HeroMoments } from "../HeroMoments";
import { HERO_BASE, HERO_MOMENTS, HERO_SCREENS, LOOP, LOOP_CSS, PARTS, TIMELINE, WALK, momentName } from "../hero-moments";

afterEach(cleanup);

/** The percent of the cycle one ramp takes. */
const RAMP = (TIMELINE.rampSeconds / TIMELINE.cycleSeconds) * 100;

describe("the hero's five moments", () => {
  it("give each of the five its own pictures, alt text and caption, under the name every list uses", () => {
    expect(Object.keys(HERO_MOMENTS).sort()).toEqual([...AGENT_GET_IDS].sort());
    const pictures = AGENT_GET_IDS.flatMap((id) => [HERO_SCREENS[id].whole, HERO_SCREENS[id].narrow]);
    expect(new Set(pictures).size).toBe(pictures.length);
    for (const id of AGENT_GET_IDS) {
      expect(momentName(id)).toBe(AGENT_GETS[id].title);
      expect(HERO_MOMENTS[id].alt.length, id).toBeGreaterThan(40);
      expect(HERO_MOMENTS[id].caption, id).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("caption each picture in their own words, never the name or the lines the section below says", () => {
    for (const id of AGENT_GET_IDS) {
      const { worry, build, gives } = AGENT_GET_CLAIMS[id];
      const caption = HERO_MOMENTS[id].caption.toLowerCase();
      for (const said of [momentName(id), worry, build, gives]) expect(caption, `${id}: "${said}"`).not.toContain(said.toLowerCase());
    }
  });
});

describe("the hero's walk", () => {
  it("opens on the ask, steps through the other four and comes back to it", () => {
    expect(WALK.at(-1)).toBe(HERO_BASE);
    expect([...WALK].sort()).toEqual([...AGENT_GET_IDS].sort());
  });

  it("shows each of the four at its step and hands it on at the next; the ask stays from its step", () => {
    WALK.forEach((id, index) => {
      const next = WALK[index + 1];
      expect(PARTS[id].shows, id).toBe(id);
      expect(PARTS[id].hides, id).toBe(next);
    });
  });

  it("shows only the ask in the finished picture, and only its own moment at each step", () => {
    for (const id of WALK) expect(isOn(WALK, PARTS[id], "part", "hold"), id).toBe(id === HERO_BASE);
    for (const step of WALK) {
      expect(WALK.filter((id) => isOn(WALK, PARTS[id], "part", step)), step).toEqual([step]);
    }
  });

  it("lights no name for no longer than one ramp: it clears one ramp before the first step", () => {
    expect(TIMELINE.steps[WALK[0]] - TIMELINE.clears).toBeLessThanOrEqual(RAMP + 0.001);
  });

  it("gives every moment the same time on screen", () => {
    const starts = WALK.map((id) => TIMELINE.steps[id]);
    const gaps = starts.slice(1).map((at, index) => Number((at - starts[index]).toFixed(1)));
    expect(new Set(gaps).size).toBe(1);
  });
});

describe("the hero's loop", () => {
  it("runs every layer on the one cycle, with no delay, held at both ends", () => {
    expectOneCycle(LOOP, LOOP_CSS);
  });

  it("starts and ends on the ask", () => {
    expectFinishedAtBothEnds(LOOP, LOOP_CSS);
  });

  it("holds the ask for at least 30% of the cycle", () => {
    expectLongHold(LOOP, LOOP_CSS);
  });

  it("clears, then shows and hands on each moment at its own step", () => {
    expectShownAtTheirSteps(LOOP, LOOP_CSS);
  });

  it("lights nothing beyond the moments themselves", () => {
    expectLitAtTheirSteps(LOOP, LOOP_CSS);
  });

  it("animates opacity only", () => {
    expectOpacityOnly(LOOP, LOOP_CSS);
  });

  it("has a rule for every layer the hero draws, and none for a layer it does not", () => {
    const { container } = render(<HeroMoments />);
    expectRuleForEveryLayer(LOOP, LOOP_CSS, container);
  });

  it("pauses every layer, and hides the pause button when motion is reduced", () => {
    expectPauseRules(LOOP, LOOP_CSS);
  });

  it("holds nothing an escaping step could change", () => {
    expectNothingEscapable(LOOP_CSS);
  });
});
