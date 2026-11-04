/**
 * Holds the docs snippet gate's four compilers against their real
 * toolchains: a temporary docs tree with one fence that compiles and one
 * planted break per language, each break reported at its page and line, and
 * none of the good fences reported. The UX bar's LIB-04 (TypeScript) and
 * SDK-03 (Go, Python, Java) are held by these titles. On a kit's pages, a
 * fence compiles as its reader installs and imports the kit: only the entry
 * the page names and `react` are implicit, and an import of a package the
 * kit merely depends on is refused.
 *
 * It needs what the gate needs (scripts/check-docs-snippets.mjs): the built
 * workspace libraries, Go, a Python virtual environment with the stubs and
 * the SDK (DOCS_SNIPPETS_PYTHON) and the Java SDK's classpath file
 * (DOCS_SNIPPETS_JAVA_CLASSPATH). Lane `ci.docs-snippets` sets them up and
 * runs this file; `test:root` does not, so a laptop with Node alone is not
 * asked for four toolchains.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

import { runGate } from "../../check-docs-snippets.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set; lane ci.docs-snippets sets it (scripts/check-docs-snippets.mjs says what it names)`);
  return value;
}

const docsRoot = mkdtempSync(join(tmpdir(), "docs-snippets-compilers-"));
after(() => rmSync(docsRoot, { recursive: true, force: true }));

/** Writes one page and returns its path and the page line of each fence's first body line, by label. */
function page(name, parts) {
  const lines = [`# ${name}`, ""];
  const at = {};
  for (const part of parts) {
    if (typeof part === "string") {
      lines.push(part);
      continue;
    }
    lines.push(`\`\`\`${part.lang}${part.meta ? ` ${part.meta}` : ""}`);
    at[part.label] = lines.length + 1;
    lines.push(...part.body, "```", "");
  }
  const path = `docs/${name}.mdx`;
  mkdirSync(dirname(join(docsRoot, path)), { recursive: true });
  writeFileSync(join(docsRoot, path), lines.join("\n"));
  return { path, at };
}

const typescript = page("typescript", [
  { lang: "typescript", label: "prelude", meta: "prelude", body: ['import { Stigmer } from "@stigmer/client";'] },
  { lang: "typescript", label: "good", body: ['const local = new Stigmer({ baseUrl: "http://localhost:7234", getAccessToken: () => null });', "await stigmer.run.list({});"] },
  { lang: "typescript", label: "setup", body: ["declare const user: { org: string };", "// ---cut---", "await stigmer.run.list({ org: user.org });"] },
  { lang: "typescript", label: "client", meta: 'title="client.ts"', body: ['export const org = "acme";'] },
  { lang: "typescript", label: "importer", meta: 'title="report.ts"', body: ['import { org } from "./client.js";', "", "export const where: string = org;"] },
  {
    lang: "tsx",
    label: "broken",
    body: ['import { AgentChat } from "@stigmer/react-sdk";', "", 'export const App = () => <AgentChat agnet="acme/ledger" />;'],
  },
]);

// The React kit's pages: `StreamState` is React core's, which the kit does
// not re-export, and `@stigmer/react-core` is a plain dependency of the kit,
// which its reader never installs; `SettingsNavGroup` is the console entry's.
const coreOnly = "export type Seen = StreamState;";
const consoleOnly = "export type Groups = readonly SettingsNavGroup[];";
const coreImport = 'import { useStigmer } from "@stigmer/react-core";';
const reactKit = page("sdk/react/kit", [
  { lang: "tsx", label: "core-only", body: [coreOnly] },
  { lang: "tsx", label: "core-import", body: [coreImport, "", "export const use = useStigmer;"] },
  { lang: "tsx", label: "console-only", body: [consoleOnly] },
  { lang: "tsx", label: "peer-import", body: ['import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";', 'import { IamRole } from "@stigmer/client";', "", "export const seen = (run: Run) => [run.metadata?.id, IamRole.viewer];"] },
]);
const reactConsole = page("sdk/react/settings", [{ lang: "tsx", label: "console-only", body: [consoleOnly] }]);
// Ink names React core as a peer: its reader installs it.
const inkKit = page("sdk/ink/kit", [{ lang: "tsx", label: "core-import", body: [coreImport, "", "export const use = useStigmer;"] }]);

const go = page("go", [
  { lang: "go", label: "prelude", meta: "prelude", body: ["import (", '\t"fmt"', '\t"log"', ")"] },
  { lang: "go", label: "good", body: ["me, err := client.IdentityAccount.WhoAmI(ctx)", "if err != nil {", "\tlog.Fatal(err)", "}", "fmt.Println(me)"] },
  { lang: "go", label: "setup", body: ["type ledger struct{ org string }", "", "var books ledger", "// ---cut---", "fmt.Println(books.org)"] },
  { lang: "go", label: "broken", body: ["agent, err := client.Agent.Get(ctx)", "fmt.Println(agent, err)"] },
  // A whole program is held to Go's own rule: its unused variable is an error.
  { lang: "go", label: "file", meta: 'title="main.go"', body: ["package main", "", "func main() {", "\tunused := 1", "}"] },
]);

const python = page("python", [
  { lang: "python", label: "good", body: ["me = client.identity_accounts.who_am_i()", "print(me)"] },
  { lang: "python", label: "broken", body: ['agent = client.agents.get(id="agt_01", colour="red")'] },
  // The gate's own client import is private: a fragment that names the class imports it.
  { lang: "python", label: "unimported", body: ['local = StigmerClient(base_url="localhost:7234", insecure=True)'] },
]);

const java = page("java", [
  { lang: "java", label: "good", body: ["var me = client.identityAccount.whoAmI();", "System.out.println(me);"] },
  { lang: "java", label: "broken", body: ["var agents = client.agents();"] },
]);

const gate = (pages, languages, withTheme = false) =>
  runGate({
    root: repoRoot,
    docsRoot,
    pages: pages.map((p) => p.path),
    languages,
    python: languages.includes("python") ? required("DOCS_SNIPPETS_PYTHON") : undefined,
    javaClasspath: languages.includes("java") ? required("DOCS_SNIPPETS_JAVA_CLASSPATH") : undefined,
    withTheme,
  });

/** The pages and lines a run reported, as `page:line`. */
const where = (run) => [...new Set(run.errors.map((e) => `${e.page}:${e.line}`))].sort();

test("LIB-04 a TypeScript example that does not compile is reported at its page and line; one that does is not", async () => {
  const run = await gate([typescript], ["typescript"]);
  assert.deepEqual(run.problems, []);
  assert.deepEqual(where(run), [`${typescript.path}:${typescript.at.broken + 2}`]);
  assert.match(run.errors[0].message, /agnet/);
});

test("LIB-04 a kit's example compiles as its reader imports it: the page's entry and react implicit, imports only from the kit and its peers", async () => {
  const run = await gate([reactKit, reactConsole, inkKit], ["typescript"]);
  assert.deepEqual(run.problems, []);
  assert.deepEqual(where(run), [`${reactKit.path}:${reactKit.at["core-only"]}`, `${reactKit.path}:${reactKit.at["core-import"]}`, `${reactKit.path}:${reactKit.at["console-only"]}`].sort());
  const messages = run.errors.map((e) => e.message).join("\n");
  assert.match(messages, /Cannot find name 'StreamState'/);
  assert.match(messages, /Cannot find name 'SettingsNavGroup'/);
  assert.match(messages, /imports @stigmer\/react-core, which a reader of @stigmer\/react-sdk does not install/);
});

test("SDK-03 a Go example that does not compile is reported at its page and line, its prelude's unused imports forgiven and a whole file's unused variable not", async () => {
  const run = await gate([go], ["go"]);
  assert.deepEqual(run.problems, []);
  assert.deepEqual(where(run), [`${go.path}:${go.at.broken}`, `${go.path}:${go.at.file + 3}`].sort());
  assert.match(run.errors.map((e) => e.message).join("\n"), /not enough arguments/);
  assert.match(run.errors.map((e) => e.message).join("\n"), /declared and not used/);
});

test("SDK-03 a Python example calling with a keyword the SDK lacks, or naming a class it never imported, is reported at its page and line", async () => {
  const run = await gate([python], ["python"]);
  assert.deepEqual(where(run), [`${python.path}:${python.at.broken}`, `${python.path}:${python.at.unimported}`].sort());
  assert.match(run.errors.map((e) => e.message).join("\n"), /"StigmerClient" is not defined/);
  assert.match(run.errors.map((e) => e.message).join("\n"), /colour/);
});

test("SDK-03 a Java example calling a method the SDK lacks is reported at its page and line", async () => {
  const run = await gate([java], ["java"]);
  assert.deepEqual(where(run), [`${java.path}:${java.at.broken}`]);
  assert.match(run.errors[0].message, /agents\(\)/);
});

test("LIB-04 the theme playground's code compiles for every look it offers, and a look that does not is named", async () => {
  // A writer shaped like site/src/lib/theme-snippet.mjs whose code for one
  // preset passes a prop the provider lacks.
  mkdirSync(join(docsRoot, "site", "src", "lib"), { recursive: true });
  mkdirSync(join(docsRoot, "test", "visual", "src"), { recursive: true });
  writeFileSync(join(docsRoot, "test", "visual", "src", "live.ts"), 'export const LIVE_PRESETS = ["default", "corporate"] as const;\n');
  writeFileSync(
    join(docsRoot, "site", "src", "lib", "theme-snippet.mjs"),
    [
      "export function themeSnippet({ preset, mode, radius }) {",
      "  const extra = preset === \"corporate\" && mode === \"dark\" && radius !== null ? \" shade=\\\"deep\\\"\" : \"\";",
      "  const tsx = [",
      "    'import type { ReactNode } from \"react\";',",
      "    'import type { Stigmer } from \"@stigmer/client\";',",
      "    'import { StigmerProvider } from \"@stigmer/react-sdk\";',",
      "    'export function Themed({ client, children }: { client: Stigmer; children: ReactNode }) {',",
      "    `  return <StigmerProvider client={client} colorMode=\"${mode}\"${extra}>{children}</StigmerProvider>;`,",
      "    '}',",
      "  ].join(\"\\n\");",
      "  return { tsx, css: null };",
      "}",
    ].join("\n"),
  );
  const run = await gate([], ["typescript"], true);
  assert.equal(run.units.length, 8);
  assert.equal(run.errors.length, 1);
  assert.equal(run.errors[0].page, "site/src/lib/theme-snippet.mjs");
  assert.match(run.errors[0].message, /preset corporate, dark, radius 0\.75/);
  assert.match(run.errors[0].message, /shade/);
});
