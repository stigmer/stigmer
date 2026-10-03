/**
 * Pins the substrate driver's one real-clock wait (delay.ts): it resolves,
 * and not before its time.
 */
import { describe, expect, it } from "vitest";

import { delay } from "../delay.js";

describe("delay", () => {
  it("resolves once the time has passed", async () => {
    const started = Date.now();
    await delay(20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});
