// The two grammars a user types at the marketplace surface, as the CLI's
// errors.
//
// The grammars themselves (`[marketplace/]name[@version]` and the GitHub
// `owner/repo[@ref]` or URL forms) live in `@stigmer/plugin-package/client`,
// where the console parses the same text and gets the same sentence. This
// module adds what only the CLI has: a `UsageError` carrying the sentence
// plus the paragraph naming the CLI command to run instead, and the reading
// of `marketplace add <source>` as a directory on this machine, which wins
// over every other reading (`add plugins` in a checkout means the folder,
// not a GitHub owner).

import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
  GITHUB_SOURCE_SHAPE,
  INSTALL_REF_SHAPE,
  type InstallRef,
  formatInstallRef,
  looksLikePath,
  parseGitHubSource,
  parseInstallRef as parseInstallRefText,
} from "@stigmer/plugin-package/client";
import { UsageError } from "../errors/index.js";
import { type MarketplaceSource } from "./config.js";

export { type InstallRef, formatInstallRef };

export function parseInstallRef(text: string): InstallRef {
  const outcome = parseInstallRefText(text);
  if (outcome.ok) return outcome.ref;
  if (outcome.kind === "path") {
    throw new UsageError(
      `${outcome.message}\n\nTo install a plugin from a folder, run: stigmer push plugin ${text}`,
    );
  }
  throw new UsageError(`${outcome.message}\n\nA ref is ${INSTALL_REF_SHAPE}.`);
}

/**
 * What `marketplace add <source>` was given, as a source. An existing
 * directory wins over every other reading; otherwise the shared GitHub
 * grammar decides, and what it refuses is refused here with the shape.
 */
export function parseAddSource(
  text: string,
  cwd: string = process.cwd(),
): Exclude<MarketplaceSource, { type: "official" }> {
  if (text === "")
    throw new UsageError(`a marketplace source is required\n\n${ADD_SHAPE}`);

  const asDirectory = resolve(cwd, text);
  if (isDirectory(asDirectory)) return { type: "local", path: asDirectory };

  const github = parseGitHubSource(text);
  if (github.ok) return github.source;

  if (looksLikePath(text) || text.includes("/")) {
    throw new UsageError(
      `'${text}' is not a directory on this machine and not a GitHub 'owner/repo'\n\n${ADD_SHAPE}`,
    );
  }
  throw new UsageError(`'${text}' is not a marketplace source\n\n${ADD_SHAPE}`);
}

const ADD_SHAPE = `A source is a directory holding a marketplace file, or ${GITHUB_SOURCE_SHAPE}.`;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
