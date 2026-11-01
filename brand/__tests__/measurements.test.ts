/**
 * Hold every copy of a measured figure equal to brand/measurements.ts.
 *
 * Code reads the figures from SANDBOX_WAKE; prose cannot import, so the docs'
 * paragraph about a sleeping Session's wake (docs/guides/self-hosting/
 * runners.mdx) is read here and must carry the date, the environment, the
 * number of wakes and each printed figure in formatSeconds's form. The
 * figures themselves are held to what a measurement can produce: enough
 * wakes, ordered percentiles, and the sandbox's resume inside the wait it is
 * part of. No site source, and no brand file whose words the site renders,
 * may write a wake time of its own: one that does names its file here, and
 * the fix is to read SANDBOX_WAKE.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SANDBOX_WAKE, WAKE_PATHS, formatSeconds } from "../measurements";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

const RUNNERS = "docs/guides/self-hosting/runners.mdx";

test("every wake path holds enough wakes, ordered figures, and a resume inside its wait", () => {
  assert.match(SANDBOX_WAKE.measuredOn, /^\d{4}-\d{2}-\d{2}$/, "measuredOn is an ISO day");
  assert.equal(SANDBOX_WAKE.environment, "Stigmer Cloud, preprod");
  for (const path of WAKE_PATHS) {
    const { n, working, resume } = SANDBOX_WAKE.paths[path];
    assert.ok(n >= 30, `${path}: ${n} wakes; a p95 needs at least 30`);
    for (const [clock, f] of [["working", working], ["resume", resume]] as const) {
      assert.ok(f.p50 <= f.p95 && f.p95 <= f.max, `${path} ${clock}: p50 ≤ p95 ≤ max`);
      assert.ok(f.p50 > 0, `${path} ${clock}: a positive median`);
    }
    assert.ok(resume.p50 <= working.p50, `${path}: the sandbox's resume is part of the wait, so no longer than it`);
  }
});

/** The paragraph of the runners page that names the environment the figures were measured on. */
function wakeParagraph(): string {
  const paragraph = read(RUNNERS)
    .split(/\n\s*\n/)
    .find((block) => collapse(block).includes(SANDBOX_WAKE.environment));
  assert.ok(paragraph !== undefined, `${RUNNERS}: no paragraph names "${SANDBOX_WAKE.environment}"`);
  return collapse(paragraph);
}

test("the runners page states the measurement and every figure it prints", () => {
  const paragraph = wakeParagraph();
  const missing: string[] = [];
  const expect = (what: string, text: string) => {
    if (!paragraph.includes(text)) missing.push(`${what}: "${text}"`);
  };
  expect("the date", SANDBOX_WAKE.measuredOn);
  expect("the setup", SANDBOX_WAKE.setup);
  for (const path of WAKE_PATHS) {
    const { n, working, resume } = SANDBOX_WAKE.paths[path];
    expect(`${path}: wakes`, String(n));
    expect(`${path}: the wait's median`, formatSeconds(working.p50));
    expect(`${path}: the wait's p95`, formatSeconds(working.p95));
    expect(`${path}: the resume's median`, formatSeconds(resume.p50));
  }
  assert.deepEqual(missing, [], `${RUNNERS} disagrees with brand/measurements.ts`);
});

test("the runners page no longer carries the single laptop measurement it replaced", () => {
  const page = collapse(read(RUNNERS));
  for (const stale of ["kind, 2026-10-25", "0.22 s"]) {
    assert.ok(!page.includes(stale), `${RUNNERS}: "${stale}" is the one-wake kind figure brand/measurements.ts replaced`);
  }
});

/**
 * A seconds figure and a word for sleeping or waking in one sentence: a
 * wake time. Minutes stay free, because how long a Session idles before it
 * sleeps is a setting, not a measurement. A "sentence" in code can run a
 * whole file, so a long one is judged on the 80 characters each side of the
 * figure.
 */
const SECONDS = /\b\d+(?:\.\d+)?\s?(?:s|secs?|seconds?)\b/gi;
const SLEEP_WORDS = /\b(?:wakes?|woken|waking|woke|asleep|sleeps?|sleeping|slept)\b/i;

function wakeTimes(text: string): string[] {
  const found: string[] = [];
  for (const sentence of collapse(text).split(/(?<=[.!?])\s+/)) {
    for (const match of sentence.matchAll(SECONDS)) {
      const at = match.index ?? 0;
      const context =
        sentence.length <= 400 ? sentence : sentence.slice(Math.max(0, at - 80), at + match[0].length + 80);
      if (SLEEP_WORDS.test(context)) found.push(context.slice(0, 160));
    }
  }
  return found;
}

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".jsx", ".mjs", ".json", ".md", ".mdx", ".html", ".txt"]);

function* textSources(dir: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__tests__") yield* textSources(path);
    } else if (TEXT_EXTENSIONS.has(extname(entry.name)) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      yield path;
    }
  }
}

test("the wake-time finder catches a hand-written figure and leaves a setting in minutes alone", () => {
  assert.equal(wakeTimes("A sleeping agent is working again in 4.97 s.").length, 1);
  assert.equal(wakeTimes("It wakes in 5 seconds.").length, 1);
  assert.equal(wakeTimes("A Session sleeps after 2 minutes idle.").length, 0);
  assert.equal(wakeTimes("The film runs 30 s. Agents sleep when idle.").length, 0);
});

/** The brand files whose words the site renders as its own text. */
const RENDERED_BRAND = ["brand/agent-gets.ts", "brand/sandbox.ts"];

test("no site source writes a wake time of its own", () => {
  const copies: string[] = [];
  for (const path of [...textSources("site/src"), ...RENDERED_BRAND]) {
    for (const context of wakeTimes(read(path))) copies.push(`${path}: "${context}"`);
  }
  assert.deepEqual(copies, [], "read SANDBOX_WAKE from brand/measurements.ts instead");
});
