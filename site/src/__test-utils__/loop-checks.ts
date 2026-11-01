/**
 * The rules every looping picture's stylesheet keeps, as assertions a
 * picture's test calls inside its own cases, so two pictures are held to one
 * set of rules, not two copies.
 *
 * Each reads the stylesheet `loopCss` built (site/src/components/visuals/
 * drawing/loop.ts) and checks it against the loop's own table, read field by
 * field rather than through the engine's `isOn`, so the engine is checked,
 * not echoed: the loop starts and ends on the finished picture, holds it for
 * at least 30% of the cycle, clears to the stage, shows and hides each part
 * at its own steps, lights each at its own steps only, animates opacity only,
 * has a rule for every layer the picture draws and none for one it does not,
 * pauses every layer, and hides its pause button when motion is reduced.
 */
import { expect } from "vitest";
import { LAYER_ATTRIBUTE, layersOf, type Layer, type Loop, type LoopPart } from "@/components/visuals/drawing/loop";

type AnyLoop = Loop<string, string>;

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

function ramp(loop: AnyLoop): number {
  return (loop.timeline.rampSeconds / loop.timeline.cycleSeconds) * 100;
}

/** Each animated layer: its part's id, the part, the layer and its frames. */
function layers(loop: AnyLoop, css: string) {
  const frames = keyframes(css);
  return (Object.entries(loop.parts) as [string, LoopPart<string>][]).flatMap(([id, part]) =>
    layersOf(part).map((layer) => ({ id, part, layer, frames: frames.get(`${loop.prefix}-${layer}-${id}`) ?? [] })),
  );
}

/** Whether a part shows at a step, from its table: from its first step, until the step it goes at. */
function showsAt(loop: AnyLoop, part: LoopPart<string>, step: string): boolean {
  if (part.shows === "always") return true;
  const at = loop.steps.indexOf(step);
  return loop.steps.indexOf(part.shows) <= at && (part.hides === undefined || at < loop.steps.indexOf(part.hides));
}

/** Where a step's light ends: at the next step, or where the picture settles. */
function stepEnd(loop: AnyLoop, step: string): number {
  const next = loop.steps[loop.steps.indexOf(step) + 1];
  return next === undefined ? loop.timeline.settles : loop.timeline.steps[next];
}

/** Every layer runs on the one cycle, with no delay, held at both ends. */
export function expectOneCycle(loop: AnyLoop, css: string): void {
  const rules = [...css.matchAll(/animation:([^;}]*)/g)].map(([, value]) => value);
  const name = new RegExp(`^${loop.prefix}-[\\w-]+ var\\(--${loop.prefix}-cycle\\) linear infinite both$`);

  expect(css).toContain(`--${loop.prefix}-cycle:${loop.timeline.cycleSeconds}s`);
  expect(rules).toHaveLength(layers(loop, css).length);
  for (const value of rules) expect(value).toMatch(name);
  expect(css).not.toMatch(/animation-delay/);
}

/** Every layer starts and ends on the finished picture. */
export function expectFinishedAtBothEnds(loop: AnyLoop, css: string): void {
  for (const { id, part, layer, frames } of layers(loop, css)) {
    const on = layer === "part" ? part.hides === undefined : part.litAtHold;
    const finished = loop.opacity[layer][on ? "on" : "off"];
    expect(frames[0], `${layer} ${id}`).toEqual([0, finished]);
    expect(frames.at(-1), `${layer} ${id}`).toEqual([100, finished]);
  }
}

/** Nothing changes between where the picture settles and where it clears, at least 30% of the cycle. */
export function expectLongHold(loop: AnyLoop, css: string): void {
  const settled = loop.timeline.settles + ramp(loop);
  for (const { id, layer, frames } of layers(loop, css)) {
    for (const [at] of frames.slice(1, -1)) {
      expect(at, `${layer} ${id}`).toBeGreaterThanOrEqual(loop.timeline.clears);
      expect(at, `${layer} ${id}`).toBeLessThanOrEqual(settled + 0.001);
    }
  }
  expect(loop.timeline.clears + (100 - settled)).toBeGreaterThanOrEqual(30);
}

/** The steps run in order, after the clear and before the settle; each part shows, and goes, at its own steps. */
export function expectShownAtTheirSteps(loop: AnyLoop, css: string): void {
  const starts = loop.steps.map((step) => loop.timeline.steps[step]);
  expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  expect(loop.timeline.clears).toBeLessThan(starts[0]);
  expect(loop.timeline.settles).toBeGreaterThan(starts.at(-1)!);

  for (const { id, part, frames } of layers(loop, css).filter(({ layer }) => layer === "part")) {
    expect(opacityAt(frames, loop.timeline.clears + ramp(loop)), id).toBe(0);
    if (part.shows !== "always") {
      const shows = loop.timeline.steps[part.shows];
      expect(opacityAt(frames, shows), id).toBe(0);
      expect(opacityAt(frames, shows + ramp(loop)), id).toBe(1);
    }
    for (const step of loop.steps) {
      expect(opacityAt(frames, stepEnd(loop, step) - 1), `${id} at ${step}`).toBe(showsAt(loop, part, step) ? 1 : 0);
    }
  }
}

/** Each part is lit at its own steps only. */
export function expectLitAtTheirSteps(loop: AnyLoop, css: string): void {
  for (const { id, part, layer, frames } of layers(loop, css).filter(({ layer }) => layer !== "part")) {
    for (const step of loop.steps) {
      expect(opacityAt(frames, stepEnd(loop, step) - 1), `${layer} ${id} at ${step}`).toBe(
        loop.opacity[layer as Layer][part.lit.includes(step) ? "on" : "off"],
      );
    }
  }
}

/** Every keyframe sets opacity and nothing else. */
export function expectOpacityOnly(loop: AnyLoop, css: string): void {
  const blocks = [...css.matchAll(/@keyframes [\w-]+\{((?:[^{}]*\{[^{}]*\})*)\}/g)];
  expect(blocks).toHaveLength(layers(loop, css).length);
  for (const [, body] of blocks) expect(body.replace(/[\d.]+%\{opacity:[\d.]+\}/g, "")).toBe("");
}

/** A rule for every layer the rendered picture draws, and none for a layer it does not. */
export function expectRuleForEveryLayer(loop: AnyLoop, css: string, drawing: HTMLElement): void {
  const attributes = Object.values(LAYER_ATTRIBUTE);
  const drawn = new Set(
    attributes.flatMap((attribute) =>
      [...drawing.querySelectorAll(`[${attribute}]`)].map((element) => `[${attribute}=${element.getAttribute(attribute)}]`),
    ),
  );
  const ruled = new Set(
    [...css.matchAll(new RegExp(`\\[data-${loop.prefix}\\] (\\[data-(?:part|ring|ink|stroke)=[\\w-]+\\])\\{`, "g"))].map(
      ([, selector]) => selector,
    ),
  );

  expect([...drawn].sort()).toEqual([...ruled].sort());
}

/** The pause stops every layer, and the button goes when motion is reduced. */
export function expectPauseRules(loop: AnyLoop, css: string): void {
  const paused = /([^}\n]*)\{animation-play-state:paused\}/.exec(css)?.[1].split(",") ?? [];
  expect(paused.sort()).toEqual(
    ["part", "ring", "ink", "stroke"].map((layer) => `[data-${loop.prefix}][data-paused=true] [data-${layer}]`).sort(),
  );
  expect(css).toContain(`@media (prefers-reduced-motion:reduce){[data-${loop.prefix}-pause]{display:none}}`);
}

/** The stylesheet holds no character an escaping step could change. */
export function expectNothingEscapable(css: string): void {
  expect(css).not.toMatch(/["'<>&]/);
}
