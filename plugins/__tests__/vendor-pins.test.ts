/**
 * The pin file's contract: what parses, what is refused with which
 * sentence, and that the audit reads its vendors from it.
 *
 * Pins: a well-formed file round-trips through the canonical rendering
 * (rows and strikes sorted, so a no-op sync leaves no diff); a source
 * without a full SHA, a row naming an unknown source, a duplicate row, an
 * escaping path and a strike without a reason are each refused naming the
 * field; `isStruck` reads the strikes; `auditSources` lists the pin file's
 * sources in order at their default branch, applies `--ref` by repository,
 * and refuses a ref for a repository the file does not carry.
 */

import { describe, expect, it } from "vitest";

import { auditSources, parsePinnedRefs } from "../scripts/audit/sources.js";
import { isStruck, parseVendorPins, renderVendorPins, type VendorPins } from "../scripts/lib/vendor-pins.js";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const DIGEST = "0".repeat(64);

const PINS: VendorPins = {
  sources: {
    "cursor-plugins": { repo: "cursor/plugins", commit: SHA_A },
    "codex-plugins": { repo: "openai/plugins", commit: SHA_B },
  },
  plugins: [
    { name: "thermos", source: "cursor-plugins", path: "thermos", licence: "LICENSE", digest: DIGEST },
    { name: "gong", source: "cursor-plugins", path: "third_party/gong", licence: "LICENSE", digest: DIGEST },
    { name: "superpowers", source: "codex-plugins", path: "plugins/superpowers", licence: "LICENSE", digest: DIGEST },
  ],
  struck: [
    { source: "cursor-plugins", name: "orchestrate", reason: "carries a .gitignore npm consumes rather than publishes" },
    { source: "cursor-plugins", name: "google-cloud-bigquery", reason: "signs in at a login server that does not register clients" },
  ],
};

const parse = (value: unknown): VendorPins => parseVendorPins(JSON.stringify(value), "vendor.json");

describe("parseVendorPins and renderVendorPins", () => {
  it("round-trips a well-formed file through the canonical rendering, sorted", () => {
    const text = renderVendorPins(PINS);
    const parsed = parseVendorPins(text, "vendor.json");
    expect(parsed.plugins.map((row) => row.name)).toEqual(["gong", "superpowers", "thermos"]);
    expect(parsed.struck.map((strike) => strike.name)).toEqual(["google-cloud-bigquery", "orchestrate"]);
    expect(Object.keys(parsed.sources)).toEqual(["cursor-plugins", "codex-plugins"]);
    expect(renderVendorPins(parsed)).toBe(text);
    expect(text.endsWith("\n")).toBe(true);
  });

  it("refuses a source without a full SHA, naming it", () => {
    expect(() => parse({ ...PINS, sources: { "cursor-plugins": { repo: "cursor/plugins", commit: "1f84288" } } })).toThrow(
      "vendor.json: source 'cursor-plugins' has a commit that is not a full SHA: '1f84288'",
    );
  });

  it("refuses a row that names a source the file does not carry", () => {
    expect(() => parse({ ...PINS, plugins: [{ name: "x", source: "claude-plugins", path: "x", licence: "LICENSE", digest: DIGEST }] })).toThrow(
      "vendor.json: plugin 'x' names source 'claude-plugins', which 'sources' does not carry",
    );
  });

  it("refuses a duplicate row and an escaping path", () => {
    expect(() => parse({ ...PINS, plugins: [...PINS.plugins, { name: "thermos", source: "cursor-plugins", path: "other", licence: "LICENSE", digest: DIGEST }] })).toThrow("plugin 'thermos' is listed twice");
    expect(() => parse({ ...PINS, plugins: [{ name: "x", source: "cursor-plugins", path: "../x", licence: "LICENSE", digest: DIGEST }] })).toThrow("has a path that is not a plain relative directory");
  });

  it("refuses a strike without a reason", () => {
    expect(() => parse({ ...PINS, struck: [{ source: "cursor-plugins", name: "x", reason: " " }] })).toThrow(
      "struck 'cursor-plugins/x' has no reason; a strike without one cannot be revisited",
    );
  });

  it("isStruck reads the strikes by source and name", () => {
    expect(isStruck(PINS, "cursor-plugins", "orchestrate")).toBe(true);
    expect(isStruck(PINS, "codex-plugins", "orchestrate")).toBe(false);
  });
});

describe("auditSources", () => {
  it("lists the pin file's sources in order, at their default branch unless a ref pins them", () => {
    expect(auditSources(PINS, new Map())).toEqual([
      { name: "cursor-plugins", repo: "cursor/plugins" },
      { name: "codex-plugins", repo: "openai/plugins" },
    ]);
    expect(auditSources(PINS, parsePinnedRefs([`openai/plugins=${SHA_B}`]))).toEqual([
      { name: "cursor-plugins", repo: "cursor/plugins" },
      { name: "codex-plugins", repo: "openai/plugins", ref: SHA_B },
    ]);
  });

  it("refuses a ref for a repository the pin file does not carry", () => {
    expect(() => auditSources(PINS, parsePinnedRefs(["anthropics/claude-code=main"]))).toThrow(
      "--ref names 'anthropics/claude-code', which is not one of the catalogues vendor.json lists: cursor/plugins, openai/plugins",
    );
  });
});
