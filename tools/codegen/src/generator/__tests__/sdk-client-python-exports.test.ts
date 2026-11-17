/**
 * Pins the generated export region of the Python SDK's handwritten
 * `stigmer/__init__.py`: the generator rewrites only the text between its two
 * marker lines, with every resource's client and inputs as explicit imports
 * and a literal `__all__ += [...]` (the one form mypy reads as exports), and
 * none of the internals `stigmer._gen` also lists. Text outside the markers
 * comes back byte for byte, a second run writes the same bytes, and a package
 * init without its markers fails before anything is generated.
 *
 * The generator runs over the real schemas into a temporary package laid out
 * like the SDK's (`<pkg>/__init__.py` beside `<pkg>/_gen`).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PY_EXPORTS_BEGIN, PY_EXPORTS_END, runSDKClientPythonGeneration } from "../sdk-client-python.js";
import { runGenerationTarget } from "../targets.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");
const APIS = path.resolve(__dirname, "../../../../../apis");

const HEAD = '"""A package."""\n\nfrom ._client import StigmerClient\n\n__all__ = ["StigmerClient"]\n\n';
const TAIL = "\n# A line the author keeps after the region.\n";
// stigmer._gen lists these beside the resources: its internals, which the
// package never exports, and the shared types and errors the handwritten
// part of __init__.py exports itself.
const INTERNALS = ["GeneratedClient", "BidiStream", "wrap_error", "is_unimplemented"];
const HAND_EXPORTED = ["DeleteResourceInput", "ResourceRef", "ErrorCode", "StigmerError", "is_not_found", "is_permission_denied", "is_retryable", "is_unauthenticated"];

/** The quoted names of a literal list opened by `opener` (one per line). */
function listedNames(source: string, opener: string): string[] {
  const start = source.indexOf(opener);
  expect(start).toBeGreaterThanOrEqual(0);
  const body = source.slice(start + opener.length, source.indexOf("\n]", start));
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const m = /^"([A-Za-z_][A-Za-z0-9_]*)",$/.exec(line);
      expect(m, `not a literal list entry: ${line}`).not.toBeNull();
      return m![1];
    });
}

/** The names the region's `from ._gen._<resource> import ...` lines import. */
function importedNames(region: string): string[] {
  const names: string[] = [];
  for (const m of region.matchAll(/^from \._gen\._\w+ import (?:\(\n((?: {4}\w+,\n)+)\)|([\w, ]+))$/gm)) {
    const list = m[1] !== undefined ? m[1].replace(/,\n/g, ",") : m[2];
    names.push(...list.split(",").map((n) => n.trim()).filter((n) => n !== ""));
  }
  return names;
}

describe("the Python package's generated export region", () => {
  let root: string;
  let pkg: string;
  let init: string;
  let gen: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-python-exports-"));
    pkg = path.join(root, "stigmer");
    gen = path.join(pkg, "_gen");
    init = path.join(pkg, "__init__.py");
    fs.mkdirSync(pkg);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeInit(text: string): void {
    fs.writeFileSync(init, text);
  }

  const marked = (): string => `${HEAD}${PY_EXPORTS_BEGIN}\n${PY_EXPORTS_END}${TAIL}`;

  it("exports every resource's client and inputs, and none of the internals, as a literal list", () => {
    writeInit(marked());
    runSDKClientPythonGeneration(SCHEMAS, gen, init);
    const source = fs.readFileSync(init, "utf8");
    const region = source.slice(source.indexOf(PY_EXPORTS_BEGIN), source.indexOf(PY_EXPORTS_END));

    const resourceNames = listedNames(fs.readFileSync(path.join(gen, "__init__.py"), "utf8"), "__all__ = [").filter(
      (name) => !INTERNALS.includes(name) && !HAND_EXPORTED.includes(name),
    );
    const exported = listedNames(region, "__all__ += [");
    expect(exported).toEqual(resourceNames);
    expect(exported).toContain("TeamClient");
    expect(exported).toContain("ChannelInput");
    expect(new Set(exported).size).toBe(exported.length);
    for (const name of [...INTERNALS, ...HAND_EXPORTED]) expect(region).not.toMatch(new RegExp(`\\b${name}\\b`));

    // Every listed name is imported in the region, and nothing else is.
    expect(importedNames(region)).toEqual(exported);
    expect(region).toMatch(/^from \._gen\._apikey import ApiKeyClient, ApiKeyInput$/m);
    expect(region).toMatch(/^from \._gen\._agent import \(\n {4}AgentClient,\n {4}AgentInput,\n/m);
    expect(region).not.toMatch(/^__all__ = /m);
  });

  it("keeps the text outside the markers byte for byte, and a second run changes nothing", () => {
    writeInit(marked());
    runSDKClientPythonGeneration(SCHEMAS, gen, init);
    const first = fs.readFileSync(init, "utf8");
    expect(first.startsWith(`${HEAD}${PY_EXPORTS_BEGIN}\n`)).toBe(true);
    expect(first.endsWith(`\n${PY_EXPORTS_END}${TAIL}`)).toBe(true);

    runSDKClientPythonGeneration(SCHEMAS, gen, init);
    expect(fs.readFileSync(init, "utf8")).toBe(first);
  });

  it("replaces a stale or hand-edited region", () => {
    writeInit(`${HEAD}${PY_EXPORTS_BEGIN}\nfrom ._gen._team import TeamClient  # by hand\n${PY_EXPORTS_END}${TAIL}`);
    runSDKClientPythonGeneration(SCHEMAS, gen, init);
    const source = fs.readFileSync(init, "utf8");
    expect(source).not.toContain("# by hand");
    expect(source).toContain('    "TeamClient",\n');
  });

  it.each([
    ["has no begin marker", () => `${HEAD}${PY_EXPORTS_END}\n`, /exactly once \(found 0\)/],
    ["has no end marker", () => `${HEAD}${PY_EXPORTS_BEGIN}\n`, /exactly once \(found 0\)/],
    [
      "has a marker twice",
      () => `${PY_EXPORTS_BEGIN}\n${PY_EXPORTS_END}\n${PY_EXPORTS_BEGIN}\n${PY_EXPORTS_END}\n`,
      /exactly once \(found 2\)/,
    ],
    ["closes before it opens", () => `${PY_EXPORTS_END}\n${PY_EXPORTS_BEGIN}\n`, /closes its generated region before opening it/],
  ])("refuses a package init that %s, naming it, before generating anything", (_label, text, message) => {
    writeInit(text());
    const before = fs.readFileSync(init, "utf8");
    expect(() => runSDKClientPythonGeneration(SCHEMAS, gen, init)).toThrow(message);
    expect(() => runSDKClientPythonGeneration(SCHEMAS, gen, init)).toThrow(init);
    expect(fs.existsSync(gen)).toBe(false);
    expect(fs.readFileSync(init, "utf8")).toBe(before);
  });

  it("refuses a package with no __init__.py, naming the path", () => {
    expect(() => runSDKClientPythonGeneration(SCHEMAS, gen, init)).toThrow(`cannot read the package init ${init}`);
    expect(fs.existsSync(gen)).toBe(false);
  });

  it("the sdk-client-python target writes the region of the __init__.py beside its output", () => {
    writeInit(marked());
    runGenerationTarget("sdk-client-python", { schemaDir: SCHEMAS, outputDir: gen, apisDir: APIS });
    expect(fs.readFileSync(init, "utf8")).toContain('    "TeamInput",\n');
  });
});
