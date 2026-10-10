/**
 * Pins the pattern pool (patterns.ts): counts up to the limit per text, a
 * refused pattern answered as invalid, and the deadline: a catastrophically
 * backtracking pattern answers "timeout" near its budget instead of
 * blocking, the overrunning worker is replaced, and the pool keeps
 * answering. Queued jobs wait for a free worker and their budget starts
 * when one takes them. A closed pool refuses work.
 */
import { afterAll, describe, expect, it } from "vitest";

import { newPatternPool } from "../patterns.js";

const pool = newPatternPool(1);
afterAll(async () => {
  await pool.close();
});

describe("the pattern pool", () => {
  it("counts matches per text up to the limit", async () => {
    const answer = await pool.count({ pattern: "a", flags: "", texts: ["aaa", "b", "aa"], limit: 2, budgetMs: 2_000 });
    expect(answer).toEqual({ kind: "counts", counts: [2, 0, 2] });
  });

  it("answers a pattern JavaScript refuses as invalid", async () => {
    const answer = await pool.count({ pattern: "(", flags: "", texts: ["x"], limit: 1, budgetMs: 2_000 });
    expect(answer.kind).toBe("invalid");
    const flags = await pool.count({ pattern: "x", flags: "q", texts: ["x"], limit: 1, budgetMs: 2_000 });
    expect(flags.kind).toBe("invalid");
  });

  it("stops a catastrophically backtracking pattern at its deadline and recovers", async () => {
    const started = Date.now();
    const answer = await pool.count({
      pattern: "^(a+)+$",
      flags: "",
      texts: [`${"a".repeat(40)}!`],
      limit: 1,
      budgetMs: 300,
    });
    const elapsed = Date.now() - started;
    expect(answer).toEqual({ kind: "timeout" });
    expect(elapsed).toBeLessThan(5_000);
    const after = await pool.count({ pattern: "b", flags: "", texts: ["abc"], limit: 1, budgetMs: 2_000 });
    expect(after).toEqual({ kind: "counts", counts: [1] });
  }, 15_000);

  it("queues jobs behind a busy worker", async () => {
    const answers = await Promise.all(
      ["a", "b", "c"].map((pattern) =>
        pool.count({ pattern, flags: "i", texts: ["ABC"], limit: 1, budgetMs: 2_000 }),
      ),
    );
    expect(answers).toEqual([
      { kind: "counts", counts: [1] },
      { kind: "counts", counts: [1] },
      { kind: "counts", counts: [1] },
    ]);
  });

  it("answers a spent budget without running, and a closed pool refuses work", async () => {
    expect(await pool.count({ pattern: "a", flags: "", texts: ["a"], limit: 1, budgetMs: 0 })).toEqual({ kind: "timeout" });
    const closed = newPatternPool(1);
    await closed.close();
    await expect(closed.count({ pattern: "a", flags: "", texts: ["a"], limit: 1, budgetMs: 100 })).rejects.toThrow("closed");
  });
});
