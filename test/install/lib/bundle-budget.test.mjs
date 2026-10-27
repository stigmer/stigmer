// Tests for test/install/lib/bundle-budget.mjs: the size budgets' arithmetic.
// Run via `node --test test/install/lib/bundle-budget.test.mjs` (wired into root `npm test`).
//
// What these pin: the eager closure of an entry's chunks, who weighs most in
// it, and each figure against its ceiling.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eagerChunks, formatBytes, heaviest, judgeBudgets, LOWER_NOTICE, ownerOf, readBudgets } from "./bundle-budget.mjs";

describe("readBudgets", () => {
  it("reads each entry's ceiling in gzip bytes", () => {
    assert.deepEqual([...readBudgets('{ "budgets": { "react-sdk/provider": 11000 } }')], [["react-sdk/provider", 11000]]);
  });

  it("refuses a file without budgets, and a ceiling that is not a positive whole number", () => {
    assert.throws(() => readBudgets("{}"), /budgets/);
    assert.throws(() => readBudgets('{ "budgets": { "a": 0 } }'), /a's budget is 0/);
    assert.throws(() => readBudgets('{ "budgets": { "a": "12 KB" } }'), /a's budget is "12 KB"/);
    assert.throws(() => readBudgets('{ "budgets": { "a": 1.5 } }'), /a's budget is 1.5/);
  });
});

describe("eagerChunks", () => {
  const chunks = [
    { file: "entry.js", isEntry: true, imports: ["chunk-a.js"], dynamicImports: ["lazy.js"] },
    { file: "chunk-a.js", isEntry: false, imports: ["chunk-b.js"] },
    { file: "chunk-b.js", isEntry: false, imports: ["chunk-a.js"] },
    { file: "lazy.js", isEntry: false, imports: ["chunk-c.js"] },
    { file: "chunk-c.js", isEntry: false, imports: [] },
  ];

  it("follows static imports from the entry, through cycles, and never a dynamic one", () => {
    assert.deepEqual([...eagerChunks(chunks)].sort(), ["chunk-a.js", "chunk-b.js", "entry.js"]);
  });

  it("refuses a bundle without exactly one entry", () => {
    assert.throws(() => eagerChunks(chunks.map((c) => ({ ...c, isEntry: false }))), /0 entry chunks/);
    assert.throws(() => eagerChunks(chunks.map((c) => ({ ...c, isEntry: true }))), /5 entry chunks/);
  });
});

describe("ownerOf", () => {
  it("counts a dependency by its package name, scoped or not, however deep", () => {
    assert.equal(ownerOf("node_modules/mermaid/dist/mermaid.core.mjs"), "mermaid");
    assert.equal(ownerOf("node_modules/@base-ui/react/esm/popover/index.js"), "@base-ui/react");
    assert.equal(ownerOf("sdk/react/node_modules/marked/lib/marked.esm.js"), "marked");
  });

  it("counts a workspace source by its package and first folder", () => {
    assert.equal(ownerOf("sdk/react/src/session/SessionViewer.tsx"), "sdk/react/src/session");
    assert.equal(ownerOf("sdk/react/src/index.ts"), "sdk/react/src");
    assert.equal(ownerOf("apis/stubs/ts/ai/stigmer/agentic/run/v1/api_pb.js"), "apis/stubs/ts/ai/stigmer/agentic/run/v1");
  });
});

describe("heaviest", () => {
  it("sums each owner's bytes across the given chunks and keeps the heaviest, ties by name", () => {
    const chunks = [
      { file: "a.js", modules: { "node_modules/mermaid/x.js": 50, "sdk/react/src/run/A.tsx": 30 } },
      { file: "b.js", modules: { "node_modules/mermaid/y.js": 20, "node_modules/marked/m.js": 30 } },
      { file: "lazy.js", modules: { "node_modules/katex/k.js": 999 } },
    ];
    assert.deepEqual(heaviest(chunks, new Set(["a.js", "b.js"]), 2), [{ owner: "mermaid", bytes: 70 }, { owner: "marked", bytes: 30 }]);
  });

  it("leaves out an owner that renders nothing", () => {
    const chunks = [{ file: "a.js", modules: { "node_modules/.cache/x/entry.mjs": 0, "node_modules/marked/m.js": 3 } }];
    assert.deepEqual(heaviest(chunks, new Set(["a.js"])), [{ owner: "marked", bytes: 3 }]);
  });
});

describe("judgeBudgets", () => {
  const budgets = new Map([["provider", 1000], ["session", 1000], ["styles", 1000]]);

  it("fails an entry over its ceiling and passes one at it", () => {
    const judged = judgeBudgets(new Map([["provider", 1001], ["session", 1000], ["styles", 1000]]), budgets);
    assert.deepEqual(judged.over, [{ entry: "provider", bytes: 1001, ceiling: 1000 }]);
    assert.deepEqual(judged.lower, []);
  });

  it(`says to lower a ceiling more than ${LOWER_NOTICE * 100}% above its figure`, () => {
    const judged = judgeBudgets(new Map([["provider", 899], ["session", 900], ["styles", 1000]]), budgets);
    assert.deepEqual(judged.lower, [{ entry: "provider", bytes: 899, ceiling: 1000 }]);
    assert.deepEqual(judged.over, []);
  });

  it("names an entry measured with no ceiling, and a ceiling nothing measured", () => {
    const judged = judgeBudgets(new Map([["provider", 10], ["embed", 10]]), new Map([["provider", 10], ["gone", 10]]));
    assert.deepEqual(judged.unbudgeted, ["embed"]);
    assert.deepEqual(judged.unmeasured, ["gone"]);
  });
});

describe("formatBytes", () => {
  it("says bytes under a kilobyte, and kilobytes to one place above", () => {
    assert.equal(formatBytes(980), "980 B");
    assert.equal(formatBytes(627_097), "612.4 KB");
  });
});
