/**
 * Unit tests for the conversation-catchup module (cloud channel-conversations
 * DD-006, T03 Sitting 3). Unlike its metadata-keyed siblings there is no
 * string key to mirror-guard — the value rides the typed
 * `AgentExecutionSpec.conversation_catchup` proto field, so codegen enforces
 * the cross-repo contract. What IS pinned here: the blank-is-absent read
 * semantics (the field is present on EVERY channel turn for its watermark
 * bookkeeping — only a non-empty digest means anything), and the framing's
 * behavioral contract.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ConversationCatchupSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";

import {
  formatConversationCatchupText,
  readConversationCatchup,
} from "../conversation-catchup.js";

const DIGEST =
  "Customer: where is my order?\n"
  + "Teammate: I've refunded you in full.\n"
  + "You escalated: refund beyond policy";

describe("readConversationCatchup", () => {
  it("reads a non-empty digest", () => {
    const catchup = create(ConversationCatchupSchema, { digest: DIGEST });
    expect(readConversationCatchup(catchup)).toBe(DIGEST);
  });

  it("answers undefined when the field is absent", () => {
    expect(readConversationCatchup(undefined)).toBeUndefined();
  });

  it("a blank digest is no catchup — window_end alone is cloud bookkeeping, never a reason to inject", () => {
    // A21: the field rides EVERY channel turn so the watermark can advance;
    // most turns carry an empty digest. The runner must render nothing.
    const catchup = create(ConversationCatchupSchema, {
      digest: "   ",
      windowEnd: create(TimestampSchema, { seconds: 1_775_000_000n }),
    });
    expect(readConversationCatchup(catchup)).toBeUndefined();
  });
});

describe("formatConversationCatchupText", () => {
  const framed = formatConversationCatchupText(DIGEST);

  it("frames the digest as known history the agent must not answer or announce", () => {
    expect(framed).toContain("you have not seen");
    expect(framed).toContain("do not answer or re-answer");
    expect(framed).toContain("do not repeat or summarize them back");
    expect(framed).toContain("Continue from the customer's newest message.");
  });

  it("defines the send-status annotations — undelivered words are not settled history (cloud#347)", () => {
    // The cloud composer marks lines the customer never got or may not
    // have gotten yet; the preamble must define both annotations and
    // carve them out of the don't-re-answer contract, or the agent would
    // silently abandon whatever a failed teammate reply meant to convey.
    expect(framed).toContain("(not delivered)");
    expect(framed).toContain("never reached the customer");
    expect(framed).toContain("(sending)");
    expect(framed).toContain("still on their way");
    expect(framed).toContain("weigh that when deciding what still needs saying");
  });

  it("asserts no takeover — a digest can exist with no human handoff at all (the A15/A20 honesty bar)", () => {
    // The preamble may DESCRIBE what the digest can contain ("may include"),
    // but must never state that a handoff happened on THIS conversation: a
    // failed turn's re-composed window has no teammate in it anywhere.
    expect(framed).toContain("may include");
    expect(framed).not.toContain("stepped in");
    expect(framed).not.toContain("took over");
  });

  it("ends with the digest — the preamble precedes, nothing trails", () => {
    expect(framed.endsWith(DIGEST)).toBe(true);
  });
});
