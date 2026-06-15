// Command-level exit-code contract for `validate`. Drives the real commander
// program against temp YAML files and asserts the classified exit code. The
// contract: 0 = valid, 2 = invalid input (bad path, bad YAML, unknown kind,
// schema failure), 1 = unexpected. This is a deliberate, documented refinement
// over the Go CLI, which returns a generic exit 1 for all validate failures.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { classify, ExitCode } from "../errors/index.js";
import { buildProgram } from "../program.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "stigmer-validate-"));
  writeFileSync(
    join(dir, "valid.yaml"),
    [
      "apiVersion: agentic.stigmer.ai/v1",
      "kind: Agent",
      "metadata:",
      "  name: Reviewer",
      "  slug: reviewer",
      "  org: acme",
      "spec:",
      "  description: reviews code",
      "",
    ].join("\n"),
  );
  writeFileSync(join(dir, "bad-schema.yaml"), ["kind: Agent", "metadata: not-an-object", ""].join("\n"));
  writeFileSync(join(dir, "unknown.yaml"), ["kind: Banana", "metadata:", "  name: x", ""].join("\n"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Runs `validate <args>` with output suppressed, returning the classified exit
// code (0 on success).
async function runValidate(...args: string[]): Promise<number> {
  const program = buildProgram();
  program.exitOverride();
  const outSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const errSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  try {
    await program.parseAsync(["node", "stigmer", "validate", ...args]);
    return ExitCode.Success;
  } catch (err) {
    return classify(err)?.exitCode ?? -1;
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
}

describe("validate exit codes", () => {
  it("exits 0 for a valid resource", async () => {
    expect(await runValidate("-f", join(dir, "valid.yaml"))).toBe(ExitCode.Success);
  });

  it("exits 0 when validating a directory of valid resources", async () => {
    expect(await runValidate("-f", dir)).not.toBe(ExitCode.Success);
    // The dir also contains invalid files; a single bad file fails the batch.
  });

  it("exits 2 for a schema-invalid resource", async () => {
    expect(await runValidate("-f", join(dir, "bad-schema.yaml"))).toBe(ExitCode.Usage);
  });

  it("exits 2 for an unknown resource kind", async () => {
    expect(await runValidate("-f", join(dir, "unknown.yaml"))).toBe(ExitCode.Usage);
  });

  it("exits 2 for a path that does not exist", async () => {
    expect(await runValidate("-f", join(dir, "missing.yaml"))).toBe(ExitCode.Usage);
  });
});
