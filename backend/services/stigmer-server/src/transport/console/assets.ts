/**
 * Console asset discovery — locates the web console's static export and
 * indexes it for the console lane. The discovery rule is the workflow
 * bundles' sibling idiom (src/temporal/workflow-source.ts): the slim
 * packaging emits `console/` next to main.js, where the bundled
 * import.meta.url shim resolves it; in the tsc dist the sibling never
 * exists, so dev/test servers boot without the lane unless
 * STIGMER_CONSOLE_DIR points somewhere explicitly (the conformance and
 * unit-test posture — the lane is wire-invisible when assets are absent).
 *
 * The export is indexed ONCE at composition: it is immutable for the
 * server's lifetime (it shipped inside the same artifact — DD-012's
 * no-skew property), so a boot-time scan buys O(1) resolution, an exact
 * availability answer, and a pure resolver.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "../../boot/logger.js";
import { buildConsoleFileIndex, type ConsoleFileIndex } from "./resolver.js";

export interface ConsoleAssets {
  /** Absolute filesystem root of the static export. */
  readonly root: string;
  /** "/"-rooted, "/"-separated file index the resolver consumes. */
  readonly index: ConsoleFileIndex;
  readonly fileCount: number;
}

/**
 * Resolve and index the console export. Returns undefined — the modeled
 * "not bundled" state, not an error — when neither the override nor the
 * sibling exists.
 */
export function resolveConsoleAssets(
  overrideDir: string,
  logger: Logger,
): ConsoleAssets | undefined {
  const sibling = fileURLToPath(new URL("./console/", import.meta.url));
  const root = overrideDir !== "" ? path.resolve(overrideDir) : sibling;

  let rootStat;
  try {
    rootStat = statSync(root);
  } catch {
    return undefined;
  }
  if (!rootStat.isDirectory()) {
    return undefined;
  }

  const files: string[] = [];
  scan(root, "", files);
  if (files.length === 0) {
    // An empty directory serves nothing but would report "available" —
    // treat it as absent and say why.
    logger.warn("console asset directory is empty; console lane disabled", {
      dir: root,
    });
    return undefined;
  }
  return {
    root,
    index: buildConsoleFileIndex(files),
    fileCount: files.length,
  };
}

/** Depth-first scan into "/"-separated index paths (never path.sep). */
function scan(absoluteDir: string, indexPrefix: string, out: string[]): void {
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const indexPath = `${indexPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      scan(path.join(absoluteDir, entry.name), indexPath, out);
    } else if (entry.isFile()) {
      out.push(indexPath);
    }
  }
}
