/**
 * The advisory primitive: what an advisory is and where it goes.
 *
 * Pins the three facts every advising middleware leans on: an advisory is a
 * user-role message opening with the fixed lead-in (never a system message,
 * which Anthropic refuses mid-conversation, stigmer/stigmer#1354); it is
 * placed after the request's last message, one per text, in order; and a call
 * with nothing to say is handed on as the very same request, so no middleware
 * rebuilds a request it did not change. The input request is never mutated:
 * the advisory lives in the copy handed to the handler and nowhere else.
 */

import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ADVISORY_LEAD_IN, advisoryMessage, withAdvisories } from "../advisory-message.js";
import type { ModelCallRequest } from "../types.js";

function requestWith(messages: unknown[]): ModelCallRequest {
  return { model: {}, messages, state: { messages }, runtime: {} };
}

describe("advisoryMessage", () => {
  it("is a user-role message that opens with the lead-in, then the text", () => {
    const message = advisoryMessage("Wrap up now.");
    expect(HumanMessage.isInstance(message)).toBe(true);
    expect(SystemMessage.isInstance(message)).toBe(false);
    expect(message.content).toBe(`${ADVISORY_LEAD_IN}\n\nWrap up now.`);
  });
});

describe("withAdvisories", () => {
  const history = [
    new HumanMessage("go"),
    new AIMessage({ content: "", tool_calls: [{ id: "call_1", name: "read_file", args: {}, type: "tool_call" }] }),
    new ToolMessage({ content: "ok", tool_call_id: "call_1" }),
  ];

  it("hands back the very same request when there is nothing to say", () => {
    const request = requestWith(history);
    expect(withAdvisories(request, [])).toBe(request);
  });

  it("places one advisory per text after the last message, in order", () => {
    const request = requestWith(history);
    const advised = withAdvisories(request, ["first", "second"]);
    expect(advised.messages.slice(0, history.length)).toEqual(history);
    expect(advised.messages.slice(history.length).map((m) => (m as HumanMessage).content)).toEqual([
      `${ADVISORY_LEAD_IN}\n\nfirst`,
      `${ADVISORY_LEAD_IN}\n\nsecond`,
    ]);
  });

  it("leaves the input request and its state untouched", () => {
    const request = requestWith([...history]);
    withAdvisories(request, ["advice"]);
    expect(request.messages).toHaveLength(history.length);
    expect(request.state.messages).toHaveLength(history.length);
  });
});
