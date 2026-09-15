/**
 * Unit tests for the shared args-preview builder — the ONE preview rule every
 * tool row carries since S4 M2 C7 (Q-S4-16).
 *
 * The Cursor gate path depends on {@link buildElidedArgsPreview} producing a
 * SMALL, ALWAYS-VALID, salient-preserving preview: the resumed turn re-parses it
 * to rebuild an approval grant's identity, and the persist-time size backstop
 * would replace an oversized preview with an unparseable marker. These pin those
 * invariants so a large write can never silently break the resume round-trip.
 * (The native harness's whole-string-truncating `sanitizeArgsPreview` and its
 * two arms went at C7: a preview that could truncate to invalid JSON has no
 * caller left.)
 */

import { describe, it, expect } from "vitest";
import { buildElidedArgsPreview, redactSensitiveArgs, SALIENT_ARG_FIELDS } from "../args-preview.js";

describe("SALIENT_ARG_FIELDS", () => {
  it("spans both harnesses' shapes for a file and a shell command, in priority order", () => {
    expect([...SALIENT_ARG_FIELDS]).toEqual(["file_path", "path", "target_notebook", "command"]);
  });
});

describe("redactSensitiveArgs", () => {
  it("redacts secret keys case-insensitively and keeps everything else verbatim", () => {
    expect(redactSensitiveArgs({ Api_Key: "sk-123", path: "a.txt", n: 1 })).toEqual({ Api_Key: "[REDACTED]", path: "a.txt", n: 1 });
  });
});

describe("buildElidedArgsPreview", () => {
  const SALIENT = SALIENT_ARG_FIELDS;

  it("is exactly JSON.stringify(args) for short, secret-free args (what every native row now carries)", () => {
    expect(buildElidedArgsPreview({ path: "/x", n: 2 }, SALIENT)).toBe(JSON.stringify({ path: "/x", n: 2 }));
  });

  it("yields an empty string for unserializable args instead of throwing", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(buildElidedArgsPreview(cyclic, SALIENT)).toBe("");
  });

  it("stays valid JSON and small for a large write, leaving the content value out", () => {
    const content = "line\n".repeat(100_000); // ~500 KB
    const preview = buildElidedArgsPreview(
      { path: "src/big.ts", contents: content },
      SALIENT,
    );

    // Parseable — the resume round-trip depends on this.
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    // Bounded — nowhere near the raw content size.
    expect(preview.length).toBeLessThan(1_000);
    // The salient path survives verbatim (grant identity); the content is not
    // in the preview at all — never an in-band marker a reader could mistake
    // for the file (stigmer#1107): a surface that needs it reads the row's args.
    expect(parsed.path).toBe("src/big.ts");
    expect("contents" in parsed).toBe(false);
  });

  it("a value at the cap is carried whole; one character over is left out", () => {
    const atCap = "a".repeat(200);
    const overCap = "a".repeat(201);
    const parsed = JSON.parse(
      buildElidedArgsPreview({ path: "x", note: atCap, essay: overCap }, SALIENT),
    ) as Record<string, unknown>;
    expect(parsed.note).toBe(atCap);
    expect("essay" in parsed).toBe(false);
  });

  it("never elides a salient field, even a very long shell command", () => {
    const command = "echo " + "a".repeat(5_000);
    const preview = buildElidedArgsPreview({ command, cwd: "/x" }, SALIENT);

    const parsed = JSON.parse(preview) as Record<string, unknown>;
    // The grant token is base64(category\ncommand) — the command MUST be whole.
    expect(parsed.command).toBe(command);
  });

  it("redacts secret keys", () => {
    const preview = buildElidedArgsPreview(
      { path: "a.txt", authorization: "Bearer abc" },
      SALIENT,
    );
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    expect(parsed.authorization).toBe("[REDACTED]");
  });

  it("preserves small non-salient values unchanged", () => {
    const preview = buildElidedArgsPreview(
      { path: "a.txt", old_string: "alpha", new_string: "beta" },
      SALIENT,
    );
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    expect(parsed.old_string).toBe("alpha");
    expect(parsed.new_string).toBe("beta");
  });
});
