/**
 * Hold every copy of Stigmer's words equal to brand/positioning.ts.
 *
 * Code reads the words from POSITIONING; prose cannot import, so the prose
 * homes (the vocabulary's positioning section, the docs' front page, "What
 * is Stigmer?", the docs assistant's Skill and the root README) are read here
 * and must match it, and no text source in the site or the console may carry
 * the words, or a retired tagline, as a literal of its own. A failure names
 * the copy that drifted.
 *
 * The one-line descriptions a developer picks Stigmer by (each entry point's
 * manifest, README opening, chart, image label, root help and the Homebrew
 * formula) are hand-written in their own formats, so they are held to the
 * sentence's core, the part every fitted form keeps, and every public
 * package's description to carrying no retired phrase.
 *
 * The examples a developer reads (the docs, the reference sources, the
 * consoles, the MCP server and the SDK READMEs) are held to the current job
 * by refusing the example names of the jobs the earlier story showed.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DESC as HOMEBREW_DESC } from "../../scripts/homebrew-formula.mjs";
import { POSITIONING } from "../positioning";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The first quoted string of the vocabulary paragraph that opens with `**label**`. */
function vocabularyWords(markdown: string, label: string): string | undefined {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .find((block) => block.startsWith(`**${label}**`));
  return paragraph === undefined
    ? undefined
    : /"([^"]+)"/.exec(collapse(paragraph))?.[1];
}

test("docs/vocabulary.md states the words POSITIONING holds", () => {
  const vocabulary = read("docs/vocabulary.md");
  for (const [label, words] of [
    ["The headline", POSITIONING.headline],
    ["The subhead", POSITIONING.subhead],
    ["The one sentence", POSITIONING.oneSentence],
  ] as const) {
    assert.equal(
      vocabularyWords(vocabulary, label),
      words,
      `docs/vocabulary.md: **${label}**`,
    );
  }
});

test("docs/index.mdx carries the headline, the subhead and the one sentence", () => {
  const page = read("docs/index.mdx");
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(page)?.[1] ?? "";
  const hero = /<Hero\b([\s\S]*?)\/>/.exec(page)?.[1] ?? "";
  const attribute = (name: string) =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(hero)?.[1];
  assert.equal(
    /^description:\s*(.+)$/m.exec(frontmatter)?.[1],
    POSITIONING.oneSentence,
    "docs/index.mdx: frontmatter description",
  );
  assert.equal(attribute("title"), POSITIONING.headline, "docs/index.mdx: <Hero title>");
  assert.equal(
    attribute("description"),
    POSITIONING.subhead,
    "docs/index.mdx: <Hero description>",
  );
});

/** Whether `text` carries `words`, compared with whitespace collapsed and case folded. */
const carries = (text: string, words: string) =>
  collapse(text).toLowerCase().includes(words.toLowerCase());

test("What is Stigmer? opens with the one sentence and where it runs", () => {
  const page = read("docs/concepts/what-is-stigmer.mdx");
  const [, frontmatter = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(page) ?? [];
  const description = /^description:([\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(frontmatter)?.[1] ?? "";
  const opening = body.trim().split(/\n\s*\n/)[0] ?? "";
  const path = "docs/concepts/what-is-stigmer.mdx";
  assert.ok(carries(description, POSITIONING.oneSentence), `${path}: frontmatter description`);
  assert.ok(carries(opening, POSITIONING.oneSentence), `${path}: opening paragraph, the one sentence`);
  assert.ok(carries(opening, POSITIONING.whereItRuns), `${path}: opening paragraph, where it runs`);
});

test("the docs assistant's Skill says what Stigmer is in the same words", () => {
  const path = "docs-agent/skills/stigmer-docs/SKILL.md";
  const section = /^## What Stigmer is\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(read(path))?.[1];
  assert.ok(section !== undefined, `${path}: a "## What Stigmer is" section`);
  assert.ok(carries(section, POSITIONING.oneSentence), `${path}: "What Stigmer is", the one sentence`);
  assert.ok(carries(section, POSITIONING.whereItRuns), `${path}: "What Stigmer is", where it runs`);
});

/** The README's banner alt text, and its first paragraph under `# Stigmer`. */
function readmeLead(markdown: string): { alt?: string; opening: string } {
  const alt = /<img\b[^>]*\balt="([^"]*)"/.exec(markdown)?.[1];
  const body = /^# Stigmer\n([\s\S]*)$/m.exec(markdown)?.[1] ?? "";
  return { alt, opening: body.trim().split(/\n\s*\n/)[0] ?? "" };
}

test("the root README opens with the headline, the one sentence and where it runs", () => {
  const { alt, opening } = readmeLead(read("README.md"));
  assert.ok(carries(alt ?? "", POSITIONING.headline), "README.md: the banner's alt text");
  assert.ok(carries(opening, POSITIONING.oneSentence), "README.md: first paragraph, the one sentence");
  assert.ok(carries(opening, POSITIONING.whereItRuns), "README.md: first paragraph, where it runs");
});

/**
 * The one sentence without its leading article and full stop: what every
 * fitted form keeps (Homebrew refuses a description that opens with "The"
 * or ends with a full stop), so what every entry point must carry.
 */
const CORE = POSITIONING.oneSentence.replace(/^The /, "").replace(/\.$/, "");

/** The paragraph after a Markdown file's H1. */
const readmeOpening = (markdown: string) =>
  (/^# .*\n([\s\S]*)$/m.exec(markdown)?.[1] ?? "").trim().split(/\n\s*\n/)[0] ?? "";

const jsonDescription = (text: string) => String(JSON.parse(text).description ?? "");

/**
 * Where a developer picks Stigmer, each read in its own format: the CLI, the
 * four language clients, the React and terminal components, the Helm chart
 * and the server image, each with the README its registry page shows.
 */
const ENTRY_POINTS: ReadonlyArray<readonly [path: string, extract: (text: string) => string | undefined]> = [
  ["client-apps/cli/package.json", jsonDescription],
  ["client-apps/cli/src/program.ts", (text) => /\.name\("stigmer"\)\s*\.description\("([^"]*)"\)/.exec(text)?.[1]],
  ["client-apps/cli/README.md", readmeOpening],
  ["sdk/typescript/package.json", jsonDescription],
  ["sdk/typescript/README.md", readmeOpening],
  ["sdk/python/pyproject.toml", (text) => /^description\s*=\s*"([^"]*)"/m.exec(text)?.[1]],
  ["sdk/python/README.md", readmeOpening],
  ["sdk/java/pom.xml", (text) => /<description>([^<]*)<\/description>/.exec(text)?.[1]],
  ["sdk/java/README.md", readmeOpening],
  ["sdk/go/README.md", readmeOpening],
  ["sdk/react/package.json", jsonDescription],
  ["sdk/react/README.md", readmeOpening],
  ["sdk/ink/package.json", jsonDescription],
  ["deploy/helm/stigmer/Chart.yaml", (text) => /^description:\s*(.+)$/m.exec(text)?.[1]],
  ["deploy/helm/stigmer/README.md", readmeOpening],
  ["backend/services/stigmer-server/Dockerfile", (text) => /^ARG IMAGE_DESCRIPTION="([^"]*)"/m.exec(text)?.[1]],
];

const WHERE_THE_WORDS_CHANGE =
  'the words change in docs/vocabulary.md, "What Stigmer is, and who it is for", first';

test("every entry point describes Stigmer as the open-source backend for the agents in your product", () => {
  const drifted: string[] = [];
  for (const [path, extract] of ENTRY_POINTS) {
    const description = extract(read(path));
    if (description === undefined) drifted.push(`${path}: no description found`);
    else if (!carries(description, CORE)) drifted.push(`${path}: "${collapse(description)}"`);
  }
  if (!carries(HOMEBREW_DESC, CORE)) drifted.push(`scripts/homebrew-formula.mjs DESC: "${HOMEBREW_DESC}"`);
  assert.deepEqual(drifted, [], `each must carry "${CORE}"; ${WHERE_THE_WORDS_CHANGE}`);
});

/** Phrases from the stories Stigmer told before, refused wherever a description lives. */
const RETIRED_PHRASES = [
  "workflow automation",
  "agents and workflows",
  "AI agent platform",
  "agent orchestration",
  "Build agents that work for your business",
  "Agents as Microservices",
];

/** Every tracked package.json npm publishes, with its description. */
function publicPackageDescriptions(): Array<readonly [path: string, description: string]> {
  return execFileSync("git", ["ls-files", "-z", "--", ":(glob)**/package.json"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((path) => [path, JSON.parse(read(path))] as const)
    .filter(([, manifest]) => manifest.private !== true)
    .map(([path, manifest]) => [path, String(manifest.description ?? "")] as const);
}

test("no package, entry point or README description tells a retired story", () => {
  const homes: Array<readonly [string, string]> = [
    ...publicPackageDescriptions(),
    ...ENTRY_POINTS.map(([path, extract]) => [path, extract(read(path)) ?? ""] as const),
    ["scripts/homebrew-formula.mjs DESC", HOMEBREW_DESC],
    ["README.md", read("README.md")],
  ];
  const retired: string[] = [];
  for (const [path, text] of homes) {
    for (const phrase of RETIRED_PHRASES) {
      if (carries(text, phrase)) retired.push(`${path}: "${phrase}"`);
    }
  }
  assert.deepEqual(retired, [], WHERE_THE_WORDS_CHANGE);
});

/** Where the site and the console keep their text sources. */
const CODE_ROOTS = ["site/src", "site/scripts", "site/public", "client-apps/web/src"];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  ".txt",
  ".md",
  ".mdx",
  ".html",
  ".webmanifest",
  ".proto",
  ".go",
]);

/**
 * The words no source may spell out: the current ones (with the trailing
 * period dropped, so a copy without it is caught too) and the taglines they
 * replaced. A source is compared with its whitespace collapsed and its case
 * folded, so prose wrapped across lines, or a copy in another case, is
 * caught too.
 */
const HAND_COPIES = [
  POSITIONING.headline,
  POSITIONING.subhead,
  POSITIONING.oneSentence,
  POSITIONING.whereItRuns,
  "Build agents that work for your business",
  "Agents as Microservices",
].map((words) => words.replace(/\.$/, ""));

function* textSources(dir: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__tests__") {
        yield* textSources(path);
      }
    } else if (TEXT_EXTENSIONS.has(extname(entry.name)) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      yield path;
    }
  }
}

test("no site or console source holds the words as a literal of its own", () => {
  const copies: string[] = [];
  for (const root of CODE_ROOTS) {
    for (const path of textSources(root)) {
      const text = collapse(read(path)).toLowerCase();
      for (const words of HAND_COPIES) {
        if (text.includes(words.toLowerCase())) copies.push(`${path}: "${words}"`);
      }
    }
  }
  assert.deepEqual(copies, [], "import POSITIONING from brand/positioning.ts instead");
});

/**
 * The example names of the jobs Stigmer's earlier story showed: a support
 * desk and a code review. Its job now is a job inside the developer's own
 * product, "not a chat and not code", and every shown example takes the
 * ledger job the quickstart and the concept pages use (docs/vocabulary.md,
 * "What Stigmer is, and who it is for", Examples). `code-review-` is a
 * prefix, so the real `thermos:code-review` plugin agent, shown as a plugin
 * and not as a job, is not caught.
 */
const RETIRED_EXAMPLES = [
  "support-agent",
  "support-desk",
  "support-bot",
  "support bot",
  "Support tools",
  "Zendesk",
  "refund-policy",
  "code-reviewer",
  "code-review-",
  "pr-reviewer",
  "pr-bot",
  "release-notes",
];

/**
 * Where a developer reads an example: the docs, the API reference's sources
 * (protos and their docs), the CLI's help and reference sources, the React
 * SDK and both consoles, the MCP server's tool descriptions, and the Go
 * examples. Plugins are left out: the vendored marketplace is real plugins.
 */
const EXAMPLE_ROOTS = [
  "docs",
  "apis/ai",
  "client-apps/cli/docs",
  "client-apps/cli/src",
  "sdk/react/src",
  "client-apps/web/src",
  "client-apps/desktop/src",
  "mcp-server/src",
  "sdk/go/examples",
];

/** Each SDK's README, its package's page on its registry. */
const SDK_READMES = ["sdk/go/README.md", "sdk/python/README.md", "sdk/java/README.md", "sdk/typescript/README.md"];

test("no page, reference source, console or SDK README shows a retired example job", () => {
  const paths = [...EXAMPLE_ROOTS.flatMap((root) => [...textSources(root)]), ...SDK_READMES];
  const shown: string[] = [];
  for (const path of paths) {
    const text = collapse(read(path)).toLowerCase();
    for (const name of RETIRED_EXAMPLES) {
      if (text.includes(name.toLowerCase())) shown.push(`${path}: "${name}"`);
    }
  }
  assert.deepEqual(shown, [], "show the ledger job instead: docs/concepts/agents.mdx holds its names");
});
