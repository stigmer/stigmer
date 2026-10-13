// Tests for how an ask is answered: `--approve-default` parses its four
// words (any case, with the approve-all spellings) and refuses anything
// else; each choice maps to its answer, skip and an unset flag to a deny
// carrying the neutral skip reason; each answer has its status word; and an
// answer goes out as confirmToolUse (allow, or deny with its reason) or as
// grantPermission, naming the session and the tool use.

import type { ConfirmToolUseInput, GrantPermissionInput } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../../errors/index.js";
import { answerFor, answerWord, parseApproveDefault, SKIP_REASON, submitAnswer } from "../answer.js";

describe("parseApproveDefault", () => {
  it("parses each choice, case-insensitively, and empty as unset", () => {
    expect(parseApproveDefault("")).toBe("");
    expect(parseApproveDefault("  ")).toBe("");
    expect(parseApproveDefault("approve")).toBe("approve");
    expect(parseApproveDefault("SKIP")).toBe("skip");
    expect(parseApproveDefault("reject")).toBe("reject");
    expect(parseApproveDefault("approve-all")).toBe("approve-all");
    expect(parseApproveDefault("approve_all")).toBe("approve-all");
    expect(parseApproveDefault("ApproveAll")).toBe("approve-all");
  });

  it("refuses any other word as a usage error", () => {
    expect(() => parseApproveDefault("maybe")).toThrow(UsageError);
    expect(() => parseApproveDefault("maybe")).toThrow(/must be one of: approve, skip, reject, approve-all/);
  });
});

describe("answerFor and answerWord", () => {
  it("maps each choice to its answer and names it", () => {
    expect(answerFor("approve")).toEqual({ kind: "allow" });
    expect(answerFor("reject")).toEqual({ kind: "deny", reason: "" });
    expect(answerFor("approve-all")).toEqual({ kind: "grant" });
    expect(answerFor("skip")).toEqual({ kind: "deny", reason: SKIP_REASON });
    expect(answerFor("")).toEqual({ kind: "deny", reason: SKIP_REASON });

    expect(answerWord(answerFor("approve"))).toBe("allowed");
    expect(answerWord(answerFor("reject"))).toBe("denied");
    expect(answerWord(answerFor("skip"))).toBe("skipped");
    expect(answerWord(answerFor("approve-all"))).toBe("allowed for the rest of the turn");
  });
});

describe("submitAnswer", () => {
  function double() {
    const confirms: ConfirmToolUseInput[] = [];
    const grants: GrantPermissionInput[] = [];
    const client = {
      session: {
        confirmToolUse: async (input: ConfirmToolUseInput) => void confirms.push(input),
        grantPermission: async (input: GrantPermissionInput) => void grants.push(input),
      },
    };
    return { client, confirms, grants };
  }

  it("allows through confirmToolUse with no reason", async () => {
    const d = double();
    await submitAnswer(d.client, "ses_1", "run_1.c1", { kind: "allow" });
    expect(d.confirms.map((c) => [c.sessionId, c.toolUseId, c.result, c.denyMessage])).toEqual([
      ["ses_1", "run_1.c1", "allow", ""],
    ]);
    expect(d.grants).toEqual([]);
  });

  it("denies through confirmToolUse with the reason", async () => {
    const d = double();
    await submitAnswer(d.client, "ses_1", "run_1.c1", { kind: "deny", reason: "unsafe" });
    expect(d.confirms.map((c) => [c.result, c.denyMessage])).toEqual([["deny", "unsafe"]]);
  });

  it("grants through grantPermission", async () => {
    const d = double();
    await submitAnswer(d.client, "ses_1", "run_1.c1", { kind: "grant" });
    expect(d.grants.map((g) => [g.sessionId, g.toolUseId])).toEqual([["ses_1", "run_1.c1"]]);
    expect(d.confirms).toEqual([]);
  });
});
