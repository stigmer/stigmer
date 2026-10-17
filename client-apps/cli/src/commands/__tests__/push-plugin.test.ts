// Command-level contract for the two verbs that install a plugin folder,
// `stigmer push plugin <dir>` and `stigmer apply -f <dir>`: each pushes the
// archive the folder prepares to, into the context organization, and renders
// the install with the next steps read from the server's answer alone. And
// `apply -f <file> --dry-run` on a resource file previews it without reaching
// the backend. A real Connect backend over h2c serves the push; the config
// file (HOME redirected) points a selfhost backend at it.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ExitCode } from "../../errors/index.js";
import { writeCursorMarketplace } from "../../marketplace/__fixtures__/cursor-marketplace.js";
import { preparePluginPush } from "../../resources/plugin.js";
import { type PluginBackend, runCli, startPluginBackend, type TestHome, useTestHome } from "../__test-utils__/plugin-backend.js";

let backend: PluginBackend;
let home: TestHome;
let fixture: string;

beforeAll(async () => {
  backend = await startPluginBackend(
    create(PluginSchema, {
      metadata: { id: "plg_1", slug: "warmer", org: "acme" },
      spec: { name: "warmer", version: "1.0.0" },
      status: { digest: "a".repeat(64), skills: [{ name: "warm" }] },
    }),
  );
});

afterAll(async () => {
  await backend.close();
});

beforeEach(() => {
  backend.pushes.length = 0;
  home = useTestHome(backend.port);
  fixture = mkdtempSync(join(tmpdir(), "stigmer-push-plugin-"));
  writeCursorMarketplace(fixture);
});

afterEach(() => {
  home.restore();
  rmSync(fixture, { recursive: true, force: true });
});

describe.each([
  ["push plugin <dir>", (dir: string) => ["push", "plugin", dir, "--json"]],
  ["apply -f <dir>", (dir: string) => ["apply", "-f", dir, "--json"]],
])("stigmer %s", (_verb, argv) => {
  it("pushes the archive the folder prepares to and renders the install with its next steps", async () => {
    const dir = join(fixture, "warmer");
    const outcome = await runCli(argv(dir));
    expect(outcome.message).toBe("");
    expect(outcome.exitCode).toBe(ExitCode.Success);

    expect(backend.pushes).toHaveLength(1);
    const expected = await preparePluginPush(dir);
    expect(Buffer.from(backend.pushes[0]?.artifact ?? []).equals(Buffer.from(expected.archive))).toBe(true);
    expect(backend.pushes[0]?.org).toBe("acme");

    const payload = JSON.parse(outcome.stdout);
    expect(payload.data.next).toEqual([
      { kind: "run", command: "stigmer run --plugin warmer" },
      { kind: "add-to-agent", plugin: "warmer" },
    ]);
  });
});

describe("stigmer apply -f <file> --dry-run", () => {
  it("previews a resource file without reaching the backend", async () => {
    const file = join(fixture, "agent.yaml");
    writeFileSync(
      file,
      ["apiVersion: agentic.stigmer.ai/v1", "kind: Agent", "metadata:", "  name: Reviewer", "  slug: reviewer", "spec:", "  description: Reviews", ""].join("\n"),
    );
    const outcome = await runCli(["apply", "-f", file, "--dry-run", "--json"]);
    expect(outcome.message).toBe("");
    expect(outcome.exitCode).toBe(ExitCode.Success);
    expect(JSON.parse(outcome.stdout).message).toBe("Dry run: Reviewer is valid");
    expect(backend.pushes).toHaveLength(0);
  });
});
