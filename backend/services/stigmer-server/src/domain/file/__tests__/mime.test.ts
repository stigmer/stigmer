/**
 * Pins a File's media type rule: the declared type wins (lowercased), an
 * extension the table knows comes next whatever its case, and everything
 * else (no extension, a dotfile, an unknown extension) is
 * application/octet-stream.
 */
import { describe, expect, it } from "vitest";

import { fileMimeType } from "../mime.js";

describe("fileMimeType", () => {
  it("keeps the declared type, lowercased", () => {
    expect(fileMimeType("shot.png", "Image/JPEG")).toBe("image/jpeg");
  });

  it("reads a known extension whatever its case", () => {
    expect(fileMimeType("Q3-Ledger.XLSX", "")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(fileMimeType("screenshot.webp", "")).toBe("image/webp");
  });

  it.each(["README", ".env", "data.unknownext", "trailing."])(
    "%s is application/octet-stream",
    (filename) => {
      expect(fileMimeType(filename, "")).toBe("application/octet-stream");
    },
  );
});
