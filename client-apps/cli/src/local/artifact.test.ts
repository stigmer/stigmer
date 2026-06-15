import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mapReleaseArch, mapReleaseOs, sha256Hex } from "./artifact.js";

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
