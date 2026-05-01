// Turbopack loader that strips .js extensions from relative imports so that
// Turbopack can resolve them to .ts/.tsx files. This is the standard workaround
// for the missing resolve.extensionAlias feature in Turbopack.
// See: https://github.com/vercel/next.js/issues/82945
module.exports = function rewriteJsImports(source) {
  return source.replaceAll(
    /(from\s+["']\..*?)(\.js)(['"];?)$/gm,
    "$1$3",
  );
};
