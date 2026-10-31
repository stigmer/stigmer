// Command-level contract for two commands that gained the result flags
// (CLI-02): `tag` and `auth login` print their result as JSON on stdout with
// `-o json`, and as the human line on stderr by default. The resource each
// delegates to is replaced at its module seam (the commands import them
// lazily), as is the backend.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CommandResult } from "../../output/command-result.js";
import { buildProgram } from "../../program.js";

const CONFIG: Config = {
  backend: {},
  backends: { cloud: { type: "cloud", token: "test-token" } },
  current_backend: "cloud",
};

vi.mock("../../backend.js", () => ({ connectBackend: () => ({ config: CONFIG, stigmer: { name: "stub-client" } }) }));

const tag = vi.hoisted(() => ({ tagVersion: vi.fn() }));
vi.mock("../../resources/tag.js", () => tag);

const login = vi.hoisted(() => ({ runLogin: vi.fn() }));
vi.mock("../auth/login.js", () => login);

let stdout: string[];
let stderr: string[];

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => (stdout.push(String(chunk)), true));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => (stderr.push(String(chunk)), true));
  tag.tagVersion.mockResolvedValue(CommandResult.success("Tagged acme/reviewer 3f8a1c0 as stable"));
  login.runLogin.mockResolvedValue(CommandResult.success("Logged in as ada@example.com"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function cli(...args: string[]): Promise<void> {
  await buildProgram().parseAsync(["--standalone", ...args], { from: "user" });
}

describe("CLI-02 tag and auth login print their result as JSON with -o json", () => {
  it("tags a version, printing the result line by default and JSON with -o json", async () => {
    await cli("tag", "agent", "acme/reviewer", "3f8a1c0", "stable");
    expect(stderr.join("")).toContain("Tagged acme/reviewer 3f8a1c0 as stable");
    expect(stdout).toEqual([]);
    await cli("tag", "agent", "acme/reviewer", "3f8a1c0", "stable", "-o", "json");
    expect(JSON.parse(stdout.join(""))).toMatchObject({ status: "success", message: "Tagged acme/reviewer 3f8a1c0 as stable" });
    expect(tag.tagVersion).toHaveBeenLastCalledWith({ name: "stub-client" }, "agent", "acme/reviewer", "3f8a1c0", "stable", "");
  });

  it("logs in, printing the result as JSON with -o json", async () => {
    await cli("auth", "login", "-o", "json");
    expect(JSON.parse(stdout.join(""))).toMatchObject({ status: "success", message: "Logged in as ada@example.com" });
  });
});
