/**
 * Hold the sandbox section's Environment to the docs page it comes from.
 *
 * The homepage shows the docs' worked Environment file (a data team's) as
 * the real thing, so the file in brand/sandbox.ts must equal that page's
 * first YAML block, character for character, and the typed fields the reach
 * panel draws must equal what the file says. make check-docs-yaml holds the
 * docs block to the API, so the three together keep the shown file real.
 * The panels are held to their shape: the three questions in order, each
 * with its sentences and at least one proof. The proofs themselves are
 * checked by proofs.test.ts; a wake time written here, by measurements.test.ts.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import {
  SANDBOX_ENVIRONMENT,
  SANDBOX_ENVIRONMENT_SOURCE,
  SANDBOX_PANEL_ORDER,
  SANDBOX_PANELS,
  SANDBOX_SLEEP,
} from "../sandbox";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The body of a markdown page's first fenced `yaml` block, its last newline kept. */
function firstYamlBlock(markdown: string): string | undefined {
  return /^```yaml\n([\s\S]*?)^```$/m.exec(markdown)?.[1];
}

interface EnvironmentFile {
  metadata: { slug: string };
  spec: {
    networking: {
      type: string;
      allowed_hosts?: string[];
      allow_package_managers?: boolean;
    };
  };
}

test("the shown Environment is the docs page's first YAML block, exactly", () => {
  const page = readFileSync(join(ROOT, SANDBOX_ENVIRONMENT_SOURCE), "utf8");
  assert.equal(
    SANDBOX_ENVIRONMENT.file,
    firstYamlBlock(page),
    `brand/sandbox.ts and ${SANDBOX_ENVIRONMENT_SOURCE} show different files; change both together`,
  );
});

test("the typed fields say what the file says, and the file limits networking", () => {
  const file = parse(SANDBOX_ENVIRONMENT.file) as EnvironmentFile;
  assert.equal(file.spec.networking.type, "limited");
  assert.equal(SANDBOX_ENVIRONMENT.slug, file.metadata.slug);
  assert.deepEqual(
    SANDBOX_ENVIRONMENT.allowedHosts,
    file.spec.networking.allowed_hosts ?? [],
  );
  assert.equal(
    SANDBOX_ENVIRONMENT.allowPackageManagers,
    file.spec.networking.allow_package_managers ?? false,
  );
});

test("the first YAML block is found on its own fence and kept whole", () => {
  assert.equal(
    firstYamlBlock(
      "Intro\n\n```yaml\na: 1\nb: [x, y]\n```\n\n```yaml\nc: 2\n```\n",
    ),
    "a: 1\nb: [x, y]\n",
  );
  assert.equal(firstYamlBlock("```ts\nconst a = 1;\n```\n"), undefined);
});

test("the three panels are the three questions, each with sentences and a proof", () => {
  assert.deepEqual(Object.keys(SANDBOX_PANELS), [...SANDBOX_PANEL_ORDER]);
  for (const id of SANDBOX_PANEL_ORDER) {
    const { label, title, sentences, proofs } = SANDBOX_PANELS[id];
    assert.match(label, /^[A-Z]/, `${id}: a label`);
    assert.match(title, /^[A-Z].*\?$/, `${id}: the panel asks its question`);
    assert.ok(sentences.length > 0, `${id}: at least one sentence`);
    for (const sentence of sentences)
      assert.match(
        sentence,
        /^[A-Z].*\.$/,
        `${id}: "${sentence}" is a sentence`,
      );
    assert.ok(proofs.length > 0, `${id}: at least one proof`);
  }
});

test("the sleep steps carry no clock time and no figure", () => {
  for (const step of [...SANDBOX_SLEEP.steps, SANDBOX_SLEEP.never])
    assert.doesNotMatch(
      step,
      /\d/,
      `"${step}": Stigmer Cloud's window is a setting, and the measured wake has its own row`,
    );
});
