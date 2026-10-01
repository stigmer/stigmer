// The installer's command line and the line it ends with. The install itself is
// the downloader's, pinned in src/local/temporal/__tests__/download.test.ts;
// what this file pins is the part CI reads: `--print-archive` alone selects the
// key mode, an install needs `--bin-dir`, `--cache-dir` is optional, and the
// final line names which source served the binary, so a lane's log shows
// whether the cache held. Importing the module installs nothing: `main` runs
// only when the file is executed.

import { describe, expect, it } from "vitest";
import { describeInstall, parseArgs } from "../install-temporal-cli.js";

describe("parseArgs", () => {
  it("reads an install with a cache directory", () => {
    expect(parseArgs(["--bin-dir", "/home/runner/bin", "--cache-dir", "/home/runner/.cache/t"])).toEqual({
      mode: "install",
      binDir: "/home/runner/bin",
      cacheDir: "/home/runner/.cache/t",
    });
  });

  it("reads an install without one", () => {
    expect(parseArgs(["--bin-dir", "/tmp/bin"])).toEqual({ mode: "install", binDir: "/tmp/bin", cacheDir: undefined });
  });

  it("selects the key mode on --print-archive, which needs no --bin-dir", () => {
    expect(parseArgs(["--print-archive"])).toEqual({ mode: "print-archive" });
  });

  it("refuses an install without --bin-dir, or with an empty one", () => {
    expect(parseArgs([])).toEqual({ mode: "usage-error", message: "--bin-dir is required" });
    expect(parseArgs(["--cache-dir", "/tmp/c", "--bin-dir"])).toEqual({ mode: "usage-error", message: "--bin-dir is required" });
  });
});

describe("describeInstall", () => {
  const line = (result: Parameters<typeof describeInstall>[2]): string => describeInstall("/b/temporal", "1.5.1", result);

  it("names the cache when it served the binary", () => {
    expect(line({ source: "cache" })).toBe("installed: /b/temporal  (Temporal CLI 1.5.1, checksum-verified, from the cache)\n");
  });

  it("says why a download happened when a cache was in use", () => {
    expect(line({ source: "network", cache: "absent" })).toContain("downloaded; the cache had no copy)");
    expect(line({ source: "network", cache: "mismatch" })).toContain("downloaded; the cached copy did not match)");
  });

  it("says only 'downloaded' when no cache was in use", () => {
    expect(line({ source: "network", cache: "unused" })).toBe(
      "installed: /b/temporal  (Temporal CLI 1.5.1, checksum-verified, downloaded)\n",
    );
  });
});
