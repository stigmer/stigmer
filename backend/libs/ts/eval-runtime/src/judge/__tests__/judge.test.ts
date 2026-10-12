/**
 * Pins the AI judge's rule set: how its answer is read, the version every
 * judge score carries, and the instruction's version.
 *
 * The load-bearing pins:
 *   - the verdict is read only when it names exactly the rubrics, each with
 *     a known result and a non-empty string reason; a reason past 500
 *     characters is cut to the bound and marked, never refused
 *     (stigmer#2177);
 *   - the four rubrics, each answered with its reason first;
 *   - JUDGE_EVALUATOR_VERSION is pinned: a rubric, schema, instruction,
 *     message or subject change moves it on purpose, here, and the
 *     benchmark's calibration must then be run again;
 *   - JUDGE_INSTRUCTION_VERSION is pinned: it re-versions every judge,
 *     plugin eval and agent eval score, so it moves only on purpose.
 */
import { describe, expect, it } from "vitest";

import { JUDGE_INSTRUCTION_VERSION } from "../instruction.js";
import type { JsonObject } from "../json.js";
import {
  ACTED_ONLY_AS_ASKED,
  ASKED_WHEN_UNCLEAR,
  DID_THE_TASK,
  JUDGE_EVALUATOR_VERSION,
  MADE_NOTHING_UP,
  RUBRICS,
  VERDICT_SCHEMA,
  judgeMessage,
} from "../rubrics.js";
import { cutReason, readVerdict } from "../verdict.js";

describe("readVerdict", () => {
  const good = {
    [DID_THE_TASK]: { result: "failed", reason: "The assign call failed but the answer says it was assigned." },
    [MADE_NOTHING_UP]: { result: "not_applicable", reason: "No claims." },
    [ACTED_ONLY_AS_ASKED]: { reason: "Only the asked assign call changed anything.", result: "passed" },
    [ASKED_WHEN_UNCLEAR]: { reason: "One plain reading.", result: "not_applicable" },
  };

  it("reads exactly the rubrics, in rubric order", () => {
    expect(readVerdict(good)).toEqual({
      kind: "read",
      verdicts: [
        { name: DID_THE_TASK, result: "failed", reason: good[DID_THE_TASK].reason },
        { name: MADE_NOTHING_UP, result: "not_applicable", reason: "No claims." },
        { name: ACTED_ONLY_AS_ASKED, result: "passed", reason: good[ACTED_ONLY_AS_ASKED].reason },
        { name: ASKED_WHEN_UNCLEAR, result: "not_applicable", reason: "One plain reading." },
      ],
    });
  });

  it("cuts a reason past the bound and keeps the result", () => {
    const long = "r".repeat(600);
    expect(readVerdict({ ...good, [DID_THE_TASK]: { result: "passed", reason: long } })).toMatchObject({
      kind: "read",
      verdicts: [{ name: DID_THE_TASK, result: "passed", reason: `${long.slice(0, 494)} [cut]` }, {}, {}, {}],
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
      "e6b2728dfc4b352a7bc30bd450fe6112dd914ffe5cb15ac34c9ff0a2616872e7",
    );
  });

  it("asks for exactly the four rubrics, each a reason before its result", () => {
    expect(VERDICT_SCHEMA["required"]).toEqual([DID_THE_TASK, MADE_NOTHING_UP, ACTED_ONLY_AS_ASKED, ASKED_WHEN_UNCLEAR]);
    expect(VERDICT_SCHEMA["additionalProperties"]).toBe(false);
    const properties = VERDICT_SCHEMA["properties"] as Record<string, { properties: Record<string, unknown> }>;
    for (const rubric of RUBRICS) {
      expect(Object.keys(properties[rubric.name]?.properties ?? {}), rubric.name).toEqual(["reason", "result"]);
    }
  });

  it("names every rubric in the message, and tells the judge which turn it grades", () => {
    const message = judgeMessage("{}");
    for (const rubric of RUBRICS) {
      expect(message).toContain(`- ${rubric.name}: ${rubric.text}`);
    }
    expect(message).toContain("earlier_turns are the turns before it");
  });

  it("pins the instruction's version, which every judge and eval score hashes", () => {
    expect(JUDGE_INSTRUCTION_VERSION).toBe("1");
  });
});
