import { test } from "node:test";
import assert from "node:assert/strict";

import { collectShotNames, findStepsArray } from "./tour-shots.mjs";

test("findStepsArray mirrors pack's duck-typed discovery", () => {
  const steps = [{ delayMs: 0, data: {} }];
  const mod = {
    OTHER_LINES: ["a", "b"], // string array — no collision
    TERMINAL: [{ type: "prompt", text: "x" }], // objects without delayMs
    tourSteps: steps,
  };
  assert.equal(findStepsArray(mod), steps);
  assert.equal(findStepsArray({ empty: [] }), null);
});

test("collectShotNames reads declared shots in step order, skipping empty and absent", () => {
  const steps = [
    { delayMs: 1000 },
    { delayMs: 2000, shot: "opening" },
    { delayMs: 3000, shot: "" },
    { delayMs: 4000, shot: "finale" },
  ];
  assert.deepEqual(collectShotNames(steps), ["opening", "finale"]);
});

test("collectShotNames returns empty for a shot-less timeline — the deploy's skip signal", () => {
  // pack-all shoots only shot-declaring tours; an empty result here is what
  // keeps the release workflow from launching a browser for the other 20.
  assert.deepEqual(collectShotNames([{ delayMs: 1000 }, { delayMs: 2000 }]), []);
});
