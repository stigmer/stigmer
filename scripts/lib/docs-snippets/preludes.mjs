/**
 * The docs snippet gate's convention: what every fragment may take as given
 * without the page showing it. It is only the client, under the names every
 * page uses (`docs/STYLE.md`, "Code examples"): `client` or `stigmer` in
 * TypeScript, `client` and `ctx` in Go, `client` in Python and Java. For a
 * kit's own pages (the React, React-core, Ink and theme docs), a name the
 * kit's entry exports is in scope too, as the reference pages present them.
 *
 * Nothing else is given. Imports a page's examples share are the page's
 * visible `prelude` fence; a name an example takes from the prose (a `user`
 * the previous step signed in) is that fence's hidden setup. The gate never
 * guesses what a page means by an undeclared `id` or `org`.
 *
 * A context name is declared only where a fragment uses it and does not
 * declare it itself, so a fragment that builds its own `client` is checked
 * against what it built.
 *
 * TypeScript: `context` maps a free name to its type; `entries` are the
 * modules an unimported name is looked up in, first match wins (empty but on
 * a kit's pages). Go: `imports` maps a package name to its import path,
 * `context` a free name to its type. Python and Java: `imports` are lines put
 * before the fragment, `context` maps a free name to its type.
 */

const CLIENT_TYPE = 'import("@stigmer/client").Stigmer';

/** Names a TypeScript fragment may use without declaring them. */
const TS_CONTEXT = { stigmer: CLIENT_TYPE, client: CLIENT_TYPE };

export const TYPESCRIPT_PRELUDES = {
  client: { entries: [], context: TS_CONTEXT },
  react: { entries: ["@stigmer/react-sdk", "@stigmer/react-core", "@stigmer/client", "react"], context: TS_CONTEXT },
  "react-core": { entries: ["@stigmer/react-core", "@stigmer/client", "react"], context: TS_CONTEXT },
  ink: { entries: ["@stigmer/ink-ui", "@stigmer/client", "ink", "react"], context: TS_CONTEXT },
  theme: { entries: ["@stigmer/react-sdk", "@stigmer/design-tokens", "react"], context: TS_CONTEXT },
};

export const GO_PRELUDES = {
  sdk: {
    imports: { context: "context", stigmer: "go.stigmer.ai/sdk" },
    context: { client: "*stigmer.Client", ctx: "context.Context" },
  },
};

export const PYTHON_PRELUDES = {
  sdk: { imports: ["from typing import cast", "from stigmer import StigmerClient"], context: { client: "StigmerClient" } },
};

export const JAVA_PRELUDES = {
  sdk: { imports: [], context: { client: "ai.stigmer.sdk.StigmerClient" } },
};

export const PRELUDES = {
  typescript: TYPESCRIPT_PRELUDES,
  go: GO_PRELUDES,
  python: PYTHON_PRELUDES,
  java: JAVA_PRELUDES,
};

/** Each language's convention when no page rule names a kit's. */
export const DEFAULT_PRELUDE = { typescript: "client", go: "sdk", python: "sdk", java: "sdk" };

/** Page path prefixes whose TypeScript fragments see a kit's exports; the first match wins. */
export const PAGE_PRELUDES = [
  { prefix: "docs/sdk/react-core/", typescript: "react-core" },
  { prefix: "docs/sdk/react/", typescript: "react" },
  { prefix: "docs/sdk/ink/", typescript: "ink" },
  { prefix: "docs/sdk/theme/", typescript: "theme" },
];

/**
 * The convention a page's fragments of one language compile with.
 * @param {string} page the page's repository path
 * @param {string} language a key of PRELUDES
 */
export function conventionFor(page, language) {
  const rule = PAGE_PRELUDES.find((r) => page.startsWith(r.prefix) && r[language] !== undefined);
  return PRELUDES[language][rule?.[language] ?? DEFAULT_PRELUDE[language]];
}
