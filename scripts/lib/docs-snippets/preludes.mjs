/**
 * The preludes the docs snippet gate compiles a fragment inside: what a
 * fragment may take as given (a client named `client`, a context `ctx`, an
 * id) and where its unimported names come from.
 *
 * A prelude is chosen by `compile="<name>"` on the fence, else by the page
 * (the first rule in PAGE_PRELUDES whose prefix the page's path starts with),
 * else the language's default. Generated resource pages take theirs from the
 * generator (`docs/sdk/resources/snippet-preludes.json`, written by
 * `tools/codegen/src/generator/sdk-docs.ts`), so the page and the check read
 * one source.
 *
 * A context name is declared only where a fragment uses it and does not
 * declare it itself, so a fragment that builds its own `client` is checked
 * against what it built, not against the prelude's.
 *
 * TypeScript: `entries` are the modules an unimported name is looked up in,
 * first match wins; `context` maps a free name to its type.
 * Go: `imports` maps a package name to its import path; `context` maps a free
 * name to its type. Python: `imports` are lines put before the fragment;
 * `context` maps a free name to its annotation. Java: `imports` are import
 * lines; `context` maps a free name to its declared type.
 */

const CLIENT_TYPE = 'import("@stigmer/client").Stigmer';

/** Names a TypeScript fragment may use without declaring them, in every prelude. */
const TS_CONTEXT = {
  stigmer: CLIENT_TYPE,
  client: CLIENT_TYPE,
  id: "string",
  org: "string",
  orgId: "string",
  sessionId: "string",
  runId: "string",
  agentId: "string",
};

export const TYPESCRIPT_PRELUDES = {
  client: { entries: ["@stigmer/client"], context: TS_CONTEXT },
  react: { entries: ["@stigmer/react-sdk", "@stigmer/react-core", "@stigmer/client", "react"], context: TS_CONTEXT },
  "react-core": { entries: ["@stigmer/react-core", "@stigmer/client", "react"], context: TS_CONTEXT },
  ink: { entries: ["@stigmer/ink-ui", "@stigmer/client", "ink", "react"], context: TS_CONTEXT },
  theme: { entries: ["@stigmer/react-sdk", "@stigmer/design-tokens", "react"], context: TS_CONTEXT },
};

const GO_IMPORTS = {
  context: "context",
  errors: "errors",
  fmt: "fmt",
  log: "log",
  os: "os",
  strings: "strings",
  time: "time",
  stigmer: "go.stigmer.ai/sdk",
  proto: "google.golang.org/protobuf/proto",
  agentv1: "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/agent/v1",
  runv1: "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/run/v1",
  sessionv1: "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1",
};

const GO_CONTEXT = {
  client: "*stigmer.Client",
  ctx: "context.Context",
  id: "string",
  org: "string",
  sessionID: "string",
  runID: "string",
};

export const GO_PRELUDES = {
  sdk: { imports: GO_IMPORTS, context: GO_CONTEXT },
};

const PYTHON_IMPORTS = ["import os", "import sys", "from stigmer import *", "from stigmer import StigmerClient"];

const PYTHON_CONTEXT = {
  client: "StigmerClient",
  id: "str",
  org: "str",
  session_id: "str",
  run_id: "str",
};

export const PYTHON_PRELUDES = {
  sdk: { imports: PYTHON_IMPORTS, context: PYTHON_CONTEXT },
};

// `ai.stigmer.**` stands for every package of the generated stubs
// (java.mjs reads them from the stubs jar).
const JAVA_IMPORTS = ["import ai.stigmer.sdk.*;", "import ai.stigmer.sdk.gen.*;", "import ai.stigmer.**;", "import java.util.*;"];

const JAVA_CONTEXT = {
  client: "StigmerClient",
  id: "String",
  org: "String",
  sessionId: "String",
  runId: "String",
};

export const JAVA_PRELUDES = {
  sdk: { imports: JAVA_IMPORTS, context: JAVA_CONTEXT },
};

export const PRELUDES = {
  typescript: TYPESCRIPT_PRELUDES,
  go: GO_PRELUDES,
  python: PYTHON_PRELUDES,
  java: JAVA_PRELUDES,
};

/** Each language's prelude when neither the fence nor the page names one. */
export const DEFAULT_PRELUDE = { typescript: "client", go: "sdk", python: "sdk", java: "sdk" };

/** Page path prefixes and the prelude their fragments take, per language; the first match wins. */
export const PAGE_PRELUDES = [
  { prefix: "docs/sdk/react-core/", typescript: "react-core" },
  { prefix: "docs/sdk/react/", typescript: "react" },
  { prefix: "docs/sdk/ink/", typescript: "ink" },
  { prefix: "docs/sdk/theme/", typescript: "theme" },
  { prefix: "docs/getting-started/embed-agent", typescript: "react" },
  { prefix: "docs/guides/channels/", typescript: "react" },
];

/**
 * The prelude a fragment compiles in: `{ name, prelude }`. Throws on a name
 * no language table holds, so a typo in `compile=` fails the gate.
 * @param {string} page the page's repository path
 * @param {string} language a key of PRELUDES
 * @param {string | null} named the fence's `compile=` value, if any
 * @param {Record<string, unknown>} [generated] the page's generator-written prelude, if any
 */
export function preludeFor(page, language, named, generated) {
  const table = PRELUDES[language];
  if (named !== null) {
    const prelude = table[named];
    if (prelude === undefined) {
      throw new Error(`compile="${named}" names no ${language} prelude (known: ${Object.keys(table).join(", ")})`);
    }
    return { name: named, prelude };
  }
  if (generated !== undefined) return { name: "generated", prelude: mergeGenerated(language, generated) };
  const rule = PAGE_PRELUDES.find((r) => page.startsWith(r.prefix) && r[language] !== undefined);
  const name = rule?.[language] ?? DEFAULT_PRELUDE[language];
  return { name, prelude: table[name] };
}

// A generated page's prelude extends its language's default with the
// generator's imports: the generator knows which packages a page's types
// live in, the default knows the context every fragment assumes.
function mergeGenerated(language, generated) {
  const base = PRELUDES[language][DEFAULT_PRELUDE[language]];
  switch (language) {
    case "typescript":
      return { ...base, entries: [...(generated.entries ?? []), ...base.entries] };
    case "go":
      return { ...base, imports: { ...base.imports, ...(generated.imports ?? {}) } };
    case "python":
    case "java":
      return { ...base, imports: [...base.imports, ...(generated.imports ?? [])] };
    default:
      throw new Error(`no prelude table for ${language}`);
  }
}
