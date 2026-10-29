// Unit arms for the engine arms (support/engine-arms.ts): one scripted turn
// as each engine's model says it, driven through a real mock over loopback
// with no runner.
// Domain: conformance support (execution engine).
//
// Pinned here: the Stigmer harness's arm queues each step as one model call under
// the Stigmer harness's tool names, a batch as one call; Claude's arm answers each request
// from its conversation, under the names the platform's vocabulary maps
// the Stigmer harness's to, with Claude's input shapes (paths in the engine's workspace,
// the shell's bound in milliseconds), plays a batch's unsettled calls, asks
// again for a call the engine handed back interrupted, keys a turn by the
// task its user carries (the newest one), keeps the task and what is done
// through a compaction's summary, sizes its usage when asked and refuses a
// request past the model's window as the API does; a Claude block skips,
// naming why, where the target runs no Claude turn.
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { COMPACTION_PROMPT_MARK, readConversation } from "@stigmer/test-support/claude-engine-wire";
import { MockLlmProxy, type AnthropicMessageBody } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { CLAUDE_ARM, CLAUDE_TURNS_SKIP_REASON, STIGMER_ARM, claudeArm, claudeTurnsOnly, claudeWorkspaceOf, engineArms } from "../engine-arms";

const mock = new MockLlmProxy();
const ANTHROPIC = "/v1/proxy/llm/anthropic/v1/messages";
const WORKSPACE = "/work/ses_1";
const ENVIRONMENT = `<env>\n - Primary working directory: ${WORKSPACE}\n</env>`;

beforeAll(() => mock.start());
afterEach(() => mock.reset());
afterAll(() => mock.close());

type Message = { readonly role: "user" | "assistant"; readonly content: unknown };

/** One request to the mock with `messages`; its answer. */
async function ask(messages: readonly Message[]): Promise<{ status: number; body: AnthropicMessageBody }> {
  const response = await fetch(`${mock.url()}${ANTHROPIC}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "m", messages }) });
  return { status: response.status, body: (await response.json()) as AnthropicMessageBody };
}

const user = (...texts: string[]): Message => ({ role: "user", content: texts.map((text) => ({ type: "text", text })) });
const result = (id: string, text: string, isError = false): Message => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text, is_error: isError }] });
const called = (body: AnthropicMessageBody): unknown[] => body.content.filter((block) => block.type === "tool_use").map((block) => (block.type === "tool_use" ? [block.id, block.name, block.input] : []));
const said = (body: AnthropicMessageBody): string[] => body.content.flatMap((block) => (block.type === "text" ? [block.text] : []));

describe("engineArms and claudeTurnsOnly", () => {
  it("lists Stigmer, and Claude only where the target runs Claude turns; a Claude block skips elsewhere, naming why", () => {
    expect(engineArms({ claudeTurnsRun: true }).map((arm) => arm.word)).toEqual(["stigmer", "claude"]);
    expect(engineArms({ claudeTurnsRun: false }).map((arm) => arm.word)).toEqual(["stigmer"]);
    expect([STIGMER_ARM.harness, CLAUDE_ARM.harness]).toEqual([undefined, Harness.CLAUDE]);
    const skipped: (string | undefined)[] = [];
    claudeTurnsOnly({ claudeTurnsRun: false })({ skip: (note) => void skipped.push(note) });
    claudeTurnsOnly({ claudeTurnsRun: true })({ skip: (note) => void skipped.push(note) });
    expect(skipped).toEqual([CLAUDE_TURNS_SKIP_REASON]);
  });
});

describe("the Stigmer arm", () => {
  it("queues each step as one model call under the Stigmer harness's names, a batch as one call, then the closing text", async () => {
    STIGMER_ARM.script(mock, "the task", [
      { kind: "shell", id: "c1", command: "make", timeoutSeconds: 700 },
      { kind: "write", id: "c2", path: "/a.txt", content: "x" },
      { kind: "edit", id: "c3", path: "/a.txt", oldString: "x", newString: "y" },
      { kind: "read", id: "c4", path: "/a.txt" },
      { kind: "delegate", id: "c5", agent: "helper", prompt: "do it" },
      { kind: "batch", calls: [{ kind: "shell", id: "c6", command: "ls" }, { kind: "call", id: "c7", name: "remember", input: { fact: "f" } }] },
      { kind: "text", text: "Done." },
    ]);
    const answers: unknown[] = [];
    for (let i = 0; i < 6; i += 1) answers.push(called((await ask([user("the task")])).body));
    expect(answers).toEqual([
      [["c1", "execute", { command: "make", timeout: 700 }]],
      [["c2", "write_file", { file_path: "/a.txt", content: "x" }]],
      [["c3", "edit_file", { file_path: "/a.txt", old_string: "x", new_string: "y" }]],
      [["c4", "read_file", { file_path: "/a.txt" }]],
      [["c5", "task", { description: "do it", subagent_type: "helper" }]],
      [["c6", "execute", { command: "ls" }], ["c7", "remember", { fact: "f" }]],
    ]);
    expect(said((await ask([user("the task")])).body)).toEqual(["Done."]);
    expect([STIGMER_ARM.loopRequests(mock).length, STIGMER_ARM.compactions(mock)]).toEqual([7, 0]);
  });
});

describe("the Claude arm", () => {
  it("plays the first step the conversation does not show settled, under Claude's names and input shapes", async () => {
    CLAUDE_ARM.script(mock, "Build it", [
      { kind: "shell", id: "c1", command: "make", timeoutSeconds: 700 },
      { kind: "write", id: "c2", path: "notes.md", content: "x" },
      { kind: "edit", id: "c3", path: "/abs/notes.md", oldString: "x", newString: "y" },
      { kind: "read", id: "c4", path: "notes.md" },
      { kind: "delegate", id: "c5", agent: "helper", prompt: "do it" },
      { kind: "text", text: "Built." },
    ]);
    const history: Message[] = [user(ENVIRONMENT, "Build it")];
    const plays: unknown[] = [];
    for (const id of ["c1", "c2", "c3", "c4", "c5"]) {
      const { body } = await ask(history);
      plays.push(...called(body));
      history.push({ role: "assistant", content: body.content }, result(id, "ok"));
    }
    expect(plays).toEqual([
      ["c1", "Bash", { command: "make", description: "the scripted step", timeout: 700_000 }],
      ["c2", "Write", { file_path: `${WORKSPACE}/notes.md`, content: "x" }],
      ["c3", "Edit", { file_path: "/abs/notes.md", old_string: "x", new_string: "y" }],
      ["c4", "Read", { file_path: `${WORKSPACE}/notes.md` }],
      ["c5", "Agent", { description: "the scripted delegation", prompt: "do it", subagent_type: "helper" }],
    ]);
    const closing = (await ask(history)).body;
    expect([said(closing), closing.stop_reason, closing.usage.input_tokens]).toEqual([["Built."], "end_turn", 10]);
    expect(CLAUDE_ARM.loopRequests(mock).length).toBe(6);
  });

  it("plays a batch whole, then its calls still unsettled; text before a call rides with it", async () => {
    CLAUDE_ARM.script(mock, "Clean up", [
      { kind: "text", text: "Cleaning." },
      { kind: "batch", calls: [{ kind: "call", id: "g1", name: "Glob", input: { pattern: "*" } }, { kind: "shell", id: "s1", command: "rm x" }] },
      { kind: "text", text: "Clean." },
    ]);
    const first = (await ask([user(ENVIRONMENT, "Clean up")])).body;
    expect([said(first), called(first).map((call) => (call as unknown[])[0])]).toEqual([["Cleaning."], ["g1", "s1"]]);
    const again = (await ask([user(ENVIRONMENT, "Clean up"), { role: "assistant", content: first.content }, result("g1", "a.txt")])).body;
    expect(called(again).map((call) => (call as unknown[])[0]), "the call still unsettled, alone").toEqual(["s1"]);
  });

  it("asks again, under a new id, for a call the engine handed back interrupted, and moves on once the repeat settles", async () => {
    const arm = claudeArm();
    arm.script(mock, "Migrate", [{ kind: "shell", id: "k1", command: "migrate", retryInterrupted: true }, { kind: "shell", id: "k2", command: "check" }]);
    const interrupted = result("k1", "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown.]", true);
    const repeat = (await ask([user(ENVIRONMENT, "Migrate"), interrupted])).body;
    expect(called(repeat).map((call) => (call as unknown[])[0])).toEqual(["k1_again"]);
    const next = (await ask([user(ENVIRONMENT, "Migrate"), interrupted, result("k1_again", "migrated")])).body;
    expect(called(next).map((call) => (call as unknown[])[0])).toEqual(["k2"]);
  });

  it("takes an interrupted result as the call's end for a step that does not ask again, and moves on", async () => {
    const arm = claudeArm();
    arm.script(mock, "Hold on", [{ kind: "shell", id: "h1", command: "hold" }, { kind: "text", text: "Moved on." }]);
    const interrupted = result("h1", "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown.]", true);
    expect(said((await ask([user(ENVIRONMENT, "Hold on"), interrupted])).body), "never the same call again").toEqual(["Moved on."]);
  });

  it("keys a turn by the newest task its user carries, and refuses a conversation it has no turn for", async () => {
    CLAUDE_ARM.script(mock, "first task", [{ kind: "text", text: "first done" }]);
    CLAUDE_ARM.script(mock, "second task", [{ kind: "text", text: "second done" }]);
    expect(said((await ask([user(ENVIRONMENT, "first task"), user("second task")])).body)).toEqual(["second done"]);
    expect(said((await ask([user(ENVIRONMENT, "first task"), user("a message mid-turn")])).body), "a later text that is no task keeps the turn").toEqual(["first done"]);
    expect((await ask([user("nobody scripted this")])).status).toBe(500);
  });

  it("keeps the task and the calls done through a compaction, so the turn plays on from its summary; sized usage stands for the request", async () => {
    const arm = claudeArm({ usage: "sized" });
    arm.script(mock, "Long work", [{ kind: "shell", id: "b1", command: "one" }, { kind: "shell", id: "b2", command: "two" }, { kind: "text", text: "All done." }]);
    const before = [user(ENVIRONMENT, "Long work"), result("b1", "x".repeat(4_000))];
    const sized = (await ask(before)).body;
    expect(sized.usage.input_tokens, "about four characters a token").toBeGreaterThan(1_000);
    const summary = (await ask([...before, user(`${COMPACTION_PROMPT_MARK}.`)])).body;
    const kept = said(summary)[0] ?? "";
    expect(kept).toContain("Task: Long work");
    expect(kept).toContain("Done so far: b1");
    expect(arm.compactions(mock)).toBe(1);
    const after = (await ask([user(`This session is being continued. ${kept}`, ENVIRONMENT)])).body;
    expect(called(after).map((call) => (call as unknown[])[0]), "b1 is done by the summary; b2 is next").toEqual(["b2"]);
  });

  it("summarizes a conversation it has no turn for without naming one", async () => {
    const arm = claudeArm();
    arm.script(mock, "Some task", [{ kind: "text", text: "x" }]);
    const summary = said((await ask([user("an unscripted conversation"), user(`${COMPACTION_PROMPT_MARK}.`)])).body)[0] ?? "";
    expect(summary).toContain("The conversation so far, condensed.");
    expect(summary).not.toContain("Task:");
  });

  it("refuses a request past the model's window as the API does, with sized usage", async () => {
    const arm = claudeArm({ usage: "sized", windowTokens: 1_000 });
    arm.script(mock, "Big read", [{ kind: "text", text: "Read." }]);
    expect((await ask([user(ENVIRONMENT, "Big read")])).status, "a request that fits").toBe(200);
    const refused = await ask([user(ENVIRONMENT, "Big read"), result("r1", "y".repeat(8_000))]);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.body)).toMatch(/prompt is too long: \d+ tokens > 1000 maximum/);
  });

  it("names the workspace from the environment block, and refuses to place a path without one", () => {
    const conversation = (text: string) => readConversation({ path: ANTHROPIC, headers: {}, body: { messages: [user(text)] } });
    expect(claudeWorkspaceOf(conversation(ENVIRONMENT))).toBe(WORKSPACE);
    expect(() => claudeWorkspaceOf(conversation("no environment here"))).toThrow(/names no working directory/);
  });
});
