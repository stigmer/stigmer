/**
 * The one rule for source-map pragmas in a published slim package, shared by
 * the runner's and the server's bundle-slim.mjs --emit-packages.
 *
 * A slim npm package ships no .map files (they dominated the install size,
 * stigmer/stigmer#170), so a trailing `//# sourceMappingURL=main.js.map` would
 * point consumers at a 404 and is stripped. A pragma whose map is INLINED
 * (`sourceMappingURL=data:application/json;base64,…`) is not a reference to a
 * missing file — it IS the map — and must stay. Temporal's pre-built workflow
 * bundles carry theirs inline and `Worker.create` refuses a bundle without it
 * ("Can't extract inlined source map from the provided Workflow Bundle"), so
 * stripping it shipped @stigmer/runner-slim and @stigmer/server-slim packages
 * whose Temporal workers could not start. The self-contained dist-slim tree
 * never stripped anything, which is why the server image and the desktop
 * worked while a laptop's npm-acquired `stigmer up` did not.
 */

/** Remove a trailing pragma that references an external map file; keep an inlined one. */
export function stripExternalSourceMapPragma(code) {
  return code.replace(/\n\/\/# sourceMappingURL=(?!data:)\S*\s*$/, "\n");
}
