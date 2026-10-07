// Pins the TypeScript pass of a contract rename on a small real project the
// repository's own compiler checks: a consumer written against the old
// contract compiles against the renamed one after the pass, and every edit
// is one the compiler asked for. An engine key spelled like a renamed field
// (an untyped JSON read, a Temporal payload literal) is left byte for byte,
// a shorthand keeps its local name, an import from a moved folder follows
// the folder, and a name the table does not know stays a reported
// diagnostic. Run via `node --test scripts/lib/*.test.mjs`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { applyEdits, renamedSpecifier, runRenamePass, runTypeScriptPass } from "./contract-rename-ts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const TABLE = {
  ts: {
    identifiers: {
      AgentRun: "Run",
      AgentRunSchema: "RunSchema",
      agentRunId: "runId",
      agent_run: "run",
      listRuns: "listFires",
    },
    modules: { "ai/x/agentrun/v1/api_pb": "ai/x/run/v1/api_pb" },
  },
};

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "contract-rename-ts-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    noEmit: true,
    baseUrl: ".",
    paths: { "@contract/*": ["contract/*"] },
  },
  include: ["src/**/*.ts", "contract/**/*.ts"],
});

const CONTRACT = `
export type Run = { runId: string; note: string; target: { case: "runId"; value: string } | { case: undefined; value?: undefined } };
export const RunSchema = { typeName: "ai.x.run.v1.Run" } as const;
export enum Kind { run = 41, session = 42 }
export const Query = { listFires: (id: string): Run[] => [] };
`;

test("a consumer of the old contract compiles against the new one, and engine keys stay", () => {
  const dir = project({
    "tsconfig.json": TSCONFIG,
    "contract/ai/x/run/v1/api_pb.ts": CONTRACT,
    "src/domain/run/helper.ts": `export const helper = 1;\n`,
    "src/use.ts": `import { type AgentRun, AgentRunSchema, Kind, Query } from "@contract/ai/x/agentrun/v1/api_pb";
import { helper } from "./domain/agentrun/helper";

export function make(agentRunId: string): AgentRun {
  return { agentRunId, note: "n", target: { case: "agentRunId", value: agentRunId } };
}
export function read(run: AgentRun): string {
  const { agentRunId } = run;
  return agentRunId + run.agentRunId + String(Kind.agent_run) + AgentRunSchema.typeName + helper;
}
export function withSpread(flag: boolean, agentRunId: string): AgentRun {
  return { agentRunId, note: "n", target: { case: undefined }, ...(flag ? { note: "m" } : {}) };
}
export function list(): number {
  return Query.listRuns("x").length;
}
const enginePayload = JSON.parse("{}") as { agentRunId?: string };
export const engineKey = enginePayload.agentRunId ?? "agentRunId";
export const temporalName = "agent-execution";
`,
  });
  try {
    const result = runTypeScriptPass({
      tsconfig: join(dir, "tsconfig.json"),
      table: TABLE,
      moves: { [join(dir, "src/domain/agentrun")]: join(dir, "src/domain/run") },
      rootDir: ROOT,
    });
    assert.deepEqual(result.remaining, [], "nothing is left for a person");
    assert.ok(result.rounds >= 2, "an import is renamed first, its uses the round after");
    const after = readFileSync(join(dir, "src/use.ts"), "utf8");
    assert.match(after, /import \{ type Run, RunSchema, Kind, Query \} from "@contract\/ai\/x\/run\/v1\/api_pb";/);
    assert.match(after, /from "\.\/domain\/run\/helper";/, "the moved folder's import follows it");
    assert.match(after, /export function make\(agentRunId: string\): Run \{/, "a parameter keeps its local name");
    assert.match(after, /return \{ runId: agentRunId, note: "n", target: \{ case: "runId", value: agentRunId \} \};/);
    assert.match(after, /const \{ runId: agentRunId \} = run;/, "a binding keeps its local name");
    assert.match(after, /run\.runId \+ String\(Kind\.run\) \+ RunSchema\.typeName/);
    assert.match(after, /Query\.listFires\("x"\)/);
    assert.match(
      after,
      /return \{ runId: agentRunId, note: "n", target: \{ case: undefined \}, \.\.\.\(flag/,
      "an excess key reported on the whole literal",
    );
    assert.match(after, /enginePayload\.agentRunId \?\? "agentRunId"/, "an engine key the compiler never flags stays");
    assert.match(after, /as \{ agentRunId\?: string \}/);
    assert.match(after, /"agent-execution"/);
    const again = runTypeScriptPass({ tsconfig: join(dir, "tsconfig.json"), table: TABLE, rootDir: ROOT });
    assert.equal(again.edited.length, 0, "a second run changes nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a name the table does not know is reported, and a generated tree is never edited", () => {
  const dir = project({
    "tsconfig.json": TSCONFIG,
    "contract/ai/x/run/v1/api_pb.ts": CONTRACT,
    "contract/gen/client.ts": `import type { AgentRun } from "../ai/x/run/v1/api_pb";\nexport type C = AgentRun;\n`,
    "src/use.ts": `import { Kind } from "@contract/ai/x/run/v1/api_pb";\nexport const k = Kind.workflow_run;\n`,
    "src/proto.ts": `import { valueOf } from "@contract/ai/x/run/v1/api_pb";\nexport const v = valueOf;\n`,
  });
  try {
    const result = runTypeScriptPass({
      tsconfig: join(dir, "tsconfig.json"),
      table: TABLE,
      exclude: ["contract/gen/"],
      rootDir: ROOT,
    });
    assert.equal(result.edited.length, 0);
    assert.ok(
      result.remaining.some((r) => /use\.ts:2:\d+ TS2339 .*workflow_run/.test(r)),
      result.remaining.join("\n"),
    );
    assert.ok(
      result.remaining.some((r) => /client\.ts:1:\d+ TS2305/.test(r)),
      result.remaining.join("\n"),
    );
    assert.ok(
      result.remaining.some((r) => /proto\.ts:1:\d+ TS2305 .*valueOf/.test(r)),
      "a name spelled like an Object.prototype member is not in the table",
    );
    assert.match(readFileSync(join(dir, "contract/gen/client.ts"), "utf8"), /AgentRun/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("module specifiers follow the table's modules and moved folders, with or without .js", () => {
  const modules = TABLE.ts.modules;
  assert.equal(renamedSpecifier("@p/ai/x/agentrun/v1/api_pb", "/r/src/a.ts", modules, {}), "@p/ai/x/run/v1/api_pb");
  assert.equal(
    renamedSpecifier("@p/ai/x/agentrun/v1/api_pb.js", "/r/src/a.ts", modules, {}),
    "@p/ai/x/run/v1/api_pb.js",
  );
  assert.equal(renamedSpecifier("@p/ai/x/session/v1/api_pb", "/r/src/a.ts", modules, {}), undefined);
  const moves = { "/r/src/domain/agentrun": "/r/src/domain/run" };
  assert.equal(renamedSpecifier("../domain/agentrun/x.js", "/r/src/boot/a.ts", modules, moves), "../domain/run/x.js");
  assert.equal(renamedSpecifier("./agentrun/x.js", "/r/src/domain/a.ts", modules, moves), "./run/x.js");
  assert.equal(
    renamedSpecifier("./agentrunner.js", "/r/src/domain/a.ts", modules, moves),
    undefined,
    "a prefix of a name is not the folder",
  );
});

test("edits apply last first, and an overlapping or repeated edit keeps the first", () => {
  const { text, applied } = applyEdits("aaa bbb ccc", [
    { start: 4, end: 7, text: "BBB" },
    { start: 0, end: 3, text: "A" },
    { start: 4, end: 7, text: "XXX" },
    { start: 5, end: 6, text: "Y" },
  ]);
  assert.equal(text, "A BBB ccc");
  assert.equal(applied, 2);
});

test("a hand name is renamed with its references, implementations, re-exports and shorthand keys", () => {
  const dir = project({
    "tsconfig.json": TSCONFIG,
    "src/plain.ts": `export function valueOf(label: string): string {\n  return label;\n}\n`,
    "src/store.ts": `export interface Store {
  upsertScheduleRun(id: string): void;
}
export class MemoryStore implements Store {
  upsertScheduleRun(id: string): void {
    void id;
  }
}
export const literalStore: Store = { upsertScheduleRun: (id) => void id };
`,
    "src/hook.ts": `import type { Store } from "./store";
export function useScheduleRuns(store: Store): void {
  store.upsertScheduleRun("x");
}
export const hooks = { useScheduleRuns };
export const upsertScheduleRun = "a local spelled like the method, not a reference";
`,
    "src/index.ts": `export { useScheduleRuns } from "./hook";\n`,
    "src/use.ts": `import { useScheduleRuns } from "./hook";
import { MemoryStore } from "./store";
useScheduleRuns(new MemoryStore());
`,
  });
  try {
    const result = runRenamePass({
      tsconfig: join(dir, "tsconfig.json"),
      names: { upsertScheduleRun: "upsertScheduleFire", useScheduleRuns: "useScheduleFires" },
      rootDir: ROOT,
    });
    assert.equal(result.edited.length, 4, "a declaration spelled like an Object.prototype member is no hand name");
    assert.equal(
      readFileSync(join(dir, "src/plain.ts"), "utf8"),
      "export function valueOf(label: string): string {\n  return label;\n}\n",
    );
    const store = readFileSync(join(dir, "src/store.ts"), "utf8");
    assert.equal(
      (store.match(/upsertScheduleFire/g) ?? []).length,
      3,
      "the member, its implementation and the literal",
    );
    const hook = readFileSync(join(dir, "src/hook.ts"), "utf8");
    assert.match(hook, /export function useScheduleFires\(store: Store\)/);
    assert.match(hook, /store\.upsertScheduleFire\("x"\)/);
    assert.match(hook, /export const hooks = \{ useScheduleFires \};/, "a shorthand key follows");
    assert.equal(
      readFileSync(join(dir, "src/index.ts"), "utf8"),
      'export { useScheduleFires } from "./hook";\n',
      "a re-export follows",
    );
    assert.match(
      hook,
      /export const upsertScheduleFire = "a local spelled like the method/,
      "a declaration of the name is renamed too",
    );
    assert.match(
      readFileSync(join(dir, "src/use.ts"), "utf8"),
      /import \{ useScheduleFires \} from "\.\/hook";\nimport \{ MemoryStore \} from "\.\/store";\nuseScheduleFires\(/,
    );
    const check = runTypeScriptPass({ tsconfig: join(dir, "tsconfig.json"), table: TABLE, rootDir: ROOT });
    assert.deepEqual(check.remaining, [], "the renamed project compiles");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
