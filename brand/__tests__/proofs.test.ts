/**
 * Hold every proof the site shows to the thing it names.
 *
 * A claim on the homepage points at a public test by its file and the words
 * of its cases, at a picture the visual suite draws, or at a file or page.
 * This suite runs on every change (the root tests, in the workspace lane), so
 * a test renamed or a case reworded fails the pull request that did it, and
 * the failure names the proof to update. The five claims are also held to
 * their shape: one per title, each said as a question with what you would
 * build, what Stigmer gives, and at least one proof.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SHOWN } from "../../test/visual/src/shown";
import {
  AGENT_GET_CLAIMS,
  AGENT_GET_ORDER,
  AGENT_GET_TITLES,
  ALSO_BUILT,
} from "../agent-gets";
import type { Proof, TestsProof } from "../proof";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The quote that opens an `it(` title, its body, and the same quote closing it; `[rpc:…]` tags come first. */
const CASE_TITLE = /\bit(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

/** The titles of a test file's cases, each as its words after its `[rpc:…]` tags. */
function caseTitles(source: string): string[] {
  return [...source.matchAll(CASE_TITLE)].map((match) =>
    match[2]!.replace(/^(?:\[[^\]]*\]\s*)+/, "").replace(/\\(.)/g, "$1"),
  );
}

/** The file a site path is built from, or null when no page serves it. */
function sitePage(href: string): string | null {
  const path = href.replace(/#.*$/, "");
  const candidates = path.startsWith("/docs/")
    ? [
        `docs/${path.slice("/docs/".length)}.mdx`,
        `docs/${path.slice("/docs/".length)}/index.mdx`,
      ]
    : [`site/src/app${path}/page.tsx`];
  return (
    candidates.find((candidate) => existsSync(join(ROOT, candidate))) ?? null
  );
}

/** What is wrong with one proof, as lines that name it; empty when it holds. */
function problemsOf(proof: Proof): string[] {
  switch (proof.kind) {
    case "measurement":
      return [];
    case "screen":
      return SHOWN.some((shown) => shown.name === proof.name)
        ? []
        : [`screen "${proof.name}": no such entry in test/visual/src/shown.ts`];
    case "tests": {
      if (!existsSync(join(ROOT, proof.path)))
        return [`tests "${proof.path}": no such file`];
      const titles = caseTitles(readFileSync(join(ROOT, proof.path), "utf8"));
      return proof.cases
        .filter((words) => !titles.includes(words))
        .map((words) => `tests "${proof.path}": no case titled "${words}"`);
    }
    case "source": {
      if (proof.href.startsWith("/"))
        return sitePage(proof.href) === null
          ? [`source "${proof.href}": no page serves it`]
          : [];
      return existsSync(join(ROOT, proof.href))
        ? []
        : [`source "${proof.href}": no such file`];
    }
  }
}

/** The proof, which the caller knows quotes tests. */
function quoting(proof: Proof | undefined): TestsProof {
  if (proof?.kind !== "tests")
    throw new Error(`expected a tests proof, got ${JSON.stringify(proof)}`);
  return proof;
}

const EVERY_PROOF: readonly Proof[] = [
  ...AGENT_GET_ORDER.flatMap((id) => AGENT_GET_CLAIMS[id].proofs),
  ...ALSO_BUILT.flatMap((also) => also.proofs),
];

test("every proof the site shows names a test, a picture, a file or a page that exists", () => {
  assert.deepEqual(
    EVERY_PROOF.flatMap((proof) => problemsOf(proof)),
    [],
  );
});

test("the proof check names a missing test file, a reworded case, a missing picture and a missing page", () => {
  const tests = quoting(AGENT_GET_CLAIMS.hours.proofs[0]);
  assert.deepEqual(
    problemsOf({
      ...tests,
      path: "test/conformance/src/gone.conformance.test.ts",
    }),
    [`tests "test/conformance/src/gone.conformance.test.ts": no such file`],
  );
  assert.deepEqual(
    problemsOf({
      ...tests,
      cases: ["a server restarted mid-turn loses nothing"],
    }),
    [
      `tests "${tests.path}": no case titled "a server restarted mid-turn loses nothing"`,
    ],
  );
  assert.deepEqual(problemsOf({ kind: "screen", name: "nowhere", alt: "x" }), [
    `screen "nowhere": no such entry in test/visual/src/shown.ts`,
  ]);
  assert.deepEqual(
    problemsOf({ kind: "source", label: "x", href: "/docs/no/such/page" }),
    [`source "/docs/no/such/page": no page serves it`],
  );
  assert.deepEqual(
    problemsOf({ kind: "source", label: "x", href: "NO-SUCH-FILE" }),
    [`source "NO-SUCH-FILE": no such file`],
  );
});

test("a case's words are its title after its tags, on one line or the next", () => {
  const source = [
    `it("[rpc:A.b] [rpc:C.d] a deny: the call never runs", async () => {});`,
    `it(\n    "a server rolled out mid-turn costs a watcher no event",\n    async () => {},\n  );`,
    `it.skip('a skipped case\\'s words', () => {});`,
  ].join("\n");
  assert.deepEqual(caseTitles(source), [
    "a deny: the call never runs",
    "a server rolled out mid-turn costs a watcher no event",
    "a skipped case's words",
  ]);
});

test("the order holds each of the five once, and each has a title and a claim", () => {
  assert.deepEqual(
    [...AGENT_GET_ORDER].sort(),
    Object.keys(AGENT_GET_TITLES).sort(),
  );
  assert.deepEqual(
    [...AGENT_GET_ORDER].sort(),
    Object.keys(AGENT_GET_CLAIMS).sort(),
  );
  assert.equal(new Set(AGENT_GET_ORDER).size, AGENT_GET_ORDER.length);
});

test("each claim is a worry asked as a question, what you would build, what Stigmer gives, and a proof", () => {
  for (const id of AGENT_GET_ORDER) {
    const { worry, build, gives, proofs } = AGENT_GET_CLAIMS[id];
    assert.match(worry, /^[A-Z].*\?$/, `${id}: the worry is a question`);
    assert.match(build, /^[A-Z]/, `${id}: what you'd build`);
    assert.match(gives, /^[A-Z]/, `${id}: what Stigmer gives`);
    assert.ok(proofs.length > 0, `${id}: at least one proof`);
  }
});

test("the sandbox's claim is proved first by its measured wake", () => {
  assert.deepEqual(AGENT_GET_CLAIMS["own-computer"].proofs[0], {
    kind: "measurement",
    figure: "sandbox-wake",
  });
});

test("each thing also built has its own id, a title, a sentence and a proof, and never says drop-in", () => {
  assert.equal(
    new Set(ALSO_BUILT.map((also) => also.id)).size,
    ALSO_BUILT.length,
  );
  for (const also of ALSO_BUILT) {
    assert.ok(
      also.title.length > 0 && also.sentence.endsWith("."),
      `${also.id}: a title and a sentence`,
    );
    assert.ok(also.proofs.length > 0, `${also.id}: at least one proof`);
    assert.doesNotMatch(
      `${also.title} ${also.sentence}`,
      /drop-in/i,
      `${also.id}: never "drop-in"`,
    );
  }
});
