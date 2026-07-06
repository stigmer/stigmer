/**
 * Unit tests for the CAS mid-run progress substrate (DD-33) — the non-git /
 * gitignored half of the "N files changed so far" strip.
 *
 * The substrate reads a {@link CasTouchedSnapshot} (the same before-map the
 * turn-boundary CAS capture reads) and the after-bytes off a real temp workspace,
 * classifies each via the shared {@link classifyCasChange}, and reports a bounded
 * read-prefix plus an honest `totalFilesChanged`. These cases prove: kind
 * derivation, no-op/created-then-deleted exclusion, binary + oversize zeroing,
 * secret exclusion, the read budget + tail total, revert-to-empty, and the
 * size+mtime short-circuit.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { createCasProgressSubstrate, type CasTouchedSnapshot } from "../cas-progress.js";
import { LINE_COUNT_MAX_BYTES } from "../line-counts.js";
import type { ProgressEntry } from "../progress.js";

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "cas-progress-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Write after-bytes to disk (the observed net result of the turn). */
function put(rel: string, content: string | Uint8Array): void {
  const abs = join(workspace, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, typeof content === "string" ? content : Buffer.from(content));
}

/** A static reader over an explicit before-map + blocked set. */
function reader(
  before: Map<string, Uint8Array | null>,
  blockedSecretPaths: ReadonlySet<string> = new Set(),
): () => CasTouchedSnapshot {
  return () => ({ before, blockedSecretPaths });
}

function entryFor(entries: readonly ProgressEntry[], path: string): ProgressEntry | undefined {
  return entries.find((e) => e.pathAfter === path || e.pathBefore === path);
}

describe("createCasProgressSubstrate", () => {
  it("classifies ADD / MODIFY / DELETE with line counts from the observer + disk", async () => {
    // before-map: new.ts is new (null), main.ts + gone.ts existed.
    const before = new Map<string, Uint8Array | null>([
      ["src/new.ts", null],
      ["src/main.ts", bytes("export const x = 1;\n")],
      ["gone.ts", bytes("l1\nl2\nl3\n")],
    ]);
    put("src/new.ts", "a\nb\nc\n"); // ADD, +3
    put("src/main.ts", "export const x = 2;\nexport const y = 3;\n"); // MODIFY
    // gone.ts is left absent on disk -> DELETE

    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });
    const { delta, changed } = await sub.capture();
    expect(changed).toBe(true);
    expect(delta.totalFilesChanged).toBe(3);
    expect(delta.entries).toHaveLength(3);

    const added = entryFor(delta.entries, "src/new.ts")!;
    expect(added.kind).toBe(FileChangeKind.ADD);
    expect(added.pathBefore).toBe("");
    expect(added.linesAdded).toBe(3);
    expect(added.linesRemoved).toBe(0);

    const modified = entryFor(delta.entries, "src/main.ts")!;
    expect(modified.kind).toBe(FileChangeKind.MODIFY);
    expect(modified.linesAdded).toBeGreaterThan(0);

    const deleted = entryFor(delta.entries, "gone.ts")!;
    expect(deleted.kind).toBe(FileChangeKind.DELETE);
    expect(deleted.pathAfter).toBe("");
    expect(deleted.linesRemoved).toBe(3);
  });

  it("excludes a no-op touch (bytes unchanged) from entries and the total", async () => {
    const before = new Map<string, Uint8Array | null>([
      ["noop.ts", bytes("same\n")],
      ["real.ts", bytes("a\n")],
    ]);
    put("noop.ts", "same\n"); // unchanged
    put("real.ts", "a\nb\n"); // changed

    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });
    const { delta } = await sub.capture();
    expect(entryFor(delta.entries, "noop.ts")).toBeUndefined();
    expect(entryFor(delta.entries, "real.ts")).toBeDefined();
    expect(delta.totalFilesChanged).toBe(1);
  });

  it("excludes a created-then-deleted path (both sides absent)", async () => {
    const before = new Map<string, Uint8Array | null>([["ephemeral.ts", null]]);
    // never written to disk -> after is null, before is null -> no change

    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });
    const { delta } = await sub.capture();
    expect(delta.entries).toHaveLength(0);
    expect(delta.totalFilesChanged).toBe(0);
  });

  it("zeroes counts for a binary file", async () => {
    const before = new Map<string, Uint8Array | null>([["blob.bin", null]]);
    put("blob.bin", new Uint8Array([0, 1, 2, 0, 255, 0]));

    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });
    const { delta } = await sub.capture();
    const bin = entryFor(delta.entries, "blob.bin")!;
    expect(bin.kind).toBe(FileChangeKind.ADD);
    expect(bin.linesAdded).toBe(0);
    expect(bin.linesRemoved).toBe(0);
  });

  it("derives kind for an oversize after WITHOUT reading it (zeroed counts)", async () => {
    const before = new Map<string, Uint8Array | null>([["huge.ts", null]]);
    // One byte over the count ceiling: the substrate stats it, sees it is too
    // large, and emits an ADD with zero counts rather than reading MBs.
    put("huge.ts", "x".repeat(LINE_COUNT_MAX_BYTES + 1));

    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });
    const { delta } = await sub.capture();
    const huge = entryFor(delta.entries, "huge.ts")!;
    expect(huge.kind).toBe(FileChangeKind.ADD);
    expect(huge.linesAdded).toBe(0);
    expect(huge.linesRemoved).toBe(0);
    expect(delta.totalFilesChanged).toBe(1);
  });

  it("excludes gate-blocked secret paths up front", async () => {
    const before = new Map<string, Uint8Array | null>([
      [".env", null],
      ["app.ts", null],
    ]);
    put(".env", "TOKEN=abc\n");
    put("app.ts", "code\n");

    const sub = createCasProgressSubstrate({
      workspaceRoot: workspace,
      read: reader(before, new Set([".env"])),
    });
    const { delta } = await sub.capture();
    expect(entryFor(delta.entries, ".env")).toBeUndefined();
    expect(entryFor(delta.entries, "app.ts")).toBeDefined();
    expect(delta.totalFilesChanged).toBe(1);
  });

  it("also excludes a secret-like path even when not gate-blocked (backstop)", async () => {
    // No gate-block set, but the path LOOKS secret-like: partitionIgnoredPathsBySecret
    // withholds it (the global-bypass backstop).
    const before = new Map<string, Uint8Array | null>([["config/id_rsa", null]]);
    put("config/id_rsa", "-----BEGIN KEY-----\n");

    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });
    const { delta } = await sub.capture();
    expect(delta.entries).toHaveLength(0);
    expect(delta.totalFilesChanged).toBe(0);
  });

  it("bounds reads to maxEntries but keeps totalFilesChanged honest over the tail", async () => {
    const before = new Map<string, Uint8Array | null>();
    for (let i = 0; i < 5; i++) {
      const p = `f${String(i).padStart(2, "0")}.ts`;
      before.set(p, null);
      put(p, `content ${i}\n`);
    }
    const sub = createCasProgressSubstrate({
      workspaceRoot: workspace,
      read: reader(before),
      maxEntries: 2,
    });
    const { delta } = await sub.capture();
    // Only the sorted prefix is read into entries…
    expect(delta.entries).toHaveLength(2);
    expect(delta.entries.map((e) => e.pathAfter)).toEqual(["f00.ts", "f01.ts"]);
    // …but the honest total covers every capturable file.
    expect(delta.totalFilesChanged).toBe(5);
  });

  it("returns a zero-file delta after the agent reverts its own edits", async () => {
    const before = new Map<string, Uint8Array | null>([["r.ts", null]]);
    // r.ts observed but never left on disk (reverted) -> after null, before null.
    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });
    const { delta } = await sub.capture();
    expect(delta.totalFilesChanged).toBe(0);
    expect(delta.entries).toHaveLength(0);
  });

  it("short-circuits (changed:false) when the touched set + prefix stats are unchanged", async () => {
    const before = new Map<string, Uint8Array | null>([["a.ts", null]]);
    put("a.ts", "hello\n");
    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });

    const first = await sub.capture();
    expect(first.changed).toBe(true);

    const second = await sub.capture();
    expect(second.changed).toBe(false);
    // The cached full delta is still returned so the hybrid can merge it.
    expect(second.delta.totalFilesChanged).toBe(1);
  });

  it("re-reports changed:true when a NEW path is touched (e.g. a sub-agent write)", async () => {
    const before = new Map<string, Uint8Array | null>([["a.ts", null]]);
    put("a.ts", "hello\n");
    const sub = createCasProgressSubstrate({ workspaceRoot: workspace, read: reader(before) });
    await sub.capture();

    // A concurrent write adds a new observed path.
    before.set("b.ts", null);
    put("b.ts", "world\n");
    const next = await sub.capture();
    expect(next.changed).toBe(true);
    expect(next.delta.totalFilesChanged).toBe(2);
  });
});
