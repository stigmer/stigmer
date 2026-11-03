/**
 * The homepage hero's five moments, as data: each one's pictures, worry,
 * answer and description; the order the hero steps through them; and its
 * stylesheet. The hero's own test holds the markup and the behaviour: the
 * tabs, the pictures, their loading, the stepping and what stops it.
 */
import { describe, expect, it } from "vitest";
import { AGENT_GET_IDS, AGENT_GETS } from "@/lib/agent-gets";
import { AGENT_GET_CLAIMS } from "../../../../../brand/agent-gets";
import {
  ATTRIBUTE,
  FADE_SECONDS,
  HERO_BASE,
  HERO_CSS,
  HERO_MOMENTS,
  HERO_SCREENS,
  MOMENT_SECONDS,
  momentName,
  momentWorry,
  nextMoment,
} from "../hero-moments";

describe("the hero's five moments", () => {
  it("give each of the five its own pictures, description and answer, under the name every list uses", () => {
    expect(Object.keys(HERO_MOMENTS).sort()).toEqual([...AGENT_GET_IDS].sort());
    const pictures = AGENT_GET_IDS.flatMap((id) => [HERO_SCREENS[id].whole, HERO_SCREENS[id].narrow]);
    expect(new Set(pictures).size).toBe(pictures.length);
    for (const id of AGENT_GET_IDS) {
      expect(momentName(id)).toBe(AGENT_GETS[id].title);
      expect(HERO_MOMENTS[id].alt.length, id).toBeGreaterThan(40);
      expect(HERO_MOMENTS[id].answer, id).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("state each one's problem as the section below does, its worry read from the one home of the five's words", () => {
    for (const id of AGENT_GET_IDS) expect(momentWorry(id), id).toBe(AGENT_GET_CLAIMS[id].worry);
  });

  it("answer in their own words, never the name or the section's lines for what is built and given", () => {
    for (const id of AGENT_GET_IDS) {
      const { build, gives } = AGENT_GET_CLAIMS[id];
      const answer = HERO_MOMENTS[id].answer.toLowerCase();
      for (const said of [momentName(id), build, gives]) expect(answer, `${id}: "${said}"`).not.toContain(said.toLowerCase());
    }
  });
});

describe("the hero's order", () => {
  it("opens on the ask and steps through the other four in the five's order, round to the ask", () => {
    const seen: string[] = [];
    let id = nextMoment(HERO_BASE);
    while (id !== HERO_BASE) {
      seen.push(id);
      id = nextMoment(id);
    }
    expect(seen).toEqual(["walls", "keys", "own-computer", "hours"]);
  });

  it("gives every moment the time to read its two lines and find their point in the picture", () => {
    expect(MOMENT_SECONDS).toBeGreaterThanOrEqual(9);
    expect(FADE_SECONDS).toBeLessThan(1);
  });
});

describe("the hero's stylesheet", () => {
  it("fills the lit name's line for one moment's time, once, and holds it while the hero is held", () => {
    expect(HERO_CSS).toContain(`@keyframes ${ATTRIBUTE}-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}`);
    expect(HERO_CSS).toContain(`animation:${ATTRIBUTE}-progress ${MOMENT_SECONDS}s linear both}`);
    expect(HERO_CSS).not.toMatch(/infinite/);
    expect(HERO_CSS).toContain(`[data-${ATTRIBUTE}][data-held=true] [data-${ATTRIBUTE}-progress]{animation-play-state:paused}`);
  });

  it("cross-fades the pictures on opacity alone", () => {
    expect(HERO_CSS).toContain(`[data-${ATTRIBUTE}-picture]{transition:opacity ${FADE_SECONDS}s ease}`);
  });

  it("holds nothing an escaping step could change", () => {
    expect(HERO_CSS).not.toMatch(/["'<>&]/);
  });
});
