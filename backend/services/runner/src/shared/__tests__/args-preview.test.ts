/**
 * Unit tests for the shared args-preview sanitizers.
 *
 * The Cursor gate path depends on {@link buildElidedArgsPreview} producing a
 * SMALL, ALWAYS-VALID, salient-preserving preview: the resumed turn re-parses it
 * to rebuild an approval grant's identity, and the persist-time size backstop
 * would replace an oversized preview with an unparseable marker. These pin those
 * invariants so a large write can never silently break the resume round-trip.
 */

import { describe, it, expect } from "vitest";
import {
  buildElidedArgsPreview,
  sanitizeArgsPreview,
  MAX_ARGS_PREVIEW_LENGTH,
} from "../args-preview.js";

describe("sanitizeArgsPreview (native)", () => {
  it("redacts sensitive keys", () => {
    const out = JSON.parse(sanitizeArgsPreview({ api_key: "sk-123", path: "a.txt" }));
    expect(out.api_key).toBe("[REDACTED]");
    expect(out.path).toBe("a.txt");
  });

  it("truncates the whole string past the cap", () => {
    const preview = sanitizeArgsPreview({ contents: "x".repeat(MAX_ARGS_PREVIEW_LENGTH * 2) });
    expect(preview.length).toBeLessThanOrEqual(MAX_ARGS_PREVIEW_LENGTH + 1);
    expect(preview.endsWith("…")).toBe(true);
  });
});

describe("buildElidedArgsPreview (cursor gate)", () => {
  const SALIENT = ["file_path", "path", "target_notebook", "command"] as const;

  it("stays valid JSON and small for a large write, eliding the content value", () => {
    const content = "line\n".repeat(100_000); // ~500 KB
    const preview = buildElidedArgsPreview(
      { path: "src/big.ts", contents: content },
      SALIENT,
    );

    // Parseable — the resume round-trip depends on this.
    const parsed = JSON.parse(preview) as Record<string, unknown>;
    // Bounded — nowhere near the raw content size.
    expect(preview.length).toBeLessThan(1_000);
    // The salient path survives verbatim (grant identity), content is elided.
    expect(parsed.path).toBe("src/big.ts");
    expect(parsed.contents).toBe(`[${content.length} chars]`);
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
