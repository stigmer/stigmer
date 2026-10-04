/**
 * Every inline demo scenario's timeline agrees with its recorded narration.
 *
 * The narration manifest is generated from a scenario's `steps.ts` and
 * committed beside it; nothing ties the two together after that, so a step
 * added, removed or re-narrated without regenerating plays the wrong clip or
 * none. This suite loads each scenario's real step module (so a fixture that
 * no longer builds fails here too) and pins, per step: a narrated step has a
 * manifest entry pointing at its own `step-<index>.mp3`, which exists in the
 * scenario's `narration/` folder; a silent step has a `null` entry; and the
 * manifest has exactly one entry per step.
 *
 * `scripts/validate-demos.ts` counts steps by text; this suite reads the
 * timeline itself, which is why both exist. The audio's content is not
 * checked: generation is not deterministic, and the text is the source.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface NarrationManifest {
  readonly steps: readonly ({ readonly src: string; readonly durationMs: number } | null)[];
}

interface TimelineStep {
  readonly delayMs: number;
  readonly narration?: string;
}

const SCENARIOS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Reads a scenario's committed manifest, or `undefined` when it has none. */
function manifestOf(scenario: string): NarrationManifest | undefined {
  const file = path.join(SCENARIOS_DIR, scenario, "narration", "manifest.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as NarrationManifest) : undefined;
}

function isTimelineStep(value: unknown): value is TimelineStep {
  return typeof value === "object" && value !== null && typeof (value as { delayMs?: unknown }).delayMs === "number";
}

/** The one exported array of steps in a scenario's `steps.ts`. */
function timelineOf(mod: Record<string, unknown>): readonly TimelineStep[] {
  const timelines = Object.values(mod).filter(
    (v): v is TimelineStep[] => Array.isArray(v) && v.length > 0 && v.every(isTimelineStep),
  );
  expect(timelines).toHaveLength(1);
  return timelines[0];
}

const scenarios = readdirSync(SCENARIOS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(path.join(SCENARIOS_DIR, e.name, "steps.ts")))
  .map((e) => e.name)
  .sort();

describe("demo scenario narration", () => {
  it("finds the scenarios", () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it.each(scenarios)("%s: one manifest entry per step, matching its narration", async (scenario) => {
    const mod = (await import(`../${scenario}/steps.ts`)) as Record<string, unknown>;
    const steps = timelineOf(mod);
    const manifest = manifestOf(scenario);
    const narrated = steps.some((s) => typeof s.narration === "string" && s.narration.length > 0);
    if (!narrated) {
      expect(manifest).toBeUndefined();
      return;
    }
    if (!manifest) throw new Error(`${scenario} narrates but has no narration/manifest.json`);
    expect(manifest.steps).toHaveLength(steps.length);

    steps.forEach((step, index) => {
      const entry = manifest.steps[index];
      if (!step.narration) {
        expect(entry, `${scenario} step ${index} is silent`).toBeNull();
        return;
      }
      expect(entry, `${scenario} step ${index} is narrated`).not.toBeNull();
      const clip = `step-${index}.mp3`;
      expect(entry?.src.endsWith(`/${clip}`)).toBe(true);
      expect(existsSync(path.join(SCENARIOS_DIR, scenario, "narration", clip))).toBe(true);
    });
  });
});
