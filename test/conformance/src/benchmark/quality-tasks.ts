// The quality tasks' file format and its reader: what a task is, and the one
// place a task file is checked, before anything boots or is paid for.
// Domain: conformance benchmark (the quality cells' input).
//
// A task is what a user would ask the working agent (support/working-agent.ts)
// in its seeded workspace, over one or more turns of one session, and how its
// result is judged. `turns` are the user's messages, sent in order. `files`
// are the workspace paths whose content after the last turn the judge is
// shown (the reply alone cannot show an edit). `checks` are the benchmark's
// own deterministic reads of that end state, a closed set so the file stays
// declarative. The judge gets `rubric` as its instructions and scores every
// entry of `criteria` 0..1; the eval weights them into the task's score.
//
// The reader takes the already-parsed document (the script owns the YAML
// parse and the file read), and refuses by naming the field, the way the
// report reader does, so a typo in the file is one named error at startup and
// never a half-run.
import type { QualityCheckName } from "./report";

export interface QualityCriterion {
  /** Unique within the task; the judge returns a score under this exact name. */
  name: string;
  description: string;
  /** Relative weight, > 0. */
  weight: number;
}

export interface QualityTask {
  id: string;
  /** A placeholder keeps the file's shape without being a real task; skipped unless asked for. */
  placeholder: boolean;
  /** The user's messages, in order, in one session. */
  turns: string[];
  /** Workspace-relative paths whose post-task content the judge is shown. */
  files: string[];
  checks: QualityCheckName[];
  rubric: string;
  criteria: QualityCriterion[];
}

const QUALITY_CHECKS: ReadonlySet<string> = new Set<QualityCheckName>(["go_test"]);

const TASK_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The tasks of a parsed task file; throws naming `source` and the offending field. */
export function parseQualityTasks(document: unknown, source: string): QualityTask[] {
  if (typeof document !== "object" || document === null || !Array.isArray((document as { tasks?: unknown }).tasks)) {
    throw new Error(`${source}: expected a top-level "tasks" list`);
  }
  const tasks = (document as { tasks: unknown[] }).tasks.map((entry, index) => parseTask(entry, `${source}: tasks[${index}]`));
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`${source}: task id ${task.id} appears twice`);
    seen.add(task.id);
  }
  return tasks;
}

function parseTask(entry: unknown, where: string): QualityTask {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`${where} must be a mapping`);
  const task = entry as Record<string, unknown>;
  const id = requireText(task, "id", where);
  if (!TASK_ID.test(id)) throw new Error(`${where}.id must be kebab-case, got ${JSON.stringify(id)}`);
  const turns = requireTextList(task, "turns", where, { min: 1 });
  const files = requireTextList(task, "files", where, { min: 0, optional: true });
  for (const [index, path] of files.entries()) {
    if (path.startsWith("/") || path.split("/").includes("..")) {
      throw new Error(`${where}.files[${index}] must be a path inside the workspace, got ${JSON.stringify(path)}`);
    }
  }
  const checks = requireTextList(task, "checks", where, { min: 0, optional: true }).map((check, index) => {
    if (!QUALITY_CHECKS.has(check)) {
      throw new Error(`${where}.checks[${index}] must be one of ${[...QUALITY_CHECKS].join(", ")}, got ${JSON.stringify(check)}`);
    }
    return check as QualityCheckName;
  });
  const rubric = requireText(task, "rubric", where);
  const criteria = parseCriteria(task["criteria"], `${where}.criteria`);
  return { id, placeholder: task["placeholder"] === true, turns, files, checks, rubric, criteria };
}

function parseCriteria(value: unknown, where: string): QualityCriterion[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${where} must be a non-empty list`);
  const names = new Set<string>();
  return value.map((entry, index) => {
    const at = `${where}[${index}]`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`${at} must be a mapping`);
    const criterion = entry as Record<string, unknown>;
    const name = requireText(criterion, "name", at);
    if (names.has(name)) throw new Error(`${at}.name ${name} appears twice`);
    names.add(name);
    const weight = criterion["weight"];
    if (typeof weight !== "number" || !(weight > 0)) throw new Error(`${at}.weight must be a number above 0`);
    return { name, description: requireText(criterion, "description", at), weight };
  });
}

function requireText(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${where}.${key} must be a non-empty string`);
  return value;
}

function requireTextList(
  record: Record<string, unknown>,
  key: string,
  where: string,
  rule: { min: number; optional?: boolean },
): string[] {
  const value = record[key];
  if (value === undefined && rule.optional === true) return [];
  if (!Array.isArray(value) || value.length < rule.min) {
    const shape = rule.min === 0 ? "a list of non-empty strings" : `a list of at least ${rule.min} non-empty string${rule.min === 1 ? "" : "s"}`;
    throw new Error(`${where}.${key} must be ${shape}`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") throw new Error(`${where}.${key}[${index}] must be a non-empty string`);
    return item;
  });
}
