import { describe, it, expect } from "vitest";
import { fileIconCategory } from "../index";

describe("fileIconCategory", () => {
  it("classifies common code extensions", () => {
    for (const name of ["a.ts", "b.tsx", "c.js", "m.py", "s.go", "r.rs"]) {
      expect(fileIconCategory(name)).toBe("code");
    }
  });

  it("classifies markup, style, data, markdown, image", () => {
    expect(fileIconCategory("index.html")).toBe("markup");
    expect(fileIconCategory("app.css")).toBe("style");
    expect(fileIconCategory("tsconfig.json")).toBe("data");
    expect(fileIconCategory("config.yaml")).toBe("data");
    expect(fileIconCategory("README.md")).toBe("markdown");
    expect(fileIconCategory("logo.png")).toBe("image");
  });

  it("is case-insensitive on the extension", () => {
    expect(fileIconCategory("Main.TS")).toBe("code");
    expect(fileIconCategory("PHOTO.PNG")).toBe("image");
  });

  it("falls back to generic for unknown or extension-less names", () => {
    expect(fileIconCategory("Makefile")).toBe("generic");
    expect(fileIconCategory("data.unknownext")).toBe("generic");
    expect(fileIconCategory("trailingdot.")).toBe("generic");
  });

  it("uses the last dotted segment for multi-dot names", () => {
    expect(fileIconCategory("app.test.ts")).toBe("code");
    expect(fileIconCategory("archive.tar.gz")).toBe("generic");
  });
});
