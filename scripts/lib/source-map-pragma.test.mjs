// Pins the slim packages' source-map rule: an external .map reference is
// stripped (the package ships no maps); an inlined map is kept (Temporal's
// workflow bundles need it to start a worker). Run via
// `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { test } from "node:test";

import { stripExternalSourceMapPragma } from "./source-map-pragma.mjs";

test("strips a trailing pragma that points at an external .map file", () => {
  const code = 'console.log("main");\n//# sourceMappingURL=main.js.map\n';
  assert.equal(stripExternalSourceMapPragma(code), 'console.log("main");\n');
});

test("keeps a trailing pragma whose map is inlined as a data URL", () => {
  const inline = "\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==";
  const code = `__TEMPORAL__ = exports;${inline}`;
  assert.equal(stripExternalSourceMapPragma(code), code);
});

test("leaves code without a pragma untouched", () => {
  const code = "module.exports = 1;\n";
  assert.equal(stripExternalSourceMapPragma(code), code);
});

test("strips only the trailing pragma, never one quoted inside the code", () => {
  const code = 'const s = "//# sourceMappingURL=x.map";\nrun(s);\n//# sourceMappingURL=out.js.map\n';
  assert.equal(stripExternalSourceMapPragma(code), 'const s = "//# sourceMappingURL=x.map";\nrun(s);\n');
});
