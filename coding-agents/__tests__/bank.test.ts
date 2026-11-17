// The coding-agent question bank (coding-agents/evals/<job>/<case>/): the
// questions and jobs a developer brings to their coding agent about Stigmer,
// each an eval case `claude plugin eval` runs (make bank-coding-agent, by
// hand, with the plugin and without it) and Stigmer's own reader takes. This
// suite holds its shape in the gate, with no model:
//   - Stigmer reads the folder (`readEvalFolder`, as `stigmer push eval`
//     does) with no finding and no case it would not run;
//   - every case is one job's, holds the one tool list and turn cap every
//     case shares (so both arms meet the same agent, `Skill` among its tools
//     or the plugin's own arm runs without its skill), and carries its
//     graders: the rubric, the docs page it is answered from, the skill-fired
//     indicator, a fixture fact for a case that acts; a safety check never
//     uses `tool_used` with `max: 0`, which Claude Code and Stigmer score
//     differently;
//   - every docs page a case cites exists, by the site's own URL rule
//     (site/src/lib/llms-pages.ts: `docs/<path>.mdx` or
//     `docs/<path>/index.mdx`), so a moved page reds here;
//   - every concept page, getting-started page and guide group is cited by a
//     case, so a page added to the docs adds its question to the bank;
//   - every job holds at least four cases, and no case holds a key-shaped
//     value.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inMemoryPluginFiles, readEvalFolder, type EvalCase, type EvalGrader } from "@stigmer/plugin-package";
import { beforeAll, describe, expect, it } from "vitest";
import { ACTS_TAG, JOBS } from "../../test/install/lib/coding-agent-bank.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bank = join(root, "evals");
const docs = join(root, "..", "docs");

/** The tools every case grants, in this order: a person's coding agent, minus writing their files. */
const ALLOWED_TOOLS = ["Skill", "Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch", "mcp__plugin_stigmer_stigmer"];
const ANSWER_TURNS = 15;
const ACTING_TURNS = 30;
const MIN_CASES_PER_JOB = 4;

/** A cited page: `docs/` then one path, or a parenthesised `|` list of paths, each relative to docs/ with no extension. */
const CITE_PATTERN = /^docs\/(?:\(([a-z0-9\-/]+(?:\|[a-z0-9\-/]+)*)\)|([a-z0-9\-/]+))$/;
/** A provider or Stigmer key, or a long unbroken run of letters and digits a token would be (a docs path breaks at its slashes and hyphens). */
const KEY_SHAPED = /sk-ant-|\bsk-[A-Za-z0-9]{16,}|\bstg_[A-Za-z0-9]{8,}|[A-Za-z0-9]{32,}/;

function tree(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.set(relative(dir, path), readFileSync(path, "utf8"));
    }
  };
  walk(dir);
  return files;
}

/** The docs pages a `cites-the-page` pattern names, or undefined when the pattern is not one. */
function citedPages(pattern: string): string[] | undefined {
  const match = CITE_PATTERN.exec(pattern);
  if (match === null) return undefined;
  return (match[1] ?? match[2] ?? "").split("|");
}

/** Whether `page` (relative to docs/, no extension) is a page the site serves. */
function pageExists(page: string): boolean {
  return existsSync(join(docs, `${page}.mdx`)) || existsSync(join(docs, page, "index.mdx"));
}

function grader(c: EvalCase, name: string): EvalGrader | undefined {
  return c.graders.find((g) => g.name === name);
}

let files: Map<string, string>;
let cases: readonly EvalCase[];

beforeAll(() => {
  files = tree(bank);
  const suite = readEvalFolder(inMemoryPluginFiles(files));
  expect(suite.findings).toEqual([]);
  cases = suite.cases;
});

describe("the question bank", () => {
  it("reads in Stigmer with no finding, and Stigmer would run every case", () => {
    expect(cases.length).toBeGreaterThanOrEqual(JOBS.length * MIN_CASES_PER_JOB);
    expect(cases.filter((c) => c.unsupported !== undefined).map((c) => `${c.dir}: ${c.unsupported}`)).toEqual([]);
  });

  it("files every case under its one job, with that job's tag", () => {
    for (const c of cases) {
      const [job, ...rest] = c.dir.split("/");
      expect(rest.length, c.dir).toBe(1);
      expect(JOBS, c.dir).toContain(job);
      expect(c.tags.filter((tag) => JOBS.includes(tag)), c.dir).toEqual([job]);
      expect(c.tags.every((tag) => JOBS.includes(tag) || tag === ACTS_TAG), c.dir).toBe(true);
    }
  });

  it("holds at least four cases for every job", () => {
    for (const job of JOBS) {
      expect(cases.filter((c) => c.dir.startsWith(`${job}/`)).length, job).toBeGreaterThanOrEqual(MIN_CASES_PER_JOB);
    }
  });

  it("gives every case the same tools, Skill among them, and its kind's turn cap", () => {
    for (const c of cases) {
      expect(c.allowedTools, c.dir).toEqual(ALLOWED_TOOLS);
      expect(c.maxTurns, c.dir).toBe(c.tags.includes(ACTS_TAG) ? ACTING_TURNS : ANSWER_TURNS);
      expect(c.env, c.dir).toEqual({});
      expect(c.plugins, c.dir).toEqual([]);
    }
  });

  it("grades every case by its rubric, its docs page and the skill-fired indicator, and an acting case by a fixture fact", () => {
    for (const c of cases) {
      expect(grader(c, "criteria")?.check.type, c.dir).toBe("llm");
      expect(grader(c, "cites-the-page")?.check.type, c.dir).toBe("regex");
      const fired = grader(c, "skill-fired");
      expect(fired?.check, c.dir).toMatchObject({ type: "tool_used", tool: "Skill" });
      expect(fired?.arm, c.dir).toBe("with-only");
      if (c.tags.includes(ACTS_TAG)) {
        const fact = grader(c, "reports-the-fact")?.check;
        expect(fact, c.dir).toMatchObject({ type: "regex", match: { kind: "contains" } });
      }
    }
  });

  it("never scores a safety check with tool_used max 0, and checks a destructive call on the trace", () => {
    for (const c of cases) {
      for (const g of c.graders) {
        if (g.check.type === "tool_used") expect(g.check.max, `${c.dir}: ${g.name}`).toBeUndefined();
      }
      const stop = grader(c, "does-not-act")?.check;
      if (stop !== undefined) expect(stop, c.dir).toMatchObject({ type: "regex", match: { kind: "not_contains" }, target: { kind: "trace" } });
    }
  });

  it("cites only docs pages that exist", () => {
    for (const c of cases) {
      const check = grader(c, "cites-the-page")?.check;
      const pages = check?.type === "regex" ? citedPages(check.pattern) : undefined;
      expect(pages, `${c.dir}: cites-the-page must be docs/<page> or docs/(<page>|<page>)`).toBeDefined();
      for (const page of pages ?? []) expect(pageExists(page), `${c.dir} cites docs/${page}, which is no page`).toBe(true);
    }
  });

  it("cites every concept page, getting-started page and guide group in the docs", () => {
    const cited = new Set(
      cases.flatMap((c) => {
        const check = grader(c, "cites-the-page")?.check;
        return check?.type === "regex" ? (citedPages(check.pattern) ?? []) : [];
      }),
    );
    const pagesIn = (section: string): string[] =>
      readdirSync(join(docs, section))
        .filter((name) => name.endsWith(".mdx") && name !== "index.mdx")
        .map((name) => `${section}/${name.replace(/\.mdx$/, "")}`);
    const uncited = [...pagesIn("concepts"), ...pagesIn("getting-started")].filter((page) => !cited.has(page));
    const groups = readdirSync(join(docs, "guides")).filter((name) => statSync(join(docs, "guides", name)).isDirectory());
    const uncitedGroups = groups.filter((group) => ![...cited].some((page) => page.startsWith(`guides/${group}/`))).map((group) => `guides/${group}/`);
    expect([...uncited, ...uncitedGroups], "a docs page with no question in the bank: add the question a person brings to it").toEqual([]);
  });

  it("holds no key-shaped value", () => {
    for (const [path, text] of files) expect(KEY_SHAPED.test(text), path).toBe(false);
  });
});

describe("citedPages", () => {
  it("reads one page or a list of pages, and nothing else", () => {
    expect(citedPages("docs/concepts/vaults")).toEqual(["concepts/vaults"]);
    expect(citedPages("docs/(concepts/vaults|guides/integrations/model-provider-keys)")).toEqual(["concepts/vaults", "guides/integrations/model-provider-keys"]);
    expect(citedPages("stigmer\\.ai/docs/concepts/vaults")).toBeUndefined();
    expect(citedPages("docs/concepts/vaults.mdx")).toBeUndefined();
    expect(citedPages("docs/(concepts/vaults|)")).toBeUndefined();
  });
});
