// Command-level contract for `stigmer list <kind>` through the registry: the
// kind's alias resolves to its ApiResourceKind, and the resolved
// organization, `--limit`, the output format and the `--label` and
// `--session` filters reach the list read, whose rendering goes to stdout.
// `--session` names a conversation whose Files to list, so it is refused,
// before any read, for every type but files and for an id that is not a
// session's. The backend and the list read
// are replaced at their module seams; the program and the registry are real.

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
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

const reads = vi.hoisted(() => ({ listResources: vi.fn() }));
vi.mock("../../resources/list.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../resources/list.js")>();
  return { ...actual, ...reads };
});

let stdout: string[];

/** Runs `stigmer --org acme list ...`, returning what it wrote to stdout. */
async function list(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", "--org", "acme", "list", ...args]);
  return stdout.join("");
}

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  reads.listResources.mockResolvedValue("rendered agents\n");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("stigmer list <kind>", () => {
  it("lists the kind in the resolved organization, with no label filter by default", async () => {
    const out = await list("agents");
    expect(reads.listResources).toHaveBeenCalledWith(stigmer, ApiResourceKind.agent, "acme", 50, "table", {
      labels: {},
      sessionId: "",
    });
    expect(out).toBe("rendered agents\n");
  });

  it("passes every --label pair, the limit and the format to the list read", async () => {
    await list("routines", "-l", "team=support", "--label", "tier=gold", "--limit", "5", "--output", "json");
    expect(reads.listResources).toHaveBeenCalledWith(stigmer, ApiResourceKind.routine, "acme", 5, "json", {
      labels: { team: "support", tier: "gold" },
      sessionId: "",
    });
  });

  it("passes --session to the File list read", async () => {
    await list("files", "--session", "ses_conv");
    expect(reads.listResources).toHaveBeenCalledWith(stigmer, ApiResourceKind.file, "acme", 50, "table", {
      labels: {},
      sessionId: "ses_conv",
    });
  });

  it.each([["agents"], ["runs"], ["types"]])("refuses --session for '%s' before reading", async (type) => {
    await expect(list(type, "--session", "ses_conv")).rejects.toThrow("--session");
    expect(reads.listResources).not.toHaveBeenCalled();
  });

  it("refuses a --session that is not a session's id before reading", async () => {
    await expect(list("files", "--session", "file_1")).rejects.toThrow("invalid session ID: file_1");
    expect(reads.listResources).not.toHaveBeenCalled();
  });

  it("refuses a malformed label before reading", async () => {
    await expect(list("agents", "--label", "team")).rejects.toThrow('invalid --label "team": want key=value');
    expect(reads.listResources).not.toHaveBeenCalled();
  });
});
