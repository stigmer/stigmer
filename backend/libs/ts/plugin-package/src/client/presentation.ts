/**
 * A plugin's presentation from a tree whose bytes cost something to obtain:
 * the lazy twin of `readPluginPresentation`, as `preparePluginFromTree` is
 * the lazy twin of the full read.
 *
 * A storefront lists a catalogue from one file and then shows a card per
 * entry; the face on each card is in that entry's manifest, one small file
 * in a directory the client has listed but not read. This reads exactly the
 * manifest paths the listing shows (one, rarely two) and nothing else, then
 * hands a `PluginFiles` whose `read` answers for those paths alone to the
 * pure reader. A manifest that cannot be fetched contributes nothing, the
 * pure reader's own rule for a manifest that cannot be parsed: a card is
 * never refused, it is drawn with what arrived.
 */

import { comparePaths, type PluginFiles } from "../files.js";
import { MANIFEST_LOCATIONS } from "../messages.js";
import { type PluginPresentation, readPluginPresentation } from "../presentation.js";
import type { LazyCandidate } from "./prepare.js";

const MANIFEST_PATHS: ReadonlySet<string> = new Set(Object.values(MANIFEST_LOCATIONS));

/** The presentation of the plugin whose files `candidates` list, reading only its manifests. */
export async function readPluginPresentationFromTree(candidates: readonly LazyCandidate[]): Promise<PluginPresentation> {
  const contents = new Map<string, Uint8Array>();
  await Promise.all(
    candidates
      .filter((candidate) => MANIFEST_PATHS.has(candidate.path))
      .map(async (candidate) => {
        try {
          contents.set(candidate.path, await candidate.read());
        } catch {
          // Unfetchable is unreadable: the pure reader skips a manifest it cannot open.
        }
      }),
  );
  const files: PluginFiles = {
    // `PluginFiles` promises a sorted listing; a host's tree order is its own.
    entries: candidates.map(({ path, size }) => ({ path, size })).sort((a, b) => comparePaths(a.path, b.path)),
    read: (path) => {
      const bytes = contents.get(path);
      if (bytes === undefined) throw new Error(`plugin file '${path}' was not fetched for presentation`);
      return bytes;
    },
  };
  return readPluginPresentation(files);
}
