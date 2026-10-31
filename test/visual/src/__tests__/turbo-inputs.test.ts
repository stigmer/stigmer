// The visual task's cached pass is honest only if turbo hashes every file the
// suite reads from outside this package: the console's typefaces the gallery
// draws with, the job's names its story scenes draw, and the workflow and
// lockfile the image pin is held to.
// scripts/turbo-inputs.test.mjs guards the libraries' tests the same way, by
// turbo's own resolved inputs, and does not reach a test package; this does,
// for this package's one task.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

interface DryRunTask {
  readonly taskId: string;
  readonly inputs: Readonly<Record<string, string>>;
}

function inputsOfVisualTask(): readonly string[] {
  const result = spawnSync(
    `${root}node_modules/.bin/turbo`,
    ["run", "test:visual", "--filter=@stigmer/visual-tests", "--dry-run=json"],
    { cwd: root, encoding: "utf8", env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" } },
  );
  if (result.status !== 0) throw new Error(`turbo's dry run failed (exit ${result.status}):\n${result.stderr}`);
  const plan = JSON.parse(result.stdout) as { readonly tasks: readonly DryRunTask[] };
  const task = plan.tasks.find((t) => t.taskId === "@stigmer/visual-tests#test:visual");
  if (task === undefined) throw new Error("turbo plans no @stigmer/visual-tests#test:visual");
  return Object.keys(task.inputs);
}

describe("the visual task's inputs", () => {
  const inputs = inputsOfVisualTask();

  it("hash the console's vendored typefaces the gallery draws with", () => {
    expect(inputs).toContain("../../client-apps/web/src/app/fonts/Geist-Variable.woff2");
    expect(inputs).toContain("../../client-apps/web/src/app/fonts/IBMPlexSans-Regular.woff2");
  });

  it("hash the job's names the story scenes draw", () => {
    expect(inputs).toContain("../../brand/job-story.ts");
  });

  it("hash the workflow and the lockfile the image pin is held to, and the pin itself", () => {
    expect(inputs).toContain("../../.github/workflows/ci.ts-workspace.yaml");
    expect(inputs).toContain("../../package-lock.json");
    expect(inputs).toContain("playwright-image.json");
  });
});
