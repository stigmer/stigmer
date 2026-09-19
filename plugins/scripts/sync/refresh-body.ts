/**
 * The pull request body a catalogue refresh opens: the decisions the report
 * asks for, and what moved in the tree; pure over the report's text.
 *
 * `npm run refresh-body -w @stigmer/plugins -- --audit <audit.md> --changes <git-status-file> --run-url <url>`
 * prints it. The refresh lane runs this after the audit and the sync, and
 * hands the text to `gh pr create` or `gh pr edit`.
 *
 * A body is for the maintainer who merges, so it carries the sections a
 * person acts on (the summary and the exclusions by rule, the rule-5
 * flags, the endpoints to author, the login servers that refuse
 * registration, the data-quality flags) and the list of folders the sync
 * changed, and leaves out the per-catalogue tables, which run to hundreds
 * of rows and live in the run's artifacts. GitHub caps a body at 65,536
 * characters; the tables would cross it as the catalogue grows, the
 * decisions never will.
 *
 * The section headings are the report's own (`audit/report.ts`); a heading
 * that is not found is not an error, because a run may have nothing under
 * it, and the body says which sections it found.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

/** The report headings a body carries, in the order they appear in it. */
export const BODY_SECTIONS: readonly string[] = [
  "## Summary",
  "## Rule 5 flags: excluded on a word, for you to move",
  "## Endpoints to author",
  "## Login servers that refuse dynamic registration (rule 6)",
  "## Data-quality flags",
];

export interface RefreshBodyInput {
  /** The audit report (`audit.md`) as text. */
  readonly report: string;
  /** `git status --porcelain` over the catalogue, one line per path. */
  readonly changes: string;
  /** The workflow run's URL, where the full report is an artifact. */
  readonly runUrl: string;
}

export function renderRefreshBody({ report, changes, runUrl }: RefreshBodyInput): string {
  const sections = splitSections(report);
  const parts: string[] = [
    "Weekly catalogue refresh: the audit at the vendors' current commits, and the sync of what passes the rubric. Curation is this merge; the per-catalogue tables and every probe's evidence are the run's artifacts.",
    "",
    `Run: ${runUrl}`,
    "",
    "## What moved in the tree",
    "",
    ...renderChanges(changes),
  ];
  for (const heading of BODY_SECTIONS) {
    const body = sections.get(heading);
    if (body === undefined) continue;
    parts.push("", heading, "", body.trim());
  }
  return `${parts.join("\n").trim()}\n`;
}

/** The report cut at its `##` headings: heading to the text under it. */
function splitSections(report: string): ReadonlyMap<string, string> {
  const sections = new Map<string, string>();
  let heading: string | undefined;
  let lines: string[] = [];
  const flush = (): void => {
    if (heading !== undefined) sections.set(heading, lines.join("\n"));
  };
  for (const line of report.split("\n")) {
    if (line.startsWith("## ")) {
      flush();
      heading = line.trimEnd();
      lines = [];
    } else if (heading !== undefined) {
      lines.push(line);
    }
  }
  flush();
  return sections;
}

/** The changed catalogue paths as a list of the folders and files they fall under, or one line saying nothing moved. */
function renderChanges(changes: string): readonly string[] {
  const touched = new Set<string>();
  for (const line of changes.split("\n")) {
    const path = line.slice(3).trim();
    if (path === "") continue;
    const relative = path.replace(/^plugins\//, "");
    const [head] = relative.split("/");
    touched.add(head === relative ? relative : `${head}/`);
  }
  if (touched.size === 0) return ["Nothing: the pins and the tree already agreed."];
  return [...touched].sort().map((name) => `- \`${name}\``);
}

if (process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file://").href) {
  const { values } = parseArgs({
    options: { audit: { type: "string" }, changes: { type: "string" }, "run-url": { type: "string", default: "" } },
    strict: true,
  });
  if (values.audit === undefined || values.changes === undefined) throw new Error("--audit <audit.md> and --changes <git-status-file> are required");
  process.stdout.write(renderRefreshBody({ report: readFileSync(values.audit, "utf8"), changes: readFileSync(values.changes, "utf8"), runUrl: values["run-url"] }));
}
