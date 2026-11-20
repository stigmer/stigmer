// Holds the app walk's pure parts (lib/coding-agent-app.mjs): each app's
// agent is known to the fake model by a phrase its instructions alone carry,
// the model's script saves the report on a run's first step and answers on
// the next, every entry standing for every run; the flags refuse an unknown
// app; and a key is found in any file that holds it.

import assert from "node:assert/strict";
import { test } from "node:test";

import { APPS, agentManifest, appScript, filesHoldingKey, parseAppArgs, reportLine } from "./coding-agent-app.mjs";

const wire = {
  isTitleCall: (request) => request.title === true,
  anthropicText: (text) => ({ text }),
  anthropicToolUse: (id, name, input) => ({ id, name, input }),
};

test("each app's mark is in its agent's instructions and in no other app's", () => {
  for (const [name, app] of Object.entries(APPS)) {
    assert.ok(app.instructions.includes(app.mark), name);
    for (const [other, otherApp] of Object.entries(APPS)) {
      if (other !== name) assert.ok(!otherApp.instructions.includes(app.mark), `${other} carries ${name}'s mark`);
    }
    assert.match(agentManifest(name), new RegExp(`name: ${app.agent}\\n`));
    assert.ok(agentManifest(name).includes(app.mark));
  }
});

test("the script saves the report first, answers after the tool result, and repeats", () => {
  for (const name of Object.keys(APPS)) {
    const script = appScript(name, wire);
    assert.ok(script.every((entry) => entry.repeat === true));
    const first = { body: { system: APPS[name].instructions, messages: [{ role: "user", content: "check" }] } };
    const after = { body: { system: APPS[name].instructions, messages: [{ role: "user", content: [{ type: "tool_result" }] }] } };
    const other = { body: { system: "Some other agent.", messages: [] } };
    const answering = (request) => script.filter((entry) => entry.matches(request));
    assert.deepEqual(answering(first).map((entry) => entry.body.name), ["write_file"]);
    assert.equal(answering(first)[0].body.input.file_path, "/.stigmer/outputs/report.md");
    assert.equal(answering(first)[0].body.input.content, APPS[name].report);
    assert.deepEqual(answering(after).map((entry) => entry.body.text), [APPS[name].reply]);
    assert.deepEqual(answering(other), []);
    assert.equal(answering({ title: true, body: {} }).length, 1);
    assert.ok(APPS[name].report.startsWith(reportLine(name)));
  }
});

test("the flags take an app and the bounds, and refuse anything else", () => {
  assert.deepEqual(parseAppArgs(["--app=statements-fastapi", "--keep", "--max-turns=3", "--max-budget-usd=4"]), {
    app: "statements-fastapi",
    model: "claude-sonnet-5-5",
    maxBudgetUsd: 4,
    claudeMaxTurns: undefined,
    maxTurns: 3,
    keep: true,
    help: false,
  });
  assert.throws(() => parseAppArgs([]), /--app must be one of ledgerly-nextjs, statements-fastapi/);
  assert.throws(() => parseAppArgs(["--app=rails"]), /--app must be one of/);
  assert.throws(() => parseAppArgs(["--app=ledgerly-nextjs", "--max-turns=0"]), /--max-turns must be a positive number/);
  assert.throws(() => parseAppArgs(["--app=ledgerly-nextjs", "--fast"]), /unknown flag "--fast"/);
  assert.equal(parseAppArgs(["--help"]).help, true);
});

test("a key is found in every file that holds it, and an unreadable one is passed over", () => {
  const texts = { "app/main.py": "KEY = 'stk_live_123456789'", "README.md": "Run it.", gone: undefined };
  assert.deepEqual(filesHoldingKey(Object.keys(texts), (path) => texts[path], "stk_live_123456789"), ["app/main.py"]);
});
