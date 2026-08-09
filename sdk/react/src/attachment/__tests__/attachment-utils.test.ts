import { describe, it, expect } from "vitest";
import { uniquifyFilename } from "../attachment-utils.js";

describe("uniquifyFilename", () => {
  const cases: Array<{
    scenario: string;
    name: string;
    taken: string[];
    expected: string;
  }> = [
    {
      scenario: "returns the name unchanged when nothing collides",
      name: "report.pdf",
      taken: [],
      expected: "report.pdf",
    },
    {
      scenario: "suffixes -2 before the extension on first collision",
      name: "report.pdf",
      taken: ["report.pdf"],
      expected: "report-2.pdf",
    },
    {
      scenario: "walks past already-taken suffixes",
      name: "report.pdf",
      taken: ["report.pdf", "report-2.pdf", "report-3.pdf"],
      expected: "report-4.pdf",
    },
    {
      scenario: "handles names without an extension",
      name: "Makefile",
      taken: ["Makefile"],
      expected: "Makefile-2",
    },
    {
      scenario: "treats a leading dot as a hidden-file prefix, not an extension",
      name: ".env",
      taken: [".env"],
      expected: ".env-2",
    },
    {
      scenario: "only splits on the last dot of a multi-dot name",
      name: "backup.tar.gz",
      taken: ["backup.tar.gz"],
      expected: "backup.tar-2.gz",
    },
  ];

  for (const { scenario, name, taken, expected } of cases) {
    it(scenario, () => {
      expect(uniquifyFilename(name, new Set(taken))).toBe(expected);
    });
  }
});
