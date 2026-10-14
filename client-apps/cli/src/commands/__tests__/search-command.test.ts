// Command-level contract for `stigmer search`: the rendered results go to
// stdout as the resource layer rendered them, and human output ends with the
// match count and the exact command that reads the next page (the org and a
// non-default page size repeated, a query with spaces quoted for the shell),
// while json and the last page carry no footer. The backend and the search
// resource are replaced at their module seams; the program and the flag
// parsing are real.
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

const search = vi.hoisted(() => ({ searchResources: vi.fn() }));
vi.mock("../../resources/search.js", () => search);

let stdout: string[];

/** Runs `stigmer ...`, returning what it wrote to stdout. */
async function run(...args: string[]): Promise<string> {
  const program = buildProgram();
  program.exitOverride();
  await program.parseAsync(["node", "stigmer", "--standalone", ...args]);
  return stdout.join("");
}

beforeEach(() => {
  stdout = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  search.searchResources.mockReset();
});

describe("stigmer search", () => {
  it("prints the match count and the command that reads the next page", async () => {
    search.searchResources.mockResolvedValue({ rendered: "RESULTS\n", matches: 42, nextPageToken: "tok-2" });
    const out = await run("--org", "acme", "search", "agent", "code review", "--page-size", "5");
    expect(out).toBe(
      "RESULTS\n" +
        "\n42 results match.\n" +
        "See the next page with: stigmer --org acme search agent 'code review' --page-size 5 --page-token tok-2\n",
    );
    expect(search.searchResources.mock.calls[0]?.[3]).toEqual({ org: "acme", pageSize: 5, pageToken: "" });
  });

  it("leaves the org and a default page size out of the next-page command", async () => {
    search.searchResources.mockResolvedValue({ rendered: "RESULTS\n", matches: 30, nextPageToken: "tok-2" });
    const out = await run("search", "agent", "reviewer", "--page-token", "tok-1");
    expect(out).toContain("See the next page with: stigmer search agent reviewer --page-token tok-2\n");
    expect(search.searchResources.mock.calls[0]?.[3]).toEqual({ org: "", pageSize: 20, pageToken: "tok-1" });
  });

  it("prints no footer on the last page or for json", async () => {
    search.searchResources.mockResolvedValue({ rendered: "RESULTS\n", matches: 3, nextPageToken: "" });
    expect(await run("search", "agent", "reviewer")).toBe("RESULTS\n");
    stdout = [];
    search.searchResources.mockResolvedValue({ rendered: "[]\n", matches: 3, nextPageToken: "tok-2" });
    expect(await run("search", "agent", "reviewer", "-o", "json")).toBe("[]\n");
  });
});
