/**
 * Pins the AI judge's rule set: how its answer is read, the version every
 * judge score carries, and the instruction's version.
 *
 * The load-bearing pins:
 *   - the verdict is read only when it names exactly the rubrics, each with
 *     a known result and a non-empty string reason; a reason past 500
 *     characters is cut to the bound and marked, never refused
 *     (stigmer#2177);
 *   - JUDGE_EVALUATOR_VERSION is pinned: a rubric, schema or instruction
 *     change moves it on purpose, here;
 *   - JUDGE_INSTRUCTION_VERSION is pinned: it re-versions every judge,
 *     plugin eval and agent eval score, so it moves only on purpose.
 */
import { describe, expect, it } from "vitest";

import { JUDGE_INSTRUCTION_VERSION } from "../instruction.js";
import type { JsonObject } from "../json.js";
import {
  DID_THE_TASK,
  JUDGE_EVALUATOR_VERSION,
  MADE_NOTHING_UP,
  VERDICT_SCHEMA,
} from "../rubrics.js";
import { cutReason, readVerdict } from "../verdict.js";

describe("readVerdict", () => {
  const good = {
    [DID_THE_TASK]: { result: "failed", reason: "The assign call failed but the answer says it was assigned." },
    [MADE_NOTHING_UP]: { result: "not_applicable", reason: "No claims." },
  };

  it("reads exactly the rubrics, in rubric order", () => {
    expect(readVerdict(good)).toEqual({
      kind: "read",
      verdicts: [
        { name: DID_THE_TASK, result: "failed", reason: good[DID_THE_TASK].reason },
        { name: MADE_NOTHING_UP, result: "not_applicable", reason: "No claims." },
      ],
    });
  });

  it("cuts a reason past the bound and keeps the result", () => {
    const long = "r".repeat(600);
    expect(readVerdict({ ...good, [DID_THE_TASK]: { result: "passed", reason: long } })).toMatchObject({
      kind: "read",
      verdicts: [{ name: DID_THE_TASK, result: "passed", reason: `${long.slice(0, 494)} [cut]` }, {}],
    });
    expect(cutReason("r".repeat(500))).toBe("r".repeat(500));
    expect(cutReason("r".repeat(501))).toHaveLength(500);
  });

  it("refuses wrong rubrics, a missing, empty or non-string reason, an unknown result, extra keys and no output", () => {
    const refusals: Array<JsonObject | undefined> = [
      undefined,
      { [DID_THE_TASK]: good[DID_THE_TASK] },
      { ...good, extra: { result: "passed", reason: "x" } },
      { ...good, [DID_THE_TASK]: { result: "passed" } },
      { ...good, [DID_THE_TASK]: { result: "passed", reason: "" } },
      { ...good, [DID_THE_TASK]: { result: "passed", reason: "   " } },
      { ...good, [DID_THE_TASK]: { result: "passed", reason: 7 } },
      { ...good, [DID_THE_TASK]: { result: "mostly", reason: "x" } },
      { ...good, [DID_THE_TASK]: { result: "passed", reason: "x", score: 1 } },
      { ...good, [DID_THE_TASK]: "passed" },
    ];
    for (const output of refusals) {
      expect(readVerdict(output).kind, JSON.stringify(output)).toBe("refused");
    }
  });

  it("reads a narrowed shape: one named rubric, passed or failed only", () => {
    const shape = { rubrics: ["tone"], results: ["passed", "failed"] } as const;
    expect(readVerdict({ tone: { result: "passed", reason: "Polite." } }, shape)).toEqual({
      kind: "read",
      verdicts: [{ name: "tone", result: "passed", reason: "Polite." }],
    });
    expect(readVerdict({ tone: { result: "not_applicable", reason: "n/a" } }, shape).kind).toBe("refused");
  });
});

describe("rubrics", () => {
  it("pins the version every judge score carries", () => {
    expect(JUDGE_EVALUATOR_VERSION).toBe(
      "8191b6ca352b050221ccb7b3e85aa453333df6fbf70b322858cb793a65681d20",
    );
  });

  it("asks for exactly the two rubrics", () => {
    expect(VERDICT_SCHEMA["required"]).toEqual([DID_THE_TASK, MADE_NOTHING_UP]);
    expect(VERDICT_SCHEMA["additionalProperties"]).toBe(false);
  });

  it("pins the instruction's version, which every judge and eval score hashes", () => {
    expect(JUDGE_INSTRUCTION_VERSION).toBe("1");
  });
});
