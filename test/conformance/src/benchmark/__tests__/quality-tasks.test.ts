// Unit arms for the quality tasks' reader, and for the checked-in task file
// against the fixture it grades.
// Domain: conformance benchmark.
//
// Pinned: a well-formed task is read with its defaults (no files, no checks,
// not a placeholder); every malformed field is refused by name, before
// anything runs (a missing turn, a path outside the workspace, an unknown
// check, an empty or duplicated criterion, a non-positive weight, a
// duplicated id). The real file parses into the ten tasks. Every reference
// fact a rubric states agrees with the source it was taken from: the order
// fixture, the organization's facts and the workspace's files. So a change to
// either side without the other fails here, never silently in a paid run.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { FIXTURE_ORDERS } from "../../harness/mcp-server";
import { WORKING_AGENT_FACTS, WORKING_AGENT_FIXTURE_DIR } from "../../support/working-agent";
import { parseQualityTasks, type QualityTask } from "../quality-tasks";

const TASK_FILE = resolve(import.meta.dirname, "..", "..", "..", "scripts", "benchmark-harnesses", "quality-tasks.yaml");
const WORKSPACE = join(WORKING_AGENT_FIXTURE_DIR, "workspace");

function minimal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "fix-it",
    turns: ["Fix it."],
    rubric: "Grade the fix.",
    criteria: [{ name: "correct", description: "It is correct.", weight: 1 }],
    ...overrides,
  };
}

describe("parseQualityTasks", () => {
  it("reads a well-formed task with its defaults", () => {
    expect(parseQualityTasks({ tasks: [minimal()] }, "tasks.yaml")).toEqual([
      {
        id: "fix-it",
        placeholder: false,
        turns: ["Fix it."],
        files: [],
        checks: [],
        rubric: "Grade the fix.",
        criteria: [{ name: "correct", description: "It is correct.", weight: 1 }],
      },
    ]);
  });

  it("refuses each malformed field by name", () => {
    const refuse = (task: Record<string, unknown>, message: string): void => {
      expect(() => parseQualityTasks({ tasks: [task] }, "tasks.yaml")).toThrow(message);
    };
    refuse(minimal({ turns: [] }), "tasks.yaml: tasks[0].turns must be a list of at least 1 non-empty string");
    refuse(minimal({ id: "Fix It" }), "tasks[0].id must be kebab-case");
    refuse(minimal({ files: ["../outside.go"] }), "tasks[0].files[0] must be a path inside the workspace");
    refuse(minimal({ files: ["/etc/passwd"] }), "tasks[0].files[0] must be a path inside the workspace");
    refuse(minimal({ checks: ["npm_test"] }), "tasks[0].checks[0] must be one of go_test");
    refuse(minimal({ criteria: [] }), "tasks[0].criteria must be a non-empty list");
    refuse(minimal({ criteria: [{ name: "a", description: "d", weight: 0 }] }), "tasks[0].criteria[0].weight must be a number above 0");
    refuse(
      minimal({ criteria: [{ name: "a", description: "d", weight: 1 }, { name: "a", description: "d", weight: 1 }] }),
      "tasks[0].criteria[1].name a appears twice",
    );
    refuse(minimal({ rubric: " " }), "tasks[0].rubric must be a non-empty string");
    expect(() => parseQualityTasks({ tasks: [minimal(), minimal()] }, "tasks.yaml")).toThrow("task id fix-it appears twice");
    expect(() => parseQualityTasks({ items: [] }, "tasks.yaml")).toThrow('expected a top-level "tasks" list');
  });
});

describe("the checked-in task file", () => {
  async function load(): Promise<Map<string, QualityTask>> {
    const tasks = parseQualityTasks(yaml.load(await readFile(TASK_FILE, "utf8")), TASK_FILE);
    return new Map(tasks.map((task) => [task.id, task]));
  }
  const workspaceFile = (path: string): Promise<string> => readFile(join(WORKSPACE, path), "utf8");

  it("is the ten tasks, none a placeholder, each naming only files the workspace has", async () => {
    const tasks = await load();
    expect([...tasks.keys()]).toEqual([
      "repo-question",
      "fix-bug-with-test",
      "code-review-no-edit",
      "support-policy",
      "tool-lookup",
      "config-fix",
      "data-summary",
      "memory-recall",
      "refine-over-turns",
      "multi-part-change",
    ]);
    for (const task of tasks.values()) {
      expect(task.placeholder, task.id).toBe(false);
      for (const path of task.files) await expect(workspaceFile(path), `${task.id} names ${path}`).resolves.toBeTypeOf("string");
    }
  });

  it("states the order the tool returns, and the fact the organization remembers, as the fixtures hold them", async () => {
    const tasks = await load();
    const order = FIXTURE_ORDERS["ORD-4821"]!;
    for (const field of ["status", "carrier", "tracking_number", "shipped_on", "estimated_delivery"] as const) {
      expect(tasks.get("tool-lookup")!.rubric, field).toContain(String(order[field]));
    }
    expect(tasks.get("memory-recall")!.rubric).toContain(WORKING_AGENT_FACTS[0]!);
  });

  it("states the workspace's facts as its files hold them", async () => {
    const tasks = await load();
    expect(await workspaceFile("config/sync.yaml")).toContain("max_attempts: 50");
    expect(await workspaceFile("config/sync.yaml")).toContain("timout: 30s");
    expect(await workspaceFile("syncer/syncer.go")).toContain("DefaultMaxAttempts = 5");
    expect(tasks.get("repo-question")!.rubric).toContain("sync.retry.max_attempts to 50");
    const multiPart = tasks.get("multi-part-change")!.rubric;
    expect(multiPart).toContain("sync.retry.max_attempts to 50");
    expect(multiPart).toContain('misspells timeout as "timout" (value 30s)');
    const store = await workspaceFile("orders/store.go");
    expect(store).toContain("offset := page * pageSize");
    expect(store).toContain("WHERE customer = '%s'");
    expect(multiPart).toContain("computes the offset as page * pageSize");

    const policy = await workspaceFile("policies/returns.md");
    expect(policy).toContain("within 30 days of delivery");
    expect(policy).toContain("within 90\ndays of delivery");

    const rows = (await workspaceFile("data/signups.csv")).trim().split("\n").slice(1);
    const totals = rows.map((row) => row.split(",").slice(1).reduce((sum, cell) => sum + Number(cell), 0));
    const earlier = totals.slice(0, -1);
    const average = Math.round(earlier.reduce((sum, total) => sum + total, 0) / earlier.length);
    const rubric = tasks.get("data-summary")!.rubric.replace(/\s+/g, " ");
    expect(rubric).toContain(`Weekly totals are ${totals.slice(0, -1).join(", ")} and ${totals.at(-1)}`);
    expect(rubric).toContain(`average of ${average}`);
    expect(rubric).toContain(`up ${totals.at(-1)! - totals.at(-2)!}`);
  });
});
