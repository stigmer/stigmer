// Unit arms for the quality arm's suite: the working agent's plugin
// (fixtures/working-agent), read by the library's own readers, and the
// facts its graders rest on, checked against the files they grade.
// Domain: conformance benchmark.
//
// Pinned: the plugin installs and its suite loads nine cases with no
// finding, each scaffolded from the one shared workspace, only the resumed
// case native-only; the order mock answers what the order tool's table
// holds; the facts the rubrics state are the workspace's (the config's
// retry limit and typo, the store's two defects, the signup totals, the
// return policy); the resumed case's scaffold leaves the workspace as its
// recorded turn left it; and the multi-part case allows the test the
// repo-conventions skill asks for, where the orders package has none.
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
  it("installs, and its suite is nine cases with no finding, each scaffolded from the shared workspace", async () => {
    const plugin = await files();
    expect(readPluginPackage(plugin).ok).toBe(true);
    const suite = readEvalSuite(plugin);
    expect(suite.findings).toEqual([]);
    expect(suite.servers).toEqual(["orders-api"]);
    expect(suite.cases.map((c) => c.name)).toEqual([
      "code-review-no-edit",
      "config-fix",
      "data-summary",
      "fix-bug-with-test",
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
});
