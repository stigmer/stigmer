// Unit arms for the quality arm's suite: the working agent's plugin
// (fixtures/working-agent), read by the library's own readers, and the
// facts its graders rest on, checked against the files they grade.
// Domain: conformance benchmark.
//
// Pinned: the plugin installs and its suite loads eleven cases with no
// finding, each scaffolded from the one shared workspace, only the resumed
// case native-only; the order mock answers what the order tool's table
// holds; the facts the rubrics state are the workspace's (the config's
// retry limit and typo, the store's two defects, the signup totals, the
// return policy); the resumed case's scaffold leaves the workspace as its
// recorded turn left it; the multi-part case allows the test the
// repo-conventions skill asks for, where the orders package has none; the
// workspace's AGENTS.md holds one rule written nowhere else, graded by a case
// of its own; and the sync log is longer than the runner's bound on a tool
// result, in fewer lines than a read returns, with its cause only in its last
// lines and no config key in it.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  evalCaseUnsupportedOnCursor,
  inMemoryPluginFiles,
  readEvalSuite,
  readPluginPackage,
  type EvalCase,
  type EvalGraderCheck,
} from "@stigmer/plugin-package";
import { describe, expect, it } from "vitest";
import { FIXTURE_ORDERS } from "../../harness/mcp-server";
import { WORKING_AGENT_FIXTURE_DIR, WORKING_AGENT_WORKSPACE_FIXTURE_DIR } from "../../support/working-agent";
import { readPluginDirectory } from "../quality-eval";

// The runner's default bound on a tool result's characters (runner
// activities/execute-deep-agent/turn-setup.ts, `max_tool_result_chars`), and
// the lines deepagents' read_file returns when the call sets no limit
// (deepagents 1.14.1). The sync log is an exercise of the bound only while it
// sits between the two.
const TOOL_RESULT_BOUND_CHARS = 30_000;
const READ_FILE_DEFAULT_LINES = 500;
const SYNC_LOG = "logs/sync-2026-10-20.log";

const files = async () => inMemoryPluginFiles(await readPluginDirectory(WORKING_AGENT_FIXTURE_DIR));
const workspaceFile = (path: string): Promise<string> => readFile(join(WORKING_AGENT_WORKSPACE_FIXTURE_DIR, path), "utf8");
const caseFile = (name: string, path: string): Promise<string> => readFile(join(WORKING_AGENT_FIXTURE_DIR, "evals", name, path), "utf8");

async function cases(): Promise<Map<string, EvalCase>> {
  return new Map(readEvalSuite(await files()).cases.map((evalCase) => [evalCase.name, evalCase]));
}

/** Every text a case's graders carry (patterns and rubrics), whitespace folded. */
function graderText(evalCase: EvalCase): string {
  const text = (check: EvalGraderCheck): string => {
    switch (check.type) {
      case "regex":
        return check.pattern;
      case "llm":
      case "baseline":
        return check.criteria;
      case "tool_used":
        return `${check.tool} ${check.inputMatch ?? ""}`;
      case "tool_order":
      case "file_exists":
        return "";
    }
  };
  return evalCase.graders.map((grader) => text(grader.check)).join(" ").replace(/\s+/g, " ");
}

describe("the working agent's plugin", () => {
  it("installs, and its suite is eleven cases with no finding, each scaffolded from the shared workspace", async () => {
    const plugin = await files();
    expect(readPluginPackage(plugin).ok).toBe(true);
    const suite = readEvalSuite(plugin);
    expect(suite.findings).toEqual([]);
    expect(suite.servers).toEqual(["orders-api"]);
    expect(suite.cases.map((c) => c.name)).toEqual([
      "code-review-no-edit",
      "config-fix",
      "data-summary",
      "diagnose-sync-log",
      "fix-bug-with-test",
      "follows-repo-instructions",
      "multi-part-change",
      "refine-over-turns",
      "repo-question",
      "support-policy",
      "tool-lookup",
    ]);
    for (const evalCase of suite.cases) {
      expect(evalCase.unsupported, evalCase.name).toBeUndefined();
      expect(evalCase.context.scaffoldScript, evalCase.name).toBe("scaffold.sh");
      expect(await caseFile(evalCase.name, "scaffold.sh"), evalCase.name).toContain('cp -R "$(dirname "$0")/../_fixture/workspace/." .');
      expect(evalCaseUnsupportedOnCursor(evalCase), evalCase.name).toBe(evalCase.name === "refine-over-turns" ? "resumed conversations" : undefined);
    }
  });

  it("answers the order lookup with what the order tool's table holds", async () => {
    for (const [id, order] of Object.entries(FIXTURE_ORDERS)) {
      const fixture = await readFile(join(WORKING_AGENT_FIXTURE_DIR, "evals", "mocks", "orders-api", "fixtures", `${id}.json`), "utf8");
      expect(JSON.parse(fixture), id).toEqual(order);
    }
    const order = FIXTURE_ORDERS["ORD-4821"]!;
    const lookup = graderText((await cases()).get("tool-lookup")!);
    for (const field of ["status", "carrier", "tracking_number", "shipped_on", "estimated_delivery"] as const) {
      expect(lookup, field).toContain(String(order[field]));
    }
  });

  it("states the workspace's facts as its files hold them", async () => {
    const byName = await cases();
    expect(await workspaceFile("config/sync.yaml")).toContain("max_attempts: 50");
    expect(await workspaceFile("config/sync.yaml")).toContain("timout: 30s");
    expect(await workspaceFile("config/sync.yaml")).toContain("interval: 5m");
    expect(await workspaceFile("config/sync.yaml")).toContain("backoff: 2s");
    expect(await workspaceFile("syncer/syncer.go")).toContain("DefaultMaxAttempts = 5");
    expect(graderText(byName.get("repo-question")!)).toContain("DefaultMaxAttempts");
    const store = await workspaceFile("orders/store.go");
    expect(store).toContain("offset := page * pageSize");
    expect(store).toContain("WHERE customer = '%s'");
    expect(graderText(byName.get("multi-part-change")!)).toContain("WHERE customer = '%s'");

    const policy = await workspaceFile("policies/returns.md");
    expect(policy).toContain("within 30 days of delivery");
    expect(policy).toContain("within 90\ndays of delivery");

    const rows = (await workspaceFile("data/signups.csv")).trim().split("\n").slice(1);
    const totals = rows.map((row) => row.split(",").slice(1).reduce((sum, cell) => sum + Number(cell), 0));
    const earlier = totals.slice(0, -1);
    const average = Math.round(earlier.reduce((sum, total) => sum + total, 0) / earlier.length);
    const summary = graderText(byName.get("data-summary")!);
    expect(summary).toContain(`weekly totals ${totals.slice(0, -1).join(", ")} and ${totals.at(-1)}`);
    expect(summary).toContain(`average of ${average}`);
    expect(summary).toContain(`up ${totals.at(-1)! - totals.at(-2)!}`);
  });

  it("resumes the changelog case from the state its recorded turn left", async () => {
    const before = await workspaceFile("CHANGELOG.md");
    const after = await caseFile("refine-over-turns", "changelog-after-turn-1.md");
    const added = "- `ParseMinutes` accepts seconds, rounding down to whole minutes.\n";
    expect(after.replace(added, "")).toBe(before);
    const history = (await caseFile("refine-over-turns", "history.jsonl")).trim().split("\n").map((line) => JSON.parse(line) as unknown);
    expect(JSON.stringify(history), "the recorded edit is the one the scaffold applies").toContain(JSON.stringify(added).slice(1, -1));
  });

  it("allows the test the repo-conventions skill asks for, where the orders package has none", async () => {
    const skill = (await readFile(join(WORKING_AGENT_FIXTURE_DIR, "skills", "repo-conventions", "SKILL.md"), "utf8")).replace(/\s+/g, " ");
    expect(skill).toContain("Extend the package's table-driven test with a row for every behaviour you add or fix");
    const orders = await readdir(join(WORKING_AGENT_WORKSPACE_FIXTURE_DIR, "orders"));
    expect(orders.filter((name) => name.endsWith("_test.go"))).toEqual([]);
    const unrelated = (await cases()).get("multi-part-change")!.graders.find((grader) => grader.name === "no-unrelated-edits")!;
    expect(unrelated.check.type === "regex" && unrelated.check.pattern).toContain("orders/[^/]+_test\\.go$");
  });

  it("gives the workspace's AGENTS.md one rule written nowhere else, and grades it in a case of its own", async () => {
    const agents = (await workspaceFile("AGENTS.md")).replace(/\s+/g, " ");
    expect(agents).toContain("Before you finish a change to Go code, run `go vet ./...` as well as `go test ./...`");
    const elsewhere = [
      await workspaceFile("README.md"),
      await readFile(join(WORKING_AGENT_FIXTURE_DIR, "skills", "repo-conventions", "SKILL.md"), "utf8"),
    ];
    for (const text of elsewhere) expect(text).not.toMatch(/\bvet\b/);
    const byName = await cases();
    const vet = byName.get("follows-repo-instructions")!.graders.find((grader) => grader.name === "ran-go-vet")!;
    expect(vet.check).toMatchObject({ type: "tool_used", tool: "Bash", inputMatch: "go vet" });
    for (const [name, evalCase] of byName) {
      if (name !== "follows-repo-instructions") expect(graderText(evalCase), name).not.toContain("go vet");
    }
  });

  it("holds a sync log the runner's bound cuts and a whole read returns, its cause only in its last lines", async () => {
    const log = await workspaceFile(SYNC_LOG);
    expect(log.length).toBeGreaterThan(TOOL_RESULT_BOUND_CHARS);
    expect(log.trimEnd().split("\n").length).toBeLessThan(READ_FILE_DEFAULT_LINES);
    const tail = log.length - 2_000;
    for (const cause of ["503", "Service Unavailable"]) {
      expect(log.indexOf(cause), cause).toBeGreaterThanOrEqual(tail);
    }
    for (const key of ["max_attempts", "retry", "backoff"]) expect(log, key).not.toContain(key);
    const diagnose = graderText((await cases()).get("diagnose-sync-log")!);
    for (const fact of ["503", "page 193", "03:39:19", "03:40:57", "pages 193 to 214"]) {
      expect(log, fact).toContain(fact);
      expect(diagnose, fact).toContain(fact);
    }
  });
});
