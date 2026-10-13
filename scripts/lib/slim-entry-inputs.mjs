/**
 * The one-copy rule for a slim bundle built from another package's entry
 * (the server's bundle-slim.mjs --entry-package): no input may come from
 * that package's own node_modules.
 *
 * A package built against the server and installed beside it keeps its own
 * lockfile, so its node_modules holds its own copy of every dependency it
 * shares with the server (@bufbuild/protobuf, pg, ...). Bundled as the
 * checkout lays it out, the server's code would resolve those from the
 * server's node_modules and the package's code from its own: two module
 * instances of each in one process, the split registry the consumer-install
 * check exists to forbid (scripts/verify-consumer-install.mjs). The bundler
 * resolves the entry package's imports from the server's tree instead; this
 * rule reads the bundle's metafile and fails the build the day anything
 * still arrives from the package's own tree.
 */

/**
 * The packages a bundle took from `nodeModulesDir`, one row per package,
 * sorted by name. `inputs` are the metafile's input paths and
 * `nodeModulesDir` the entry package's node_modules, both relative to the
 * bundle's working directory, with either separator. A namespaced input
 * (`(disabled):...`) is read by its path.
 */
export function entryPackageCopies(inputs, nodeModulesDir) {
  const prefix = `${posix(nodeModulesDir).replace(/\/+$/, "")}/`;
  const copies = new Map();
  for (const input of inputs) {
    const path = posix(input).replace(/^\([a-z-]+\):/, "");
    if (!path.startsWith(prefix)) continue;
    const segments = path.slice(prefix.length).split("/");
    const name = segments[0].startsWith("@") ? `${segments[0]}/${segments[1]}` : segments[0];
    if (!copies.has(name)) copies.set(name, `${prefix}${name}`);
  }
  return [...copies]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, dir]) => ({ name, dir }));
}

function posix(path) {
  return path.replaceAll("\\", "/");
}
