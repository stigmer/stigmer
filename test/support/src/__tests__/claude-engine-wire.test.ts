// Unit arms for the shared reading of the Claude engine's requests
// (claude-engine-wire.ts), driven through a real mock over loopback.
// Domain: test support (model fakes).
//
// Pinned here: a request's conversation read structurally (user texts, the
// last tool results, every result by id, what the assistant issued, the
// headers); the router answering the engine's token counts and its
// compaction out of band, counted, never handed to the script, the
// compaction's summary in the <summary> tags the engine keeps; every other
// request handed to the script, a body or a routed answer as it says.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPACTION_PROMPT_MARK, MOCK_ENGINE_SUMMARY, MOCK_TOKEN_COUNT, claudeEngineRoute, headerOf, isCompaction, readConversation, saidByUser, type WireConversation } from "../claude-engine-wire.ts";
import { MockLlmProxy, anthropicText } from "../mock-llm.ts";

const ANTHROPIC = "/v1/proxy/llm/anthropic/v1/messages";

describe("readConversation", () => {
  it("reads the user texts, the tool results, what was issued and the headers", () => {
    const conversation = readConversation({
      path: ANTHROPIC,
      headers: { "x-stigmer-execution-id": ["run_1", "run_2"] },
      body: {
        model: "claude-x",
        system: [{ type: "text", text: "be brief" }],
        tools: [{ name: "Bash" }],
        messages: [
          { role: "user", content: "Build it." },
          { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "built" }] }, { type: "text", text: "and test it" }] },
        ],
      },
    });
    expect(conversation.model).toBe("claude-x");
    expect(conversation.system).toBe("be brief");
    expect(conversation.toolNames).toEqual(["Bash"]);
    expect(conversation.userTexts).toEqual(["Build it.", "and test it"]);
    expect(conversation.lastToolResults).toEqual([{ toolUseId: "toolu_1", text: "built", isError: false }]);
    expect([...conversation.issued]).toEqual(["toolu_1"]);
    expect(saidByUser(conversation, "test it")).toBe(true);
    expect(headerOf(conversation, "x-stigmer-execution-id"), "a repeated header's first value").toBe("run_1");
    expect(isCompaction(conversation)).toBe(false);
  });
});

describe("claudeEngineRoute", () => {
  const mock = new MockLlmProxy();
  const seen: WireConversation[] = [];
  const compacted: WireConversation[] = [];
  const engine = claudeEngineRoute((conversation) => (saidByUser(conversation, "fail") ? { error: { status: 529, body: { error: "busy" } } } : anthropicText("from the script")), {
    compactionSummary: "the summary",
    onCompaction: (conversation) => compacted.push(conversation),
    onConversation: (conversation) => seen.push(conversation),
  });

  beforeAll(async () => {
    await mock.start();
    mock.routeWith(engine.route);
  });
  afterAll(() => mock.close());

  const ask = async (path: string, content: string): Promise<Response> =>
    fetch(`${mock.url()}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages: [{ role: "user", content }] }) });

  it("answers token counts and the engine's compaction out of band, counted, and hands everything else to the script", async () => {
    expect(await (await ask(`${ANTHROPIC}/count_tokens`, "count me")).json()).toEqual({ input_tokens: MOCK_TOKEN_COUNT });
    const summary = (await (await ask(ANTHROPIC, `${COMPACTION_PROMPT_MARK}, please.`)).json()) as { content: { text: string }[]; usage: { input_tokens: number } };
    expect(summary.content[0]?.text).toContain("<summary>the summary</summary>");
    expect(summary.usage.input_tokens, "a compaction adds nothing to a run's sums").toBe(0);
    const scripted = (await (await ask(ANTHROPIC, "go")).json()) as { content: { text: string }[] };
    expect(scripted.content[0]?.text).toBe("from the script");
    expect((await ask(ANTHROPIC, "fail")).status, "a routed answer from the script as it says").toBe(529);

    expect([engine.tokenCounts(), engine.compactions()]).toEqual([1, 1]);
    expect(compacted.length).toBe(1);
    expect(seen.map((conversation) => conversation.userTexts[0]), "the script saw the loop alone").toEqual(["go", "fail"]);
    expect(mock.requests().map((request) => request.disposition)).toEqual(["out-of-band", "out-of-band", "routed", "routed"]);
  });

  it("answers a compaction with the default summary when given none", async () => {
    const plain = claudeEngineRoute(() => anthropicText("x"));
    const answer = plain.route({ path: ANTHROPIC, headers: {}, body: { messages: [{ role: "user", content: COMPACTION_PROMPT_MARK }] } });
    expect("body" in answer && answer.body.content[0]?.type === "text" ? answer.body.content[0].text : "").toContain(MOCK_ENGINE_SUMMARY);
  });
});
