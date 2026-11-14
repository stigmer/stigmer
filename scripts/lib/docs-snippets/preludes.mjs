/**
 * The docs snippet gate's convention: what every fragment may take as given
 * without the page showing it. It is only the client, under the names every
 * page uses (`docs/STYLE.md`, "Code examples"): `client` or `stigmer` in
 * TypeScript, `client` and `ctx` in Go, `client` in Python and Java. For a
 * kit's own pages (the React, React-core, Ink and theme docs), a name the
 * entry the page tells its reader to import from exports is in scope too,
 * and `react`'s: exactly what "Import from `@stigmer/react-sdk`" gives a
 * reader, never a package the kit merely depends on. The React kit's three
 * console pages import from `@stigmer/react-sdk/console`, so their rule
 * names them before the folder's.
 *
 * A kit's convention also names the kit (`kit`, its folder): a fragment on
 * its pages may import only the kit's own package and the kit's peer
 * dependencies, read from its `package.json`, because those are what its
 * reader installs (typescript.mjs reports any other import).
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
 * a kit's pages); `kit` is the folder of the kit a page documents. Go: `imports` maps a package name to its import path,
 * `context` a free name to its type. Python and Java: `imports` are lines put
 * before the fragment, `context` maps a free name to its type.
 */

const CLIENT_TYPE = 'import("@stigmer/client").Stigmer';

/** Names a TypeScript fragment may use without declaring them. */
const TS_CONTEXT = { stigmer: CLIENT_TYPE, client: CLIENT_TYPE };

export const TYPESCRIPT_PRELUDES = {
  client: { entries: [], context: TS_CONTEXT },
  react: { entries: ["@stigmer/react-sdk", "react"], context: TS_CONTEXT, kit: "sdk/react" },
  "react-console": { entries: ["@stigmer/react-sdk/console", "react"], context: TS_CONTEXT, kit: "sdk/react" },
  "react-core": { entries: ["@stigmer/react-core", "react"], context: TS_CONTEXT, kit: "sdk/react-core" },
  ink: { entries: ["@stigmer/ink-ui", "react"], context: TS_CONTEXT, kit: "sdk/ink" },
  theme: { entries: ["@stigmer/react-sdk", "@stigmer/design-tokens", "react"], context: TS_CONTEXT },
};

export const GO_PRELUDES = {
  sdk: {
    imports: { context: "context", stigmer: "go.stigmer.ai/sdk" },
    context: { client: "*stigmer.Client", ctx: "context.Context" },
  },
};

// The convention's own imports are under private names, so a fragment that
// uses `StigmerClient` or `cast` still has to import it, as a reader's file does.
export const PYTHON_PRELUDES = {
  sdk: {
    imports: ["from typing import cast as _stigmer_docs_cast", "from stigmer import StigmerClient as _StigmerDocsClient"],
    context: { client: "_StigmerDocsClient" },
  },
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

/**
 * The pages whose TypeScript fragments see a kit's exports, by exact `page`
 * or by path `prefix`; the first match wins. A React page's rule must name the
 * entry its "Import from" line does (scripts/check-docs-snippets.test.mjs
 * holds the two together).
 */
export const PAGE_PRELUDES = [
  { page: "docs/sdk/react/help.mdx", typescript: "react-console" },
  { page: "docs/sdk/react/page-frame.mdx", typescript: "react-console" },
  { page: "docs/sdk/react/settings.mdx", typescript: "react-console" },
  { page: "docs/sdk/react/sidebar.mdx", typescript: "react-console" },
  { page: "docs/sdk/react/user.mdx", typescript: "react-console" },
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
  const rule = PAGE_PRELUDES.find((r) => (r.page === undefined ? page.startsWith(r.prefix) : page === r.page) && r[language] !== undefined);
  return PRELUDES[language][rule?.[language] ?? DEFAULT_PRELUDE[language]];
}
