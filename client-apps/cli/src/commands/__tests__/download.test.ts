// Command-level contract for `stigmer download run <id>`: only the run type
// downloads (`run` or `runs`, any case), only an agent run id is accepted, both
// refused as usage errors before any backend call; the artifact name and
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
    expect(out).toContain("Tip: Artifacts are files created by the agent during a run.");
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
      new UsageError("download not supported for type: agent\n\nCurrently only 'run' type supports download"),
    );
    expect(download.downloadRunArtifacts).not.toHaveBeenCalled();
  });

  it("refuses an id that is not an agent run id", async () => {
    await expect(runDownload("run", "ses_1")).rejects.toThrow(
      new UsageError("invalid run ID: ses_1\n\nRuns must be referenced by ID (e.g., run_01abc123)"),
    );
    expect(download.downloadRunArtifacts).not.toHaveBeenCalled();
  });
});
