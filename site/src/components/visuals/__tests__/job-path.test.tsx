/**
 * The hero's picture of the job: its words, its figure and its loop.
 *
 * The picture's words are the docs' own: each name the job uses must still
 * be spelled the same on the page that runs or explains it, and its labels
 * are the "What each customer's agent gets" titles, each at its part. The
 * figure is one image with a caption and a pause button, and pausing only
 * flips its state. The loop is checked from the stylesheet `jobPathCss`
 * builds out of `PARTS` and `TIMELINE`: it starts and ends on the finished
 * picture, clears to the stage, shows each part at its own step, animates
 * opacity only, and has a rule for every layer the render draws and nothing
 * else.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_GET_IDS, AGENT_GETS, type AgentGetId } from "@/lib/agent-gets";
import { JobPath } from "../JobPath";
import { JOB, OPACITY, PARTS, STEPS, TIMELINE, jobPathCss, type Part, type PartId } from "../job-path";

afterEach(cleanup);

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs");

/** The page that spells each of the job's names, as the docs publish it. */
const SPELLED_IN: Record<keyof typeof JOB, string> = {
  customer: "getting-started/one-organization-per-customer.mdx",
  agent: "getting-started/quickstart.mdx",
  ledger: "getting-started/quickstart.mdx",
  message: "getting-started/quickstart.mdx",
  tool: "concepts/approval-flows.mdx",
  report: "getting-started/quickstart.mdx",
};

/** The part each promise labels; the rest label the picture's static pieces. */
const LABELS: Record<AgentGetId, PartId | null> = {
  "own-computer": null,
  hours: "computer-work",
  "asks-first": "computer-ask",
  walls: null,
  keys: null,
};

const CSS = jobPathCss();

/** Every `@keyframes` block, by name, as [percent, opacity] frames. */
function keyframes(css: string): Map<string, [number, number][]> {
  const blocks = new Map<string, [number, number][]>();
  for (const [, name, body] of css.matchAll(/@keyframes ([\w-]+)\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
    blocks.set(
      name,
      [...body.matchAll(/([\d.]+)%\{([^}]*)\}/g)].map(([, at, declarations]) => {
        expect(declarations, `${name} at ${at}%`).toMatch(/^opacity:[\d.]+$/);
        return [Number(at), Number(declarations.slice("opacity:".length))];
      }),
    );
  }
  return blocks;
}

/** A layer's opacity at a point in the cycle, read off its frames. */
function opacityAt(frames: readonly [number, number][], at: number): number {
  const after = frames.findIndex(([percent]) => percent >= at);
  const [toAt, to] = frames[after];
  if (toAt === at || after === 0) return to;
  const [fromAt, from] = frames[after - 1];
  return from + ((to - from) * (at - fromAt)) / (toAt - fromAt);
}

const FRAMES = keyframes(CSS);
const RAMP = (TIMELINE.rampSeconds / TIMELINE.cycleSeconds) * 100;

/** Each animated layer: its attribute, its part and its frames. */
const LAYERS = (Object.entries(PARTS) as [PartId, Part][]).flatMap(([id, part]) =>
  (part.shows === "always" ? part.layers : (["part", ...part.layers] as const)).map((layer) => ({
    id,
    part,
    layer,
    frames: FRAMES.get(`job-path-${layer}-${id}`) ?? [],
  })),
);

function drawing(): HTMLElement {
  const { container } = render(<JobPath />);
  return container.querySelector<HTMLElement>("[data-job-path-drawing]")!;
}

describe("JobPath", () => {
  it("labels its parts with what each customer's agent gets, each title once", () => {
    const picture = drawing();

    for (const id of AGENT_GET_IDS) {
      const { title } = AGENT_GETS[id];
      expect(picture.textContent?.split(title).length, title).toBe(2);
      const label = picture.querySelector(`[data-promise="${id}"]`);
      expect(label?.textContent, id).toBe(title);
      const part = LABELS[id];
      if (part) expect(label?.closest(`[data-part="${part}"]`), `${title} at ${part}`).not.toBeNull();
    }
  });

  it("names the job as the docs spell it", () => {
    const picture = drawing();
    const caption = document.querySelector("figcaption")?.textContent ?? "";

    for (const [key, word] of Object.entries(JOB) as [keyof typeof JOB, string][]) {
      const page = readFileSync(resolve(DOCS, SPELLED_IN[key]), "utf8");
      expect(page.includes(word), `docs/${SPELLED_IN[key]} spells ${word}`).toBe(true);
      expect(picture.textContent, word).toContain(word);
    }
    for (const word of [JOB.customer, JOB.ledger, JOB.report]) expect(caption).toContain(word);
  });

  it("is one figure with a caption, no heading and one button", () => {
    render(<JobPath />);

    const figure = screen.getByRole("figure");
    expect(figure.querySelector("figcaption")?.textContent).toMatch(/hours.*asks before.*behind a wall/);
    expect(figure.querySelector("[data-job-path-drawing]")?.getAttribute("aria-hidden")).toBe("true");
    expect(figure.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
    expect(figure.querySelectorAll("button, a, input, [tabindex]")).toHaveLength(1);
  });

  it("pauses and plays again, its name the same either way", () => {
    render(<JobPath />);
    const figure = screen.getByRole("figure");
    const button = screen.getByRole("button", { name: "Pause animation" });

    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(figure.getAttribute("data-paused")).toBe("false");

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Pause animation" })).toBe(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(figure.getAttribute("data-paused")).toBe("true");

    fireEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(figure.getAttribute("data-paused")).toBe("false");
  });
});

describe("the job's loop", () => {
  it("runs every layer on the one cycle, with no delay, held at both ends", () => {
    const rules = [...CSS.matchAll(/animation:([^;}]*)/g)].map(([, value]) => value);

    expect(CSS).toContain(`--job-path-cycle:${TIMELINE.cycleSeconds}s`);
    expect(rules).toHaveLength(LAYERS.length);
    for (const value of rules) expect(value).toMatch(/^job-path-[\w-]+ var\(--job-path-cycle\) linear infinite both$/);
    expect(CSS).not.toMatch(/animation-delay/);
  });

  it("starts and ends on the finished picture", () => {
    for (const { id, part, layer, frames } of LAYERS) {
      const finished = OPACITY[layer][layer === "part" || part.litAtHold ? "on" : "off"];
      expect(frames[0], `${layer} ${id}`).toEqual([0, finished]);
      expect(frames.at(-1), `${layer} ${id}`).toEqual([100, finished]);
    }
  });

  it("holds the finished picture for at least 30% of the cycle", () => {
    const settled = TIMELINE.settles + RAMP;
    for (const { id, layer, frames } of LAYERS) {
      for (const [at] of frames.slice(1, -1)) {
        expect(at, `${layer} ${id}`).toBeGreaterThanOrEqual(TIMELINE.clears);
        expect(at, `${layer} ${id}`).toBeLessThanOrEqual(settled + 0.001);
      }
    }
    expect(TIMELINE.clears + (100 - settled)).toBeGreaterThanOrEqual(30);
  });

  it("clears to the stage, then shows each part at its own step, in the story's order", () => {
    const starts = STEPS.map((step) => TIMELINE.steps[step]);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(TIMELINE.clears).toBeLessThan(starts[0]);
    expect(TIMELINE.settles).toBeGreaterThan(starts.at(-1)!);

    for (const { id, part, frames } of LAYERS.filter(({ layer }) => layer === "part")) {
      expect(opacityAt(frames, TIMELINE.clears + RAMP), id).toBe(0);
      const shows = part.shows === "always" ? 0 : TIMELINE.steps[part.shows];
      expect(opacityAt(frames, shows), id).toBe(0);
      expect(opacityAt(frames, shows + RAMP), id).toBe(1);
    }
  });

  it("lights each part at its own steps only", () => {
    for (const { id, part, layer, frames } of LAYERS.filter(({ layer }) => layer !== "part")) {
      for (const step of STEPS) {
        const end = (STEPS[STEPS.indexOf(step) + 1] ? TIMELINE.steps[STEPS[STEPS.indexOf(step) + 1]] : TIMELINE.settles) - 1;
        expect(opacityAt(frames, end), `${layer} ${id} at ${step}`).toBe(
          OPACITY[layer][(part.lit as readonly string[]).includes(step) ? "on" : "off"],
        );
      }
    }
  });

  it("animates opacity only", () => {
    const blocks = [...CSS.matchAll(/@keyframes [\w-]+\{((?:[^{}]*\{[^{}]*\})*)\}/g)];
    expect(blocks).toHaveLength(LAYERS.length);
    for (const [, body] of blocks) expect(body.replace(/[\d.]+%\{opacity:[\d.]+\}/g, "")).toBe("");
  });

  it("has a rule for every layer the picture draws, and none for a layer it does not", () => {
    const picture = drawing();
    const drawn = new Set(
      ["data-part", "data-ring", "data-ink", "data-stroke"].flatMap((attribute) =>
        [...picture.querySelectorAll(`[${attribute}]`)].map((element) => `[${attribute}=${element.getAttribute(attribute)}]`),
      ),
    );
    const ruled = new Set([...CSS.matchAll(/\[data-job-path\] (\[data-(?:part|ring|ink|stroke)=[\w-]+\])\{/g)].map(([, selector]) => selector));

    expect([...drawn].sort()).toEqual([...ruled].sort());
  });

  it("pauses every layer, and hides the pause button when motion is reduced", () => {
    const paused = /([^}\n]*)\{animation-play-state:paused\}/.exec(CSS)?.[1].split(",") ?? [];
    expect(paused.sort()).toEqual(
      ["part", "ring", "ink", "stroke"].map((layer) => `[data-job-path][data-paused=true] [data-${layer}]`).sort(),
    );
    expect(CSS).toContain("@media (prefers-reduced-motion:reduce){[data-job-path-pause]{display:none}}");
  });

  it("holds nothing an escaping step could change", () => {
    expect(CSS).not.toMatch(/["'<>&]/);
  });
});
