// Tests for how an ask is answered: `--approve-default` parses its three
// words (any case, with the allow-all spellings), refuses a retired word with
// the word that replaced it, and refuses anything else; each choice maps to
// its answer, deny and an unset flag to a deny carrying the neutral reason;
// each answer has its status word; and an
// answer goes out as confirmToolUse (allow, or deny with its reason) or as
// grantPermission, naming the session and the tool use.

import type { ConfirmToolUseInput, GrantPermissionInput } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../../errors/index.js";
import { answerFor, answerWord, parseApproveDefault, DENY_REASON, submitAnswer } from "../answer.js";

describe("parseApproveDefault", () => {
  it("parses each choice, case-insensitively, and empty as unset", () => {
    expect(parseApproveDefault("")).toBe("");
    expect(parseApproveDefault("  ")).toBe("");
    expect(parseApproveDefault("allow")).toBe("allow");
    expect(parseApproveDefault("DENY")).toBe("deny");
    expect(parseApproveDefault("allow-all")).toBe("allow-all");
    expect(parseApproveDefault("allow_all")).toBe("allow-all");
    expect(parseApproveDefault("AllowAll")).toBe("allow-all");
  });

  it("refuses a retired word with the word that replaced it", () => {
    expect(() => parseApproveDefault("approve")).toThrow(UsageError);
    expect(() => parseApproveDefault("approve")).toThrow('"approve" is now "allow"');
    expect(() => parseApproveDefault("Skip")).toThrow('"skip" and "reject" are now "deny"');
    expect(() => parseApproveDefault("reject")).toThrow('"skip" and "reject" are now "deny"');
    expect(() => parseApproveDefault("approve-all")).toThrow('"approve-all" is now "allow-all"');
    expect(() => parseApproveDefault("approve_all")).toThrow('"approve-all" is now "allow-all"');
  });

  it("refuses any other word as a usage error", () => {
    expect(() => parseApproveDefault("maybe")).toThrow(UsageError);
    expect(() => parseApproveDefault("maybe")).toThrow('invalid --approve-default value "maybe": must be one of: allow, deny, allow-all');
  });
});

describe("answerFor and answerWord", () => {
  it("maps each choice to its answer and names it", () => {
    expect(answerFor("allow")).toEqual({ kind: "allow" });
    expect(answerFor("allow-all")).toEqual({ kind: "grant" });
    expect(answerFor("deny")).toEqual({ kind: "deny", reason: DENY_REASON });
    expect(answerFor("")).toEqual({ kind: "deny", reason: DENY_REASON });

    expect(answerWord(answerFor("allow"))).toBe("allowed");
    expect(answerWord(answerFor("deny"))).toBe("denied");
    expect(answerWord(answerFor(""))).toBe("denied");
    expect(answerWord(answerFor("allow-all"))).toBe("allowed for the rest of the turn");
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
