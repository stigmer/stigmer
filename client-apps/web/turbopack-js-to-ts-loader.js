// Turbopack loader that strips `.js` extensions from relative import specifiers
// so Turbopack can resolve them to their `.ts`/`.tsx` sources. This is the
// standard workaround for the missing `resolve.extensionAlias` feature in
// Turbopack. See: https://github.com/vercel/next.js/issues/82945
//
// The SDK packages (@stigmer/sdk, @stigmer/react, @stigmer/theme) are authored
// with explicit `.js` specifiers so their published `dist` is resolvable by
// plain Node ESM (the CLI / mcp-server run under Node). Turbopack consumes their
// TypeScript source via `transpilePackages`, so every relative-`.js` form must
// be stripped here — not just `from "..."`, but also runtime `import("...")`
// (e.g. React.lazy) and side-effect `import "..."`. Missing the dynamic form
// breaks the static export build on lazily-loaded chunks.
//
// Only relative specifiers (`./` or `../`) ending in `.js` are rewritten; bare
// specifiers and real `.js` assets in non-relative packages are untouched.
const RELATIVE_JS_SPECIFIER =
  /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(["'])(\.\.?\/[^"']*?)\.js(\2)/g;

module.exports = function rewriteJsImports(source) {
  return source.replace(RELATIVE_JS_SPECIFIER, "$1$2$3$4");
};
