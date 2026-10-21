/**
 * Pins how a File's size reads (../file-size.ts): a `bigint` and a
 * `number` of the same count read alike, bytes stay whole, and larger
 * counts take one decimal in base-1024 units up to TB.
 */
import { describe, expect, it } from "vitest";

import { formatFileSize } from "../file-size.js";

describe("formatFileSize", () => {
  it("reads a bigint and a number of the same count alike", () => {
    expect(formatFileSize(1536n)).toBe("1.5 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
  });

  it("keeps bytes whole and gives larger units one decimal", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2621440n)).toBe("2.5 MB");
    expect(formatFileSize(500 * 1024 ** 3)).toBe("500.0 GB");
    expect(formatFileSize(2 * 1024 ** 4)).toBe("2.0 TB");
  });
});
