/**
 * Pins the TypeScript kind-meta emitter's resource availability file: every
 * kind with kind_meta gets one KIND_TIERS line, its tier written by its
 * ResourceTier name so the file reads as the proto does. A tier with no
 * ResourceTier name (descriptors newer than the `@stigmer/apis` build the
 * generator imports) fails generation with a message naming the tier and
 * the fix, rather than writing `ResourceTier.undefined`.
 *
 * The emitter runs over the real kind_meta entries into a temporary
 * directory; the failing case appends one entry with an unnamed tier for
 * its duration.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { kindMetaEntries, ResourceTier, type KindMetaEntry } from "../resource-kind.js";
import { generateTSKindMeta } from "../sdk-kind-meta-ts.js";

let out: string;
let appended: KindMetaEntry | undefined;

beforeEach(() => {
  out = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-ts-kind-meta-"));
  appended = undefined;
});

afterEach(() => {
  if (appended) {
    const entries = kindMetaEntries();
    entries.splice(entries.indexOf(appended), 1);
  }
  fs.rmSync(out, { recursive: true, force: true });
});

describe("the TypeScript resource availability file", () => {
  it("writes each kind's tier by its ResourceTier name", () => {
    generateTSKindMeta(out);
    const availability = fs.readFileSync(path.join(out, "resource-availability.ts"), "utf8");

    const lines = availability.split("\n").filter((line) => line.startsWith("  [ApiResourceKind."));
    expect(lines).toHaveLength(kindMetaEntries().length);
    expect(availability).toContain("  [ApiResourceKind.agent, ResourceTier.open_source],\n");
    expect(availability).toContain("  [ApiResourceKind.team, ResourceTier.enterprise],\n");
    expect(availability).not.toContain("ResourceTier.undefined");
  });

  it("refuses a tier with no ResourceTier name, naming the tier and the fix", () => {
    const entries = kindMetaEntries();
    const template = entries[0];
    if (!template) throw new Error("the descriptors carry no kind_meta");
    appended = { ...template, enumName: "unnamed_tier_kind", enumNumber: 9999, tier: 99 as ResourceTier };
    entries.push(appended);

    expect(() => generateTSKindMeta(out)).toThrowError(
      "kind_meta.tier 99 has no ResourceTier name — regenerate @stigmer/apis first",
    );
    expect(fs.existsSync(path.join(out, "resource-availability.ts"))).toBe(false);
  });
});
