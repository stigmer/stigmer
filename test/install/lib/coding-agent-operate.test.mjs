// Holds the operate walk's judge (lib/coding-agent-operate.mjs): the right
// state passes; no service account or two, an Admin or Viewer role, a key
// saved to no file, a key in the file that is not the account's, a key in
// the coding agent's stream, a key of the person's own, and a changed or
// deleted agent each fail, naming what is wrong; the saved-key line is read
// in its text and JSON forms; the docs' example key is not a key; and the
// flags refuse what they do not know.

import assert from "node:assert/strict";
import { test } from "node:test";

import { OPERATE, judgeOperate, keyInEnvFile, keysIn, parseOperateArgs, savedKeyFile, streamText } from "./coding-agent-operate.mjs";

const KEY = `stk_${"A1b2C3d4E5".repeat(4)}xyz`;
const agents = () => Object.fromEntries(OPERATE.agents.map((agent) => [agent, { spec: { instructions: `${agent}'s instructions` } }]));
const before = { myKeys: ["key_mine"], agents: agents() };

function rightState() {
  return {
    serviceAccounts: [{ name: "ci-nightly", role: "member", keys: ["key_ci"] }],
    myKeys: ["key_mine"],
    agents: agents(),
    saved: { file: ".env.ci", rawKey: KEY, keyId: "key_ci" },
    stream: "API key created and saved as STIGMER_API_KEY in .env.ci\nKeep .env.ci out of git; the key is shown nowhere else.",
  };
}

function failsWith(change, pattern) {
  const state = rightState();
  change(state);
  const failed = judgeOperate(before, state);
  assert.ok(failed.some((line) => pattern.test(line)), `expected a failure matching ${pattern}, got ${JSON.stringify(failed)}`);
}

test("the right state passes", () => {
  assert.deepEqual(judgeOperate(before, rightState()), []);
});

test("one service account, with the member role and one key", () => {
  failsWith((s) => (s.serviceAccounts = []), /0 service accounts/);
  failsWith((s) => s.serviceAccounts.push({ name: "ci-2", role: "member", keys: [] }), /2 service accounts/);
  failsWith((s) => (s.serviceAccounts[0].role = "admin"), /holds "admin", not the member role/);
  failsWith((s) => (s.serviceAccounts[0].role = "viewer"), /holds "viewer"/);
  failsWith((s) => (s.serviceAccounts[0].keys = ["key_ci", "key_ci2"]), /has 2 keys/);
});

test("the key is saved to a file, and it is the service account's", () => {
  failsWith((s) => (s.saved = { file: undefined, rawKey: undefined, keyId: undefined }), /never said it saved a key/);
  failsWith((s) => (s.saved.keyId = undefined), /holds no key the server knows/);
  failsWith((s) => (s.saved.keyId = "key_mine"), /is not service account ci-nightly's/);
});

test("no key in the coding agent's stream", () => {
  failsWith((s) => (s.stream += `\nexport STIGMER_API_KEY=${KEY}`), /a key appears/);
  failsWith((s) => {
    s.saved.rawKey = "not-key-shaped-but-saved";
    s.stream += "\nnot-key-shaped-but-saved";
  }, /the saved key appears/);
});

test("the person's own keys and the agents stay as they were", () => {
  failsWith((s) => s.myKeys.push("key_new_mine"), /the person's own keys changed/);
  failsWith((s) => (s.agents[OPERATE.agents[0]] = { spec: { instructions: "rewritten" } }), new RegExp(`${OPERATE.agents[0]} changed`));
  failsWith((s) => (s.agents[OPERATE.agents[1]] = undefined), new RegExp(`${OPERATE.agents[1]} is gone`));
});

test("the saved-key line is read in its text and JSON forms, the last one winning", () => {
  assert.equal(savedKeyFile("API key created and saved as STIGMER_API_KEY in .env.ci\n"), ".env.ci");
  assert.equal(savedKeyFile('{\n  "id": "key_1",\n  "envFile": "ci/.env",\n  "variable": "STIGMER_API_KEY"\n}'), "ci/.env");
  assert.equal(savedKeyFile("API key created and saved as STIGMER_API_KEY in a.env\nAPI key created and saved as STIGMER_API_KEY in b.env"), "b.env");
  assert.equal(savedKeyFile("API key created: stk_…"), undefined);
});

test("an env file's key is its last STIGMER_API_KEY line", () => {
  assert.equal(keyInEnvFile(`OTHER=1\nSTIGMER_API_KEY=${KEY}\n`), KEY);
  assert.equal(keyInEnvFile(`STIGMER_API_KEY="old"\nSTIGMER_API_KEY='${KEY}'\n`), KEY);
  assert.equal(keyInEnvFile("OTHER=1\n"), undefined);
});

test("a key is a whole key's shape; placeholders and the docs' example are not", () => {
  assert.deepEqual(keysIn(`key: ${KEY}.`), [KEY]);
  assert.deepEqual(keysIn("stk_your_api_key stk_... stk_live_0123456789abcdefghij"), []);
  assert.deepEqual(keysIn("stk_docs-example-key-for-ci-deploy0000000000000"), []);
});

test("the stream's text is every string in its lines", () => {
  const jsonl = [
    JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Proposing ci-nightly" }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "API key created and saved as STIGMER_API_KEY in .env.ci" }] } }),
    "",
  ].join("\n");
  const text = streamText(jsonl);
  assert.match(text, /Proposing ci-nightly/);
  assert.equal(savedKeyFile(text), ".env.ci");
});

test("the flags refuse what they do not know", () => {
  assert.equal(parseOperateArgs(["--max-turns=3"]).maxTurns, 3);
  assert.throws(() => parseOperateArgs(["--max-turns=0"]), /positive number/);
  assert.throws(() => parseOperateArgs(["--app=x"]), /unknown flag/);
});
