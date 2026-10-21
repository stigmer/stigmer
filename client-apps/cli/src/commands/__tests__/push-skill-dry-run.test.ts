// Command-level contract for `stigmer push skill --dry-run` in each of its
// three sources: a pre-built `--archive`, a local skill directory, and a
// remote `--git-url`. A dry run never reaches the backend; each renders its
// preview of what would be pushed and closes on the one instruction that
// turns the preview into a push. The config file (HOME redirected) points a
// selfhost backend at a port nothing listens on, so any call would fail.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../errors/index.js";
import { runCli, type TestHome, useTestHome } from "../__test-utils__/plugin-backend.js";

const SKILL_MD = "---\nname: warm-up\n---\n\n# Warm up\n";
const CLOSING = "Run without --dry-run to push the skill.";

let home: TestHome;
let fixture: string;

beforeEach(() => {
  home = useTestHome(1);
  fixture = mkdtempSync(join(tmpdir(), "stigmer-push-skill-"));
});

afterEach(() => {
  home.restore();
  rmSync(fixture, { recursive: true, force: true });
});

function lastLine(stdout: string): string {
  const lines = stdout.trimEnd().split("\n");
  return lines[lines.length - 1] ?? "";
}

describe("stigmer push skill --dry-run", () => {
  it("previews a pre-built archive and closes on the instruction to push it", async () => {
    const archive = join(fixture, "warm-up.zip");
    writeFileSync(
      archive,
      zipSync({
        "SKILL.md": new TextEncoder().encode(SKILL_MD),
        "main.py": new TextEncoder().encode("print('warm')\n"),
      }),
    );
    const outcome = await runCli(["push", "skill", "--archive", archive, "--dry-run"]);
    expect(outcome.message).toBe("");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(outcome.stdout).toContain(`Dry run - validating skill archive: ${archive}`);
    expect(outcome.stdout).toContain("Skill name:   warm-up");
    expect(outcome.stdout).toContain("Files:        2");
    expect(lastLine(outcome.stdout)).toBe(CLOSING);
  });

  it("previews a local skill directory and closes on the instruction to push it", async () => {
    const dir = join(fixture, "warm-up");
    mkdirSync(dir);
    writeFileSync(join(dir, "SKILL.md"), SKILL_MD);
    writeFileSync(join(dir, "main.py"), "print('warm')\n");
    writeFileSync(join(dir, ".env"), "SECRET=1\n");
    const outcome = await runCli(["push", "skill", dir, "--dry-run"]);
    expect(outcome.message).toBe("");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(outcome.stdout).toContain(`Dry run - analyzing skill directory: ${dir}`);
    expect(outcome.stdout).toContain("  + SKILL.md");
    expect(lastLine(outcome.stdout)).toBe(CLOSING);
  });

  it("previews a remote repository without cloning it and closes on the instruction to push it", async () => {
    const outcome = await runCli([
      "push",
      "skill",
      "--git-url",
      "https://example.invalid/acme/skills.git",
      "--git-ref",
      "v1.2.0",
      "--subdir",
      "skills/warm-up",
      "--ignore",
      "*.log",
      "--include",
      "keep.log",
      "--dry-run",
    ]);
    expect(outcome.message).toBe("");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(outcome.stdout).toContain("  URL:    https://example.invalid/acme/skills.git");
    expect(outcome.stdout).toContain("  Ref:    v1.2.0");
    expect(outcome.stdout).toContain("  Subdir: skills/warm-up");
    expect(outcome.stdout).toContain("Note: Full analysis requires cloning the repository.");
    expect(lastLine(outcome.stdout)).toBe(CLOSING);
  });
});
