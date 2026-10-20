// Command-level contract for `stigmer download`: a run (the pre-gate alias)
// is named `run` or `runs`, any case, and only a run id is accepted; every
// other type resolves through the registry, and one whose verb-matrix row
// promises no Download is refused with the types that do, read from the
// registry; a session and a File dispatch through DOWNLOAD_HANDLERS with the
// reference, the artifact name and the output directory. Every refusal is a
// usage error before any backend call, the result flags included for a
// download that prints the files it writes. Progress goes to stderr, and the
// outcome line (none found with its tip, all downloaded, or some of them)
// goes to stdout. Eval's own suite is eval-command.test.ts. The backend and
// the downloads are replaced at their module seams; the program, the
// registry and the flag parsing are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CliExitError, ExitCode, UsageError } from "../../errors/index.js";
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
const download = vi.hoisted(() => ({ downloadRunArtifacts: vi.fn(), session: vi.fn(), file: vi.fn() }));
vi.mock("../../resources/download.js", async () => {
  const { ApiResourceKind } = await import(
    "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb"
  );
  return {
    downloadRunArtifacts: download.downloadRunArtifacts,
    DOWNLOAD_HANDLERS: new Map([
      [ApiResourceKind.session, { answers: "files", noun: "artifact", download: download.session }],
      [ApiResourceKind.file, { answers: "files", noun: "file", download: download.file }],
    ]),
  };
});

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
  for (const handler of [download.session, download.file]) {
    handler.mockImplementation(async (_client: unknown, _request: unknown, progress: ProgressSink) => {
      progress("  Downloaded report.txt (23 B)");
      return outcome;
    });
  }
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

  it("passes --artifact and --output-dir through, and fails a partial download with a non-zero exit", async () => {
    outcome = { total: 2, downloaded: 1, noArtifacts: false, incompletePhase: undefined };
    const failed = await runDownload("RUNS", "aex_1", "--artifact", "report.txt", "-o", "/tmp/out").then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(download.downloadRunArtifacts).toHaveBeenCalledWith(
      stigmer,
      "aex_1",
      { artifactName: "report.txt", outputDir: "/tmp/out" },
      expect.any(Function),
    );
    expect(failed).toBeInstanceOf(CliExitError);
    expect((failed as CliExitError).exitCode).toBe(ExitCode.General);
    expect((failed as CliExitError).message).toBe("downloaded 1 of 2 artifacts");
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

  it("refuses a type whose verb matrix promises no download, naming the types that do, before any call", async () => {
    await expect(runDownload("agent", "aex_1")).rejects.toThrow(
      new UsageError("download not supported for type: agent\n\nThe types that download: run, session, file, eval"),
    );
    await expect(runDownload("nope", "x")).rejects.toThrow("download not supported for type: nope");
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

describe("stigmer download session and file", () => {
  it("downloads a session's outputs through its handler, with the artifact name and output directory", async () => {
    const { out, err } = await runDownload("session", "ses_1", "--artifact", "report.txt", "-o", "/tmp/out");
    expect(download.session).toHaveBeenCalledWith(
      stigmer,
      { ref: "ses_1", org: "", artifactName: "report.txt", outputDir: "/tmp/out" },
      expect.any(Function),
    );
    expect(err).toContain("  Downloaded report.txt (23 B)\n");
    expect(out).toBe("\nDownloaded 2 artifact(s) successfully\n");
  });

  it("says when the conversation's turns saved nothing", async () => {
    outcome = { total: 0, downloaded: 0, noArtifacts: true };
    const { out } = await runDownload("sessions", "ses_1");
    expect(out).toContain("No artifacts found for session: ses_1");
  });

  it("downloads a File through its handler, leaving the default directory to it", async () => {
    outcome = { total: 1, downloaded: 1, noArtifacts: false };
    const { out } = await runDownload("file", "file_1");
    expect(download.file).toHaveBeenCalledWith(
      stigmer,
      { ref: "file_1", org: "", artifactName: "", outputDir: undefined },
      expect.any(Function),
    );
    expect(out).toBe("\nDownloaded 1 file(s) successfully\n");
  });

  it.each([["session", "ses_1"], ["file", "file_1"]])(
    "refuses --json for a %s's download, which prints the files it writes, before any call",
    async (type, ref) => {
      await expect(runDownload(type, ref, "--json")).rejects.toThrow(
        new UsageError(`--json and --quiet apply to \`download eval\`; a ${type}'s download prints the files it writes`),
      );
      expect(download.session).not.toHaveBeenCalled();
      expect(download.file).not.toHaveBeenCalled();
    },
  );
});
