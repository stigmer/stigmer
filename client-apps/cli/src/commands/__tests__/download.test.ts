// Command-level contract for `stigmer download run <id>`: a type other than
// run or eval (eval's own suite is eval-command.test.ts) is refused, a run
// is named `run` or `runs`, any case, and only a run id is accepted, each
// refused as a usage error before any backend call; the artifact name and
// output directory reach the download, progress goes to stderr, and the
// outcome line (none found with its tip, all downloaded, or some of them) goes
// to stdout. The backend and the download are replaced at their module seams;
// the program and the flag parsing are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import type { DownloadOutcome, DownloadParams, ProgressSink } from "../../resources/download.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: { type: "cloud" },
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

const stigmer = vi.hoisted(() => ({ name: "stub-client" }));

vi.mock("../../backend.js", () => ({
  connectBackend: () => ({ config: CONFIG, stigmer }),
}));

// The outcome the stubbed download reports, after writing one progress line.
let outcome: DownloadOutcome;
const download = vi.hoisted(() => ({ downloadRunArtifacts: vi.fn() }));
vi.mock("../../resources/download.js", () => download);

let stdout: string[];
let stderr: string[];

/** Runs `stigmer download ...`, returning stdout and stderr. */
async function runDownload(...args: string[]): Promise<{ out: string; err: string }> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "download", ...args]);
  return { out: stdout.join(""), err: stderr.join("") };
}

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  outcome = { total: 2, downloaded: 2, noArtifacts: false, incompletePhase: undefined };
  download.downloadRunArtifacts.mockImplementation(
    async (_client: unknown, _id: string, _params: DownloadParams, progress?: ProgressSink) => {
      progress?.("  Downloaded report.txt (23 B)");
      return outcome;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("stigmer download run", () => {
  it("downloads every artifact into the current directory by default", async () => {
    const { out, err } = await runDownload("run", "run_1");
    expect(download.downloadRunArtifacts).toHaveBeenCalledWith(
      stigmer,
      "run_1",
      { artifactName: "", outputDir: "." },
      expect.any(Function),
    );
    expect(err).toContain("  Downloaded report.txt (23 B)\n");
    expect(out).toBe("\nDownloaded 2 artifact(s) successfully\n");
  });

  it("passes --artifact and --output-dir through, and reports a partial download", async () => {
    outcome = { total: 2, downloaded: 1, noArtifacts: false, incompletePhase: undefined };
    const { out } = await runDownload("RUNS", "aex_1", "--artifact", "report.txt", "-o", "/tmp/out");
    expect(download.downloadRunArtifacts).toHaveBeenCalledWith(
      stigmer,
      "aex_1",
      { artifactName: "report.txt", outputDir: "/tmp/out" },
      expect.any(Function),
    );
    expect(out).toBe("\nDownloaded 1 of 2 artifacts\n");
  });

  it("says when the run produced no artifacts, with the tip", async () => {
    outcome = { total: 0, downloaded: 0, noArtifacts: true, incompletePhase: undefined };
    const { out } = await runDownload("run", "aex_1");
    expect(out).toContain("No artifacts found for run: aex_1");
    expect(out).toContain("Tip: Artifacts are the files an agent saves in its outputs folder (.stigmer/outputs/).");
  });

  it("takes a run minted before the run kind's prefix became run", async () => {
    await runDownload("run", "aex_1");
    expect(download.downloadRunArtifacts).toHaveBeenCalledWith(
      stigmer,
      "aex_1",
      { artifactName: "", outputDir: "." },
      expect.any(Function),
    );
  });

  it("refuses a type other than run before any call", async () => {
    await expect(runDownload("agent", "aex_1")).rejects.toThrow(
      new UsageError("download not supported for type: agent\n\nThe types that download: run, eval"),
    );
    expect(download.downloadRunArtifacts).not.toHaveBeenCalled();
  });

  it.each([["--json"], ["--quiet"]])("refuses %s, which only an eval download reads, before any call", async (flag) => {
    await expect(runDownload("run", "run_1", flag)).rejects.toThrow(
      new UsageError("--json and --quiet apply to `download eval`; a run's download prints the files it writes"),
    );
    expect(download.downloadRunArtifacts).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a run id", async () => {
    await expect(runDownload("run", "ses_1")).rejects.toThrow(
      new UsageError("invalid run ID: ses_1\n\nRuns must be referenced by ID (e.g., run_01abc123)"),
    );
    expect(download.downloadRunArtifacts).not.toHaveBeenCalled();
  });
});
