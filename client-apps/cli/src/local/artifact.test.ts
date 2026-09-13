import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapReleaseArch, mapReleaseOs, parseShasum, sha256Hex } from "./artifact.js";

describe("mapReleaseOs", () => {
  it("maps Node platforms to release OS tokens", () => {
    expect(mapReleaseOs("darwin")).toBe("darwin");
    expect(mapReleaseOs("win32")).toBe("windows");
    expect(mapReleaseOs("linux")).toBe("linux");
    expect(mapReleaseOs("freebsd")).toBe("linux"); // default bucket
  });
});

describe("mapReleaseArch", () => {
  it("maps Node arch names to release arch tokens", () => {
    expect(mapReleaseArch("arm64")).toBe("arm64");
    expect(mapReleaseArch("x64")).toBe("amd64");
    expect(mapReleaseArch("ppc64")).toBe("ppc64"); // passthrough
  });
});

describe("sha256Hex", () => {
  it("computes a lowercase hex digest matching node:crypto", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const expected = createHash("sha256").update(bytes).digest("hex");
    expect(sha256Hex(bytes)).toBe(expected);
  });
});

// A release-wide `sha256sum` file is matched by filename, never by position,
// and the binary-mode "*" prefix is not part of a name.
describe("parseShasum", () => {
  const A = "a".repeat(64);
  const B = "b".repeat(64);

  it("returns the digest on the line naming the file, wherever the line is", () => {
    const file = `${A}  first.tar.gz\n${B}  second.tar.gz\n`;
    expect(parseShasum(file, "second.tar.gz")).toBe(B);
    expect(parseShasum(file, "first.tar.gz")).toBe(A);
  });

  it("returns an empty string when no line names the file", () => {
    expect(parseShasum(`${A}  first.tar.gz\n`, "missing.tar.gz")).toBe("");
    expect(parseShasum("", "missing.tar.gz")).toBe("");
  });

  it("accepts sha256sum's binary-mode marker and normalises the hex to lowercase", () => {
    expect(parseShasum(`${A.toUpperCase()} *first.tar.gz\n`, "first.tar.gz")).toBe(A);
  });

  it("ignores blank and malformed lines", () => {
    expect(parseShasum(`\n\nnot-a-digest\n${B}  x.tar.gz\n`, "x.tar.gz")).toBe(B);
  });
});
