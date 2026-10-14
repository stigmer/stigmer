// Pins the case folder a run becomes: prompt.md with the format's starting
// limits and the request as its body; graders/criteria.md, an llm rubric
// whose FAIL line names what went wrong (the judge's reason first, then the
// person's comment, else the format's placeholder); graders/skill-fired.md
// only when a skill was never read, matching it bare or namespaced; and the
// note a multi-turn run carries. Also pins the suggested case name.

import { describe, expect, it } from "vitest";
import { caseFromRun, MULTI_TURN_NOTE, suggestCaseName } from "../case-from-run.js";

const BASE = { request: "Write me a commit message for this change.", caseName: "commit-message", multiTurn: false };

function file(result: ReturnType<typeof caseFromRun>, path: string): string | undefined {
  return result.files.find((candidate) => candidate.path === path)?.content;
}

describe("caseFromRun", () => {
  it("writes prompt.md with the format's starting limits and the request as its body", () => {
    expect(file(caseFromRun(BASE), "prompt.md")).toBe(
      "---\nmax_turns: 10\nallowed_tools: [Read, Glob, Grep, Skill]\n---\n\nWrite me a commit message for this change.\n",
    );
  });

  it("seeds the FAIL line from the judge's reason before the person's comment", () => {
    const criteria = file(
      caseFromRun({ ...BASE, judgeReason: "the reply invented a flag\nthat git lacks", thumbsComment: "wrong" }),
      "graders/criteria.md",
    );
    expect(criteria).toBe(
      "---\ntype: llm\n---\n\nPASS if <what a correct response contains>.\n" +
        "FAIL if the response repeats what went wrong in the run this case was made from: the reply invented a flag that git lacks.\n",
    );
  });

  it("seeds it from the person's comment when there is no judge reason, and keeps the placeholder with neither", () => {
    expect(file(caseFromRun({ ...BASE, thumbsComment: "Too long!" }), "graders/criteria.md")).toContain(
      "made from: Too long!\n",
    );
    expect(file(caseFromRun(BASE), "graders/criteria.md")).toContain(
      "FAIL if <what a wrong or missing response looks like>.\n",
    );
  });

  it("adds the skill check only when a skill was never read, matching the bare and namespaced names", () => {
    expect(caseFromRun(BASE).files.map((f) => f.path)).toEqual(["prompt.md", "graders/criteria.md"]);
    const skill = file(
      caseFromRun({ ...BASE, skillNeverRead: { plugin: "thermos", skill: "review.diff" } }),
      "graders/skill-fired.md",
    );
    expect(skill).toBe(
      "---\ntype: tool_used\ntool: Skill\ninput_match: '\"skill\"\\s*:\\s*\"(?:[\\w-]+:)?review\\.diff\"'\n---\n",
    );
    const pattern = new RegExp(/input_match: '(.*)'/.exec(skill ?? "")![1]!);
    expect(pattern.test('{"skill": "thermos:review.diff"}')).toBe(true);
    expect(pattern.test('{"skill":"review.diff"}')).toBe(true);
    expect(pattern.test('{"skill":"reviewXdiff"}')).toBe(false);
  });

  it("notes a multi-turn run, and says nothing for a single request", () => {
    expect(caseFromRun({ ...BASE, multiTurn: true }).note).toBe(MULTI_TURN_NOTE);
    expect(caseFromRun(BASE)).not.toHaveProperty("note");
  });
});

describe("suggestCaseName", () => {
  it("names a case after its request in dashed words, cut at a word", () => {
    expect(suggestCaseName("Look over my diff, please!")).toBe("look-over-my-diff-please");
    const long = suggestCaseName("rename getUser to fetchUser and update the three call sites in the service layer");
    expect(long.length).toBeLessThanOrEqual(48);
    expect(long.endsWith("-")).toBe(false);
  });

  it("falls back for a request with no words, and cuts one overlong word", () => {
    expect(suggestCaseName("!!! ???")).toBe("case-from-run");
    expect(suggestCaseName("x".repeat(60))).toBe("x".repeat(48));
  });
});
