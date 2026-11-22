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
//     graders: the rubric, the skill-fired indicator, the docs pages it is
//     answered from on every case that answers (a case that acts may cite:
//     where its answer is the fixture's fact or the act itself, that fact or
//     the trace is the proof), and a fixture fact for a case that acts; a
//     safety check never uses `tool_used` with `max: 0`, which Claude Code
//     and Stigmer score differently;
//   - every judge question is one point: a case's rubric is two to four
//     Must graders (`must-<n>`, "the answer makes this point") and its
//     fail-if graders (`fail-if-<n>`, "the answer does not do this"), each
//     holding one point after the one question every grader of its kind
//     asks; what an answer may also say is the case's `welcome.md`, never
//     graded. `claude plugin eval`'s judge answers PASS or FAIL in one word
//     with no room to reason, and measured on 2026-11-18 it graded one
//     point at a time right on right and wrong answers alike, while a list
//     of points in one grader failed a right answer under every wording
//     tried. It also failed right answers that denied a fail-if line's
//     claim ("Stigmer runs no model of its own" against "says Stigmer runs
//     a model of its own"), so the fail-if question says an answer that
//     says the opposite, denies it or warns against it does not do it;
//     probed on five such answers and five wrong ones, it graded all ten
//     right. Every case's fail-if lines ask that question: each job moved to
//     it, setup last, its lines re-read against the docs, and none may go back;
//   - a case cites the published page (`stigmer.ai/docs/<page>`), never a
//     bare `docs/<page>` that a link to the docs' source on GitHub would
//     also match, and every page it cites exists, by the site's own URL rule
//     (site/src/lib/llms-pages.ts: `docs/<path>.mdx` or
//     `docs/<path>/index.mdx`), so a moved page reds here;
//   - every concept page, getting-started page and guide group is cited by a
//     case, so a page added to the docs adds its question to the bank;
//   - every case that acts puts the bank's fixture back before each try
//     (test/install/lib/bank-fixture.mjs), since a failed try may have
//     deleted or changed what the next one reads, and a sample a scaffold
//     writes into the try's folder is the fixture's own, byte for byte, so
//     the report the fixture's run saved names what the person's file holds;
//   - every job holds at least four cases, and no case holds a key-shaped
//     value.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { inMemoryPluginFiles, readEvalFolder, type EvalCase, type EvalGrader } from "@stigmer/plugin-package";
import { beforeAll, describe, expect, it } from "vitest";
import { RESTORE_COMMAND } from "../../test/install/lib/bank-fixture.mjs";
import { ACTS_TAG, JOBS } from "../../test/install/lib/coding-agent-bank.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const bank = join(root, "evals");
const docs = join(root, "..", "docs");

/** The tools every case grants, in this order: a person's coding agent, minus writing their files. */
const ALLOWED_TOOLS = ["Skill", "Read", "Grep", "Glob", "Bash", "WebFetch", "WebSearch", "mcp__plugin_stigmer_stigmer"];
const ANSWER_TURNS = 15;
const ACTING_TURNS = 30;
const MIN_CASES_PER_JOB = 4;

/** A cited page: the published `stigmer\.ai/docs/` then one path, or a parenthesised `|` list of paths, each relative to docs/ with no extension. */
const CITE_PATTERN = /^stigmer\\\.ai\/docs\/(?:\(([a-z0-9\-/]+(?:\|[a-z0-9\-/]+)*)\)|([a-z0-9\-/]+))$/;

/** The question every Must grader asks the judge, before its one point. */
const MUST_QUESTION = "PASS if the answer makes this point, in substance (in its own words):";
/** The question every fail-if grader asks the judge, before its one point: what fails, and that its denial does not. */
const FAIL_IF_QUESTION = "PASS unless the answer does this; an answer that says the opposite, denies it or warns against it does not do it:";
/** The fail-if question before the denial rule, which every job has been re-probed out of; no grader asks it. */
const FAIL_IF_QUESTION_BEFORE = "PASS unless the answer does this:";
const MIN_MUST = 2;
const MAX_MUST = 4;
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

/** The one point a judge grader asks about after `question`, or undefined when it asks anything else or more than one thing. */
function onePoint(criteria: string, question: string): string | undefined {
  const blocks = criteria.trim().split(/\n\s*\n/);
  if (blocks.length !== 2 || blocks[0] !== question) return undefined;
  const point = blocks[1] ?? "";
  return point.includes("\n") || point.startsWith("- ") || point === "" ? undefined : point;
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

  it("grades every case by its rubric and the skill-fired indicator, a case that answers by its docs pages, and an acting case by a fixture fact", () => {
    for (const c of cases) {
      const cites = grader(c, "cites-the-page");
      if (!c.tags.includes(ACTS_TAG) || cites !== undefined) expect(cites?.check.type, c.dir).toBe("regex");
      const fired = grader(c, "skill-fired");
      expect(fired?.check, c.dir).toMatchObject({ type: "tool_used", tool: "Skill" });
      expect(fired?.arm, c.dir).toBe("with-only");
      if (c.tags.includes(ACTS_TAG)) {
        const fact = grader(c, "reports-the-fact")?.check;
        expect(fact, c.dir).toMatchObject({ type: "regex", match: { kind: "contains" } });
      }
    }
  });

  it("puts the fixture back before every try of a case that acts, since a failed try may have deleted or changed it", () => {
    for (const c of cases.filter((kase) => kase.tags.includes(ACTS_TAG))) {
      const script = c.context.scaffoldScript;
      expect(script, `${c.dir} has no scaffold_script`).toBeDefined();
      const text = files.get(join(c.dir, script ?? "")) ?? "";
      expect(text, c.dir).toContain(`command -v ${RESTORE_COMMAND} >/dev/null 2>&1; then ${RESTORE_COMMAND}; fi`);
    }
  });

  it("writes a sample in a try's folder exactly as the fixture holds it, so the fixture's runs and the person's file agree", () => {
    const heredoc = /cat > (samples\/[\w.-]+) <<'EOF'\n([\s\S]*?)\nEOF\n/g;
    let samples = 0;
    for (const [path, text] of files) {
      if (!path.endsWith("scaffold.sh")) continue;
      for (const [, sample, body] of text.matchAll(heredoc)) {
        samples += 1;
        expect(`${body}\n`, `${path} writes ${sample}`).toBe(files.get(join("_fixture", sample ?? "")));
      }
    }
    expect(samples).toBeGreaterThan(0);
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

  it("asks the judge one point per grader: two to four Must points and at least one fail-if line", () => {
    for (const c of cases) {
      const judged = c.graders.filter((g) => g.check.type === "llm");
      const kinds: [string, string][] = [
        ["must", MUST_QUESTION],
        ["fail-if", FAIL_IF_QUESTION],
      ];
      for (const [kind, question] of kinds) {
        const named = judged.filter((g) => new RegExp(`^${kind}-\\d+$`).test(g.name)).map((g) => g.name);
        expect(
          [...named].sort((a, b) => Number(a.slice(kind.length + 1)) - Number(b.slice(kind.length + 1))),
          `${c.dir}: ${kind} graders are numbered from 1 with no gap`,
        ).toEqual(named.map((_, i) => `${kind}-${i + 1}`));
        for (const name of named) {
          const check = grader(c, name)?.check;
          expect(onePoint(check?.type === "llm" ? check.criteria : "", question), `${c.dir}: ${name} asks "${question}" of one point`).toBeDefined();
        }
      }
      const must = judged.filter((g) => g.name.startsWith("must-")).length;
      expect(must, `${c.dir}: Must points`).toBeGreaterThanOrEqual(MIN_MUST);
      expect(must, `${c.dir}: Must points`).toBeLessThanOrEqual(MAX_MUST);
      expect(judged.filter((g) => g.name.startsWith("fail-if-")).length, `${c.dir}: fail-if lines`).toBeGreaterThan(0);
      expect(judged.filter((g) => !/^(must|fail-if)-\d+$/.test(g.name)).map((g) => g.name), `${c.dir}: a judge grader that asks a list`).toEqual([]);
    }
  });

  it("cites only published docs pages that exist", () => {
    for (const c of cases) {
      const check = grader(c, "cites-the-page")?.check;
      if (check === undefined && c.tags.includes(ACTS_TAG)) continue;
      const pages = check?.type === "regex" ? citedPages(check.pattern) : undefined;
      expect(pages, `${c.dir}: cites-the-page must be stigmer\\.ai/docs/<page> or stigmer\\.ai/docs/(<page>|<page>)`).toBeDefined();
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
    expect(citedPages("stigmer\\.ai/docs/concepts/vaults")).toEqual(["concepts/vaults"]);
    expect(citedPages("stigmer\\.ai/docs/(concepts/vaults|guides/integrations/model-provider-keys)")).toEqual(["concepts/vaults", "guides/integrations/model-provider-keys"]);
    expect(citedPages("docs/concepts/vaults"), "a bare docs/ path also matches a link to the source on GitHub").toBeUndefined();
    expect(citedPages("stigmer.ai/docs/concepts/vaults"), "an unescaped dot matches any character").toBeUndefined();
    expect(citedPages("stigmer\\.ai/docs/concepts/vaults.mdx")).toBeUndefined();
    expect(citedPages("stigmer\\.ai/docs/(concepts/vaults|)")).toBeUndefined();
  });
});

describe("onePoint", () => {
  it("reads the one point after the grader's question, and nothing else", () => {
    expect(onePoint(`${MUST_QUESTION}\n\nSays the key stays on the server.\n`, MUST_QUESTION)).toBe("Says the key stays on the server.");
    expect(onePoint(`${MUST_QUESTION}\n\n- one\n- two\n`, MUST_QUESTION), "a list").toBeUndefined();
    expect(onePoint(`${MUST_QUESTION}\n\nOne.\n\nTwo.\n`, MUST_QUESTION), "two points").toBeUndefined();
    expect(onePoint(`${FAIL_IF_QUESTION}\n\nIt prints the key.\n`, MUST_QUESTION), "another question").toBeUndefined();
    expect(onePoint(`${FAIL_IF_QUESTION}\n\nIt prints the key.\n`, FAIL_IF_QUESTION)).toBe("It prints the key.");
    expect(onePoint(`${FAIL_IF_QUESTION_BEFORE}\n\nIt prints the key.\n`, FAIL_IF_QUESTION), "the older question").toBeUndefined();
  });
});
